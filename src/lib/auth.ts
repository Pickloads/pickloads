import "server-only";

import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { getMfaState } from "@/lib/mfa";
import { createClient } from "@/lib/supabase/server";
import type {
  AccountStatus,
  UserRole,
} from "@/lib/supabase/database.types";

/**
 * M-23 server-side session/role helpers for the portal surface.
 *
 * Q3/RLS model: pages and CRM actions use the cookie-bound server client so
 * every read/write runs under the user's RLS policies (defense in depth) and
 * DB journaling triggers see `auth.uid()`. Middleware already bounces
 * unauthenticated /portal traffic; these helpers are the authoritative
 * server-side gate (role checks NEVER live client-side).
 */

export interface SessionProfile {
  userId: string;
  email: string | null;
  role: UserRole;
  /** M-54 (0005): account status — suspension is enforced centrally here. */
  status: AccountStatus;
  fullName: string | null;
  /** M-61: origin of the D3 dispatcher MFA grace window. */
  createdAt: string | null;
}

export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status, full_name, created_at")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return null;
  return {
    userId: user.id,
    email: user.email ?? null,
    role: profile.role,
    status: profile.status,
    fullName: profile.full_name,
    createdAt: profile.created_at,
  };
}

function localizedPath(href: string, locale: string): string {
  return getPathname({ href, locale });
}

/**
 * Page gate: any authenticated, non-suspended profile, else → /login.
 * Suspension is enforced HERE (audit §6.5) so every portal page — current
 * and future — inherits it; the login page renders the clear error state.
 */
export async function requireProfile(locale: string): Promise<SessionProfile> {
  const session = await getSessionProfile();
  if (!session) redirect(localizedPath("/login", locale));
  if (session.status === "suspended") {
    redirect(`${localizedPath("/login", locale)}?error=suspended`);
  }
  return session;
}

/**
 * Role → portal home (M-32 adds the shipper surface; M-81 the broker one).
 *
 * M-81's addition is not cosmetic. Every `requireX` gate below redirects a
 * non-matching role HERE, so before the `broker` branch existed an invited
 * partner would have been sent to `/portal/carrier`, bounced by
 * `requireCarrier` back to `portalHomeFor('broker')` — and round again. The
 * branch is what makes the three gates total over the enum rather than total
 * over four fifths of it.
 */
export function portalHomeFor(role: UserRole): string {
  if (role === "admin" || role === "dispatcher") return "/portal/admin";
  if (role === "shipper") return "/portal/shipper";
  if (role === "broker") return "/portal/broker";
  return "/portal/carrier";
}

/** M-55 page gate: carrier role only; other roles land on their own home. */
export async function requireCarrier(locale: string): Promise<SessionProfile> {
  const session = await requireProfile(locale);
  if (session.role !== "carrier") {
    redirect(localizedPath(portalHomeFor(session.role), locale));
  }
  return session;
}

/** M-55 page gate: shipper role only; other roles land on their own home. */
export async function requireShipper(locale: string): Promise<SessionProfile> {
  const session = await requireProfile(locale);
  if (session.role !== "shipper") {
    redirect(localizedPath(portalHomeFor(session.role), locale));
  }
  return session;
}

/**
 * M-81 page gate: broker role only; other roles land on their own home.
 *
 * ── THIS GATE DECIDES THE SURFACE, NOT THE DATA ─────────────────────────
 *
 * Passing it means "you are a broker user and this is your portal". It does
 * NOT mean you may read a shipment: §12's *"verified"* and *"attached to a
 * broker organization"* are ORGANIZATION facts, enforced by
 * `my_broker_partner_ids()` inside every policy, and a broker profile with no
 * verified membership passes here and then reads nothing. The pages render
 * `getBrokerPartnerState()` and say which of the two states the user is in.
 *
 * Splitting it that way is deliberate: folding verification into the gate
 * would redirect an unverified partner somewhere with no explanation, and an
 * account that silently bounces is the support call §30's honesty rule exists
 * to avoid.
 */
export async function requireBroker(locale: string): Promise<SessionProfile> {
  const session = await requireProfile(locale);
  if (session.role !== "broker") {
    redirect(localizedPath(portalHomeFor(session.role), locale));
  }
  return session;
}

/** MFA step-up / enrollment surface — the ONE staff route not MFA-gated. */
export const MFA_ROUTE = "/portal/admin/mfa";

/**
 * M-61 (audit §6.1, decision D3): central MFA enforcement for staff.
 * Every /portal/admin route funnels through requireStaff or requireAdmin, so
 * gating here covers current AND future staff pages — the same reason
 * suspension lives in requireProfile.
 *
 * Degrades to a no-op when Supabase env is absent (getMfaState reports
 * `configured:false`), keeping the placeholder-env build and e2e lanes green.
 */
async function enforceStaffMfa(
  session: SessionProfile,
  locale: string,
): Promise<void> {
  const state = await getMfaState(session.role, session.createdAt);
  if (!state.configured || state.satisfied) return;
  redirect(localizedPath(MFA_ROUTE, locale));
}

/** Page gate: staff only (admin/dispatcher); others land on their portal. */
export async function requireStaff(locale: string): Promise<SessionProfile> {
  const session = await requireStaffNoMfa(locale);
  await enforceStaffMfa(session, locale);
  return session;
}

/**
 * Staff gate WITHOUT the MFA check — for the enrollment/challenge page only.
 * Anything else must use requireStaff, or the gate has a hole.
 */
export async function requireStaffNoMfa(locale: string): Promise<SessionProfile> {
  const session = await requireProfile(locale);
  if (session.role !== "admin" && session.role !== "dispatcher") {
    redirect(localizedPath(portalHomeFor(session.role), locale));
  }
  return session;
}

/** Page gate: admin only (settings surface). */
export async function requireAdmin(locale: string): Promise<SessionProfile> {
  const session = await requireProfile(locale);
  if (session.role !== "admin") {
    redirect(localizedPath("/portal", locale));
  }
  await enforceStaffMfa(session, locale);
  return session;
}

export function isStaffRole(role: UserRole): boolean {
  return role === "admin" || role === "dispatcher";
}
