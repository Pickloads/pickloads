import type { DriverTokenView } from "@/lib/shipments/types";

/**
 * M-76 — the PURE half of the §13 driver-link vocabulary.
 *
 * A plain module (no `server-only`, no `node:crypto`) so client components can
 * import it. `driver-token.ts` holds everything that touches
 * `DRIVER_TOKEN_SECRET` and re-exports this file, so server callers still have
 * a single import; the split exists because the carrier portal and the
 * dispatcher board both render "Active / Expired / Revoked" beside a list of
 * links, both are client components, and a second copy of that precedence rule
 * in JSX is the drift that would eventually disagree with 0023's
 * `redeem_shipment_driver_token`.
 *
 * NOTHING HERE TOUCHES A TOKEN. Every function takes a row (or a row's
 * lifecycle fields) and returns a fact about it. `maskDriverToken` returns a
 * fixed mask with no characters of the credential at all.
 */

/**
 * What a link is right now, as a closed vocabulary.
 *
 * `revoked` outranks `expired` deliberately: both stop the link working, but
 * "somebody killed this" and "this aged out" are different operational
 * stories, and a dispatcher looking at a list needs to see which one happened.
 * 0023's `redeem_…` applies the same precedence, and the unit suite asserts
 * the two agree.
 */
export type DriverTokenState = "active" | "expired" | "revoked";

export interface DriverTokenLifecycle {
  revoked_at: string | null;
  expires_at: string;
}

export function driverTokenState(
  token: DriverTokenLifecycle,
  now: Date = new Date(),
): DriverTokenState {
  if (token.revoked_at !== null) return "revoked";
  return Date.parse(token.expires_at) <= now.getTime() ? "expired" : "active";
}

/** Convenience for surfaces that only need the yes/no. */
export function isDriverTokenUsable(
  token: DriverTokenLifecycle,
  now: Date = new Date(),
): boolean {
  return driverTokenState(token, now) === "active";
}

/**
 * Minutes of life left, floored at zero. Rendered on the issuing surfaces so
 * a dispatcher can see "this link dies in 40 minutes" before they text it.
 */
export function driverTokenMinutesRemaining(
  token: DriverTokenLifecycle,
  now: Date = new Date(),
): number {
  if (token.revoked_at !== null) return 0;
  const ms = Date.parse(token.expires_at) - now.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 60_000);
}

/**
 * The URL path a token is presented at.
 *
 * One function, so the shape lives in one place and the locale prefix is the
 * caller's problem (`getPathname` from `@/i18n/navigation` handles it on the
 * server, exactly as every other internal link does). No origin is baked in:
 * a hard-coded host is how a staging link ends up in a production text
 * message.
 */
export function driverUpdatePath(token: string): string {
  return `/driver/update/${token}`;
}

/**
 * Redact a token for logging and for anything an operator reads.
 *
 * §26's never-log list names access tokens outright, and `logShipmentSignal`
 * has no parameter one could arrive through — this exists for the one place
 * where a human is looking at a list of links and needs to tell them apart
 * without the credential being on screen. It returns a fixed mask with NO
 * characters of the token at all: a prefix would be a partial credential, and
 * on a 43-character alphabet even four characters narrows a search.
 */
export function maskDriverToken(): string {
  return "••••••••";
}

/** A link's operator-facing identity: the row id, never the token. */
export function driverTokenLabel(token: Pick<DriverTokenView, "id">): string {
  return token.id.slice(0, 8);
}
