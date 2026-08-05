/**
 * M-69 / P-1 — newsletter unsubscribe primitives (CAN-SPAM + RFC 8058).
 *
 * Plain module (no "use server"/"use client"/"server-only") so the server
 * action, the one-click route handler, the React Email builders and the unit
 * suite all share exactly one definition of what a valid unsubscribe request
 * looks like. Nothing here touches the database or the network.
 *
 * Background: `subscribers.unsubscribed_at` has existed since 0001 and had
 * ZERO writers, while NewsletterConfirmationEmail promises "unsubscribe
 * anytime". CAN-SPAM §316.5 requires a working opt-out that needs no login
 * and no information beyond the address; Gmail/Yahoo bulk-sender rules
 * require RFC 8058 one-click on top of it.
 */

/** Public page a human lands on (locale-prefixed by next-intl navigation). */
export const UNSUBSCRIBE_PATH = "/newsletter/unsubscribe";

/** RFC 8058 endpoint mailbox providers POST to. Locale-less on purpose. */
export const UNSUBSCRIBE_API_PATH = "/api/newsletter/unsubscribe";

/** The exact body RFC 8058 §3.1 requires a one-click POST to carry. */
export const ONE_CLICK_BODY = "List-Unsubscribe=One-Click";

/** RFC 8058 §3.1 header value that opts a send into one-click. */
export const ONE_CLICK_POST_HEADER = "List-Unsubscribe=One-Click";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Accepts a token only if it is a well-formed UUID. Returns the lowercase
 * canonical form, or null. Rejecting early keeps malformed input away from
 * the database and keeps the endpoint from behaving differently for
 * "wrong shape" vs "unknown token" (both render the same honest state).
 */
export function normalizeUnsubscribeToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return UUID_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** Absolute human-facing unsubscribe URL for a given token. */
export function unsubscribeUrl(siteUrl: string, token: string): string {
  const base = siteUrl.replace(/\/+$/, "");
  return `${base}${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`;
}

/** Absolute one-click POST endpoint for a given token. */
export function oneClickUnsubscribeUrl(siteUrl: string, token: string): string {
  const base = siteUrl.replace(/\/+$/, "");
  return `${base}${UNSUBSCRIBE_API_PATH}?token=${encodeURIComponent(token)}`;
}

/**
 * RFC 8058 / RFC 2369 headers for a MARKETING-class send.
 *
 * Both members of the pair are required: `List-Unsubscribe-Post` without a
 * List-Unsubscribe URI is meaningless, and a URI without the Post header is
 * treated as a plain link (no one-click). The mailto: fallback satisfies
 * RFC 2369 for clients that cannot POST.
 *
 * Transactional mail (invoices, document review, password reset) must NOT
 * carry these — unsubscribing from a receipt is not a thing the customer can
 * be offered, and mailbox providers penalise the mismatch.
 */
export function marketingUnsubscribeHeaders(args: {
  siteUrl: string;
  token: string;
  mailto: string;
}): Record<string, string> {
  return {
    "List-Unsubscribe": `<${oneClickUnsubscribeUrl(args.siteUrl, args.token)}>, <mailto:${args.mailto}?subject=unsubscribe>`,
    "List-Unsubscribe-Post": ONE_CLICK_POST_HEADER,
  };
}

/**
 * Outcome vocabulary shared by the page, the action and the route handler.
 * `already` is a SUCCESS state, not an error: an opt-out request for an
 * address that is already opted out has been honoured, and repeating it must
 * never look like a failure (idempotency is what makes mailbox providers'
 * automatic retries safe).
 */
export type UnsubscribeOutcome =
  | "unsubscribed"
  | "already"
  | "invalid"
  | "unavailable";

/** True when the outcome means "the address is off the list". */
export function isUnsubscribeSuccess(outcome: UnsubscribeOutcome): boolean {
  return outcome === "unsubscribed" || outcome === "already";
}
