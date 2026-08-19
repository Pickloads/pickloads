import "server-only";

import { cookies } from "next/headers";

/**
 * M-94 §3/§17 — where the pre-registration id lives between server actions.
 *
 * ── WHY A COOKIE AND NOT A HIDDEN FIELD ──────────────────────────────────
 *
 * 0032 designed the pre-registration id as "the applicant's only credential"
 * — an opaque, unguessable, expiring bearer id. A hidden `<input>` would have
 * worked, and it is what the old wizard did with `carrierId`. This is better
 * for one specific reason: an httpOnly cookie is not readable by page script,
 * not copyable out of the DOM by an extension or a screenshot, and not
 * something a user can paste to somebody else by "sharing the link".
 *
 * What it is NOT is a security boundary on its own. The cookie only names a
 * row; every decision is re-read from that row on every use
 * (`loadEligiblePreRegistration`). A forged or stolen cookie buys nothing a
 * forged hidden field would not have, and both are refused by the same check —
 * which is the point of §17: eligibility is a server-side fact about a stored
 * record, never an assertion carried by the request.
 *
 * ── SCOPE AND LIFETIME ───────────────────────────────────────────────────
 *
 * `sameSite: "lax"` (the wizard is same-site throughout, and lax still
 * survives the top-level navigation back from a future Stripe Checkout in
 * M-95). `secure` in production only, because the e2e lane and local dev serve
 * plain HTTP and a secure cookie there is a cookie that silently never
 * arrives. Thirty days matches 0032's `expires_at` default; the DATABASE
 * expiry is the one that is enforced, and this is only housekeeping so a stale
 * cookie stops being sent.
 */

export const PRECHECK_COOKIE = "pl_precheck";

/** 30 days, matching the 0032 `expires_at` default. */
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export async function setPrecheckCookie(preRegistrationId: string): Promise<void> {
  const store = await cookies();
  store.set(PRECHECK_COOKIE, preRegistrationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function readPrecheckCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(PRECHECK_COOKIE)?.value ?? null;
}

/**
 * Cleared once the pre-registration has been spent on a carrier account.
 *
 * Not a security control — the claim in the database is what stops a second
 * account (§18) — but leaving a spent id in the browser means the next visit
 * presents a credential that can only ever be refused, and the refusal would
 * read to the applicant as a broken site.
 */
export async function clearPrecheckCookie(): Promise<void> {
  const store = await cookies();
  store.delete(PRECHECK_COOKIE);
}
