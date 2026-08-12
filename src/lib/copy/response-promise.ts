/**
 * What we tell a customer about when they will hear back.
 *
 * ── WHY THIS IS A CONSTANT AND NOT A STRING IN THREE COMPONENTS ──────────
 *
 * The quote form renders on `/shippers`, on `/request-a-quote` and (in its
 * authenticated form) in the shipper portal. Before this, each carried its own
 * sentence, and they had already drifted: the public form promised a reply
 * "within one business hour (Mon–Sat)" while the portal promised "usually
 * within one business hour (8am–6pm ET)". Same company, same action, two
 * different commitments depending on which page you happened to be on.
 *
 * A shared convention would not have prevented that. A shared constant does.
 *
 * ── THE TIMING, AND WHY IT READS THE WAY IT DOES (owner, 2026-08-12) ─────
 *
 * The site used to promise a callback "within 15 minutes". That is a
 * guarantee, in the strongest word available, against an SLA nobody had
 * agreed to — no staffed window, no owned queue, no way to know when it was
 * missed. It is gone from every public surface.
 *
 * Fifteen minutes still exists: as an INTERNAL target on the staff lead
 * notification email, where it is an instruction to a person rather than a
 * commitment to a customer. That distinction is the whole decision — an
 * operational KPI and a public promise are different objects, and only one of
 * them belongs in marketing copy.
 *
 * What replaced it is deliberately hedged: "typically", and "during business
 * hours". Both words are load-bearing. "Typically within the hour" describes
 * what usually happens; "guaranteed within one hour" would recreate exactly
 * the problem that was just removed, with a friendlier number. Do not let
 * this sentence drift toward a guarantee.
 *
 * ── IF THIS CHANGES AGAIN ────────────────────────────────────────────────
 *
 * Change this constant, add the new English string to the locale catalogues
 * for all five languages, and every surface follows in one commit. Do not
 * state a response time anywhere else.
 */

/**
 * The approved sentence. Owner-approved wording — do not edit casually, and
 * in particular do not turn "typically" into "guaranteed".
 */
export const RESPONSE_PROMISE =
  "We respond fast — typically within the hour during business hours.";

/** The same promise, prefixed for a confirmation state. */
export const RESPONSE_PROMISE_RECEIVED = `✓ RECEIVED — ${RESPONSE_PROMISE}`;

/** Where to go if someone does not want to wait at all. */
export const CONTACT_NOW =
  "Questions now? Call (908) 404-5373 or email support@pickloads.com";
