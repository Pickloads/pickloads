import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/database.types";

/**
 * M-61 — staff multi-factor authentication (audit §6.1, approved decision D3).
 *
 * D3 enforcement:
 *   role `admin`       → HARD from day one. An admin without a VERIFIED TOTP
 *                        factor, or holding one but signed in at AAL1, is
 *                        redirected to /portal/admin/mfa on every admin route.
 *   role `dispatcher`  → 14-day grace measured from `profiles.created_at`,
 *                        with a countdown banner, then hard.
 *   carrier / shipper  → never gated (customers are out of scope for D3).
 *
 * WHAT THIS MODULE CAN AND CANNOT ENFORCE
 * ---------------------------------------
 * Supabase issues the factor and the AAL claim; this app only *reads* them.
 * Concretely:
 *   ✓ enforced here — no staff SURFACE renders below the required assurance
 *     level: every /portal/admin page runs through requireStaff/requireAdmin,
 *     which call this module before any data is fetched.
 *   ✗ NOT enforced here — the database. Postgres RLS keys off `auth.uid()`
 *     and the role, not off AAL. A stolen AAL1 access token used directly
 *     against PostgREST still passes `is_staff()`. Closing that requires
 *     AAL-aware policies on a live project (see docs/SECURITY-REVIEW.md
 *     §"Residual risks") — it cannot be written blind against a schema whose
 *     JWT shape we cannot observe.
 *   ✗ NOT enforced here — the Supabase dashboard/API surface for the project
 *     itself, which has its own MFA setting.
 *
 * GRACEFUL DEGRADATION (mandatory house rule): with placeholder or absent
 * Supabase env there is no auth service to ask, so `configured` is false, the
 * state is reported honestly to the UI and NOTHING is gated — the placeholder
 * build, unit lane and e2e lane are unaffected. Fail-open is correct here and
 * only here: without env there is no session to protect in the first place
 * (middleware already bounces every /portal subpath to /login).
 */

/** D3: dispatcher grace window, in days from profile creation. */
export const MFA_GRACE_DAYS = 14;

export type MfaRequirement = "hard" | "grace" | "none";

export interface MfaState {
  /** Is a real Supabase project reachable at all? */
  configured: boolean;
  /** At least one TOTP factor exists (any status). */
  enrolled: boolean;
  /** At least one TOTP factor is `verified`. */
  verified: boolean;
  /** Current assurance level of THIS session ("aal1" | "aal2" | null). */
  currentLevel: string | null;
  /** Highest level the user could reach by challenging a verified factor. */
  nextLevel: string | null;
  /** This role's requirement under D3. */
  requirement: MfaRequirement;
  /** Requirement met (or not applicable / not knowable). */
  satisfied: boolean;
  /** Grace deadline for dispatchers, ISO — null for other roles. */
  graceEndsAt: string | null;
  /** Whole days left in the grace window (0 once elapsed); null if N/A. */
  graceDaysLeft: number | null;
}

function unconfigured(): MfaState {
  return {
    configured: false,
    enrolled: false,
    verified: false,
    currentLevel: null,
    nextLevel: null,
    requirement: "none",
    satisfied: true,
    graceEndsAt: null,
    graceDaysLeft: null,
  };
}

/** Placeholder env (the whole test suite) has no auth service to query. */
export function isAuthConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url) && !url!.includes("placeholder");
}

/** D3 requirement for a role, given how old the account is. */
export function requirementFor(
  role: UserRole,
  profileCreatedAt: string | null,
  now: Date = new Date(),
): { requirement: MfaRequirement; graceEndsAt: string | null; graceDaysLeft: number | null } {
  if (role === "admin") {
    return { requirement: "hard", graceEndsAt: null, graceDaysLeft: null };
  }
  if (role !== "dispatcher") {
    return { requirement: "none", graceEndsAt: null, graceDaysLeft: null };
  }
  // No creation timestamp → treat the grace as already spent (fail safe:
  // never grant an unbounded exemption because a column was missing).
  const created = profileCreatedAt ? Date.parse(profileCreatedAt) : NaN;
  if (Number.isNaN(created)) {
    return { requirement: "hard", graceEndsAt: null, graceDaysLeft: null };
  }
  const endsAt = created + MFA_GRACE_DAYS * 24 * 60 * 60 * 1000;
  const msLeft = endsAt - now.getTime();
  if (msLeft <= 0) {
    return {
      requirement: "hard",
      graceEndsAt: new Date(endsAt).toISOString(),
      graceDaysLeft: 0,
    };
  }
  return {
    requirement: "grace",
    graceEndsAt: new Date(endsAt).toISOString(),
    graceDaysLeft: Math.ceil(msLeft / (24 * 60 * 60 * 1000)),
  };
}

/**
 * Read the caller's factor + assurance state from Supabase Auth.
 * Never throws: any transport/config failure degrades to "unconfigured".
 */
export async function getMfaState(
  role: UserRole,
  profileCreatedAt: string | null,
): Promise<MfaState> {
  if (!isAuthConfigured()) return unconfigured();

  try {
    const supabase = await createClient();
    const [factors, aal] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    if (factors.error || aal.error) return unconfigured();

    const totp = factors.data?.totp ?? [];
    const all = factors.data?.all ?? [];
    const enrolled = totp.length > 0 || all.length > 0;
    const verified =
      totp.some((f) => f.status === "verified") ||
      all.some((f) => f.status === "verified");
    const currentLevel = aal.data?.currentLevel ?? null;
    const nextLevel = aal.data?.nextLevel ?? null;

    const { requirement, graceEndsAt, graceDaysLeft } = requirementFor(
      role,
      profileCreatedAt,
    );
    // AAL2 is the only proof the second factor was actually used THIS session.
    const stepUpDone = currentLevel === "aal2";
    const satisfied =
      requirement === "none" ||
      requirement === "grace" ||
      (verified && stepUpDone);

    return {
      configured: true,
      enrolled,
      verified,
      currentLevel,
      nextLevel,
      requirement,
      satisfied,
      graceEndsAt,
      graceDaysLeft,
    };
  } catch {
    // Network/SDK failure — honest unknown state, never a crash.
    return unconfigured();
  }
}
