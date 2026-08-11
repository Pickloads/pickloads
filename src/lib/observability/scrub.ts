/**
 * M-84b — what must never reach the error monitor.
 *
 * WHY THIS IS A SEPARATE, PURE MODULE. §26's never-log list is a security
 * control, and a security control that only exists inside a vendor callback is
 * a security control nobody can test. Everything here is a pure function over
 * plain objects, so `tests/unit/observability-scrub.test.ts` can prove each
 * rule — including the ones that must FAIL to prove they are not vacuous —
 * without booting an SDK or reaching the network.
 *
 * DOCTRINE: DENY BY SHAPE, NOT BY NAME. `dto.ts` can allow-list because it
 * knows every column. An error event cannot: its payload is whatever a stack
 * frame, a fetch breadcrumb or a framework happened to attach. So this module
 * combines three overlapping rules, on the assumption that any one of them
 * will eventually miss:
 *
 *   1. whole containers that are never worth their risk (cookies, headers,
 *      request bodies) are DROPPED, not filtered;
 *   2. keys whose NAME implies a secret are replaced wherever they appear, at
 *      any depth;
 *   3. values whose SHAPE looks like a credential are replaced even under an
 *      innocent key — the realistic leak is a driver-update URL or a provider
 *      error string quoted verbatim into a message.
 *
 * FAIL CLOSED. A matched value is replaced wholesale, never masked in part: a
 * partial mask still discloses length, prefix and context. When recursion hits
 * its depth limit the subtree is dropped rather than passed through.
 */

/** What replaces anything that matched. Deliberately greppable in Sentry. */
export const REDACTED = "[redacted]";

/** Replaces a container we refuse to send at all. */
export const DROPPED = "[dropped: not sent to error monitoring]";

/**
 * Key names that must never carry a value off this machine, matched
 * case-insensitively as a substring so `shipperEin`, `EIN`, `ein_encrypted`
 * and `x-ein` all hit.
 *
 * Each entry is here for a named §26 / directive-P reason:
 *   password, passwd, secret, token, authorization, auth, credential, session,
 *   cookie      — authentication material of every shape;
 *   access_code, accesscode, tracking_code, public_access_hash
 *               — §4's secondary tracking credential;
 *   driver_token, driver_link
 *               — M-76's shipment-scoped driver URL, which IS the grant;
 *   ein, tax_id, ssn, w9
 *               — carrier tax identity (encrypted at rest by S-01; an error
 *                 event would be the one place it appeared in plaintext);
 *   account_number, routing, iban, card, cvv
 *               — banking details;
 *   dsn, api_key, apikey, service_role, anon_key, signature, webhook
 *               — our own outbound credentials;
 *   document, file_content, attachment, bol, pod, insurance
 *               — document CONTENT (M-77). A document *id* is safe and is
 *                 deliberately not listed; `document_id` does not match any
 *                 entry here, which the tests pin.
 *   note, internal_message, delay_reason_internal, margin, carrier_pay,
 *   gross_shipper_amount
 *               — §18 staff-only commercial data and private operator notes.
 */
export const FORBIDDEN_KEY_MARKERS = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "credential",
  "cookie",
  "session",
  "access_code",
  "accesscode",
  "tracking_code",
  "public_access_hash",
  "driver_link",
  "ein",
  "tax_id",
  "taxid",
  "ssn",
  "w9",
  "account_number",
  "routing",
  "iban",
  "cvv",
  "api_key",
  "apikey",
  "service_role",
  "anon_key",
  "signature",
  "file_content",
  "attachment",
  "insurance",
  "internal_message",
  "delay_reason_internal",
  "carrier_pay",
  "gross_shipper_amount",
  "margin",
] as const;

/**
 * Value shapes that are credentials wherever they appear. Extends the
 * `observability.ts` marker list (M-72) with the tracking-specific ones this
 * module is responsible for.
 */
export const CREDENTIAL_VALUE_MARKERS = [
  "eyJ", // JWT header
  "bearer ",
  "sk_", // Stripe secret key
  "whsec_", // Stripe webhook signing secret
  "-----begin", // PEM block
  "token=", // query-string credential
  "access_token",
  "x-signature",
  "supabase_auth_token",
] as const;

/** Latitude/longitude pair anywhere in a string — §26 forbids exact position. */
const COORD_PAIR =
  /-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g;

/** A bare EIN (`12-3456789`), which no error event has a reason to carry. */
const EIN_PATTERN = /\b\d{2}-\d{7}\b/g;

/** Recursion ceiling. Beyond it the subtree is dropped, never passed through. */
const MAX_DEPTH = 8;

export function isForbiddenKey(key: string): boolean {
  const k = key.toLowerCase();
  // "auth" alone would match "author" and "authenticated"; require a boundary.
  if (/(^|[^a-z])auth([^a-z]|$)/.test(k)) return true;
  return FORBIDDEN_KEY_MARKERS.some((marker) => k.includes(marker));
}

export function looksLikeCredential(value: string): boolean {
  const v = value.toLowerCase();
  // Both sides are lowered. Lowering only the haystack is a real bug and was
  // one here: `eyJ` — the base64 prefix of every JWT header, and the single
  // most likely credential to be quoted into an error string — never matched,
  // because the marker kept its capital J. The unit suite caught it.
  return CREDENTIAL_VALUE_MARKERS.some((marker) =>
    v.includes(marker.toLowerCase()),
  );
}

/**
 * Scrub a single string: credential-shaped content replaces the whole string;
 * otherwise coordinates and EINs are replaced in place.
 */
export function scrubString(value: string): string {
  if (looksLikeCredential(value)) return REDACTED;
  return value.replace(COORD_PAIR, REDACTED).replace(EIN_PATTERN, REDACTED);
}

/**
 * Strip a URL down to origin + path. Query strings are where tracking access
 * codes and driver tokens live, and a fragment is no safer.
 */
export function scrubUrl(url: string): string {
  const cut = url.search(/[?#]/);
  const base = cut === -1 ? url : url.slice(0, cut);
  return cut === -1 ? scrubString(base) : `${scrubString(base)}?${REDACTED}`;
}

/** Recursively scrub any JSON-ish value. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return DROPPED;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as object)) {
      out[key] = isForbiddenKey(key) ? REDACTED : scrubValue(entry, depth + 1);
    }
    return out;
  }
  // Functions, symbols, bigints: no reason to be in an event payload.
  return DROPPED;
}

/**
 * The minimal shape of the parts of a Sentry event this module touches. Typed
 * structurally rather than against the SDK so the tests need no SDK import and
 * an SDK upgrade cannot silently change what "scrubbed" means.
 */
export interface ScrubbableEvent {
  message?: string | undefined;
  request?:
    | {
        url?: string | undefined;
        query_string?: unknown;
        data?: unknown;
        cookies?: unknown;
        headers?: Record<string, string> | undefined;
      }
    | undefined;
  user?: Record<string, unknown> | undefined;
  extra?: Record<string, unknown> | undefined;
  contexts?: Record<string, unknown> | undefined;
  tags?: Record<string, unknown> | undefined;
  breadcrumbs?: Array<{ message?: string | undefined; data?: unknown }> | undefined;
  exception?:
    | {
        values?: Array<{ value?: string | undefined }> | undefined;
      }
    | undefined;
}

/**
 * Request headers worth keeping. Everything else is dropped — an allow-list is
 * correct here because the useful set is tiny and known, and because
 * `authorization`, `cookie` and Supabase's own headers are exactly what an
 * error event would otherwise carry.
 */
const SAFE_HEADERS = ["content-type", "user-agent", "accept-language"];

/**
 * The `beforeSend` / `beforeSendTransaction` body.
 *
 * Returns the event with every rule applied. Never throws: a scrubber that
 * raises inside the SDK would either lose the event or, worse, be bypassed.
 * If anything goes wrong the event is DISCARDED (`null`) rather than sent
 * unscrubbed — failing closed is the whole point.
 */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E | null {
  try {
    if (event.message !== undefined) event.message = scrubString(event.message);

    if (event.request) {
      const req = event.request;
      if (typeof req.url === "string") req.url = scrubUrl(req.url);
      // Whole containers, dropped rather than filtered.
      if ("cookies" in req) req.cookies = DROPPED;
      if ("data" in req) req.data = DROPPED;
      if ("query_string" in req) req.query_string = DROPPED;
      if (req.headers) {
        const kept: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (SAFE_HEADERS.includes(key.toLowerCase())) {
            kept[key] = scrubString(value);
          }
        }
        req.headers = kept;
      }
    }

    // Identity: an id is useful for support and carries no secret; an IP is
    // personal data §26 gives no operational reason to keep.
    if (event.user) {
      const { id } = event.user;
      event.user = id === undefined ? {} : { id: scrubValue(id) };
    }

    if (event.extra) {
      event.extra = scrubValue(event.extra) as Record<string, unknown>;
    }
    if (event.contexts) {
      event.contexts = scrubValue(event.contexts) as Record<string, unknown>;
    }
    if (event.tags) {
      event.tags = scrubValue(event.tags) as Record<string, unknown>;
    }

    if (event.breadcrumbs) {
      for (const crumb of event.breadcrumbs) {
        if (typeof crumb.message === "string") {
          crumb.message = scrubString(crumb.message);
        }
        // A breadcrumb's `data` is where fetch URLs and request bodies land.
        if (crumb.data !== undefined) crumb.data = DROPPED;
      }
    }

    if (event.exception?.values) {
      for (const value of event.exception.values) {
        if (typeof value.value === "string") {
          value.value = scrubString(value.value);
        }
      }
    }

    return event;
  } catch {
    return null;
  }
}
