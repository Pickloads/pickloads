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
 * ── WHY THE TIMING PROMISE WENT AWAY ─────────────────────────────────────
 *
 * A stated response time is an operational commitment, not marketing copy. It
 * is only honest if there is a real SLA behind it — staffed hours, a queue
 * someone owns, and a way to know when it was missed. None of that is
 * established yet, so the site no longer states one.
 *
 * This is the same standard the rest of the platform already holds itself to:
 * MC and USDOT render as "pending" rather than as numbers, testimonials render
 * nothing rather than invented praise, and the tracking page says plainly that
 * it does not show a live GPS position. A response-time guarantee nobody has
 * agreed to is the same kind of claim.
 *
 * ── IF AN SLA IS ESTABLISHED LATER ───────────────────────────────────────
 *
 * Change this constant, add the new English string to `SUPPLEMENTAL` in
 * `scripts/extract-i18n.mjs` with real es/fr, regenerate the catalogues, and
 * every surface follows in one commit. Do not reintroduce a time anywhere else.
 */

/** The approved sentence. Business-approved wording — do not edit casually. */
export const RESPONSE_PROMISE =
  "A PickLoads representative will review your request and follow up with you promptly.";

/** The same promise, prefixed for a confirmation state. */
export const RESPONSE_PROMISE_RECEIVED = `✓ RECEIVED — ${RESPONSE_PROMISE}`;

/** Where to go if someone does not want to wait at all. */
export const CONTACT_NOW =
  "Questions now? Call (908) 404-5373 or email support@pickloads.com";
