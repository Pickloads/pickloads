"use server";

import { headers } from "next/headers";
import { field, guardPublicForm, GUARD_MESSAGES } from "@/lib/forms/guard";
import { publicTrackingLookupSchema } from "@/lib/validation/public-tracking";
import {
  lookupPublicTracking,
  recordRateLimitedAttempt,
  TRACK_RATE_LIMIT,
  TRACK_RATE_LIMIT_FORM,
} from "@/lib/shipments/public-lookup";
import {
  trackingError,
  type TrackingLookupState,
} from "@/lib/shipments/public-tracking-state";

/**
 * M-73 — the `/track` lookup server action (`docs/DIRECTIVE-tracking.md` §19).
 *
 * THE GUARD STACK, in the order §19 and CLAUDE.md's security model require:
 *
 *   1. rate limit, per IP, TIGHTER than the form default;
 *   2. Turnstile, verified server-side;
 *   3. Zod;
 *   4. constant-time comparison of the secondary value — inside
 *      `lookupPublicTracking`, which is the only thing that ever holds the
 *      service-role client;
 *   5. `toPublicTrackingDto`.
 *
 * Nothing here reads a shipment. This file's whole job is the first three
 * steps and the translation of a lookup result into a `useActionState` value;
 * `src/lib/shipments/public-lookup.ts` owns the rest, so the security-critical
 * path has one home rather than being spread across an action and a helper.
 *
 * ── WHY A SERVER ACTION AND NOT A ROUTE HANDLER ───────────────────────────
 *
 * §19 permits either. A server action is chosen because of what it does NOT
 * create: no URL. A `GET /api/track?number=…&zip=…` would put both factors in
 * a location bar, a browser history, a `Referer` header and any corporate
 * proxy log between the customer and us — and would hand search engines a
 * crawlable result page, which item 7 of this module's scope forbids. A POST
 * action leaves the address bar on `/track` for every visitor, which is the
 * strongest possible version of "individual results are never indexed": there
 * is no address to index.
 *
 * It also inherits the repo's existing pipeline (`guardPublicForm`) rather
 * than re-implementing rate limiting and Turnstile at a second call site,
 * which the executive directive's no-duplicate-APIs rule requires.
 */

export async function lookupTracking(
  _prev: TrackingLookupState,
  formData: FormData,
): Promise<TrackingLookupState> {
  const rawNumber = field(formData, "tracking_number");
  // `headers()` is request-scoped and memoized, so reading it here as well as
  // inside the guard costs nothing and keeps the rate-limited branch able to
  // attribute its ledger row (the guard's failure result carries no IP).
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  const userAgent = h.get("user-agent");

  const guard = await guardPublicForm(
    TRACK_RATE_LIMIT_FORM,
    formData,
    TRACK_RATE_LIMIT,
  );
  if (!guard.ok) {
    if (guard.message === GUARD_MESSAGES.rate_limit) {
      // §26: the burst has to reach the ledger, or the signal it exists to
      // raise under-reports exactly the attack it is watching for.
      await recordRateLimitedAttempt(rawNumber, ip, userAgent);
      return trackingError("rate_limited");
    }
    return trackingError("turnstile");
  }

  const parsed = publicTrackingLookupSchema.safeParse({
    tracking_number: rawNumber,
    secondary: field(formData, "secondary"),
  });
  if (!parsed.success) return trackingError("invalid");

  const result = await lookupPublicTracking({
    trackingNumber: parsed.data.tracking_number,
    secondaryValue: parsed.data.secondary,
    ip: guard.ip === "unknown" ? null : guard.ip,
    userAgent,
  });

  if (!result.ok) {
    return trackingError(result.code === "refused" ? "refused" : "unavailable");
  }

  return {
    status: "success",
    tracking: result.tracking,
    timelineTruncated: result.timelineTruncated,
  };
}
