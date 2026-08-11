/**
 * The business-event taxonomy (§52, §53).
 *
 * WHY A CLOSED UNION RATHER THAN FREE STRINGS. Analytics event names scattered
 * across components rot in a specific way: two components send
 * `quote_submit` and `quote_submitted`, the dashboard counts one of them, and
 * nobody notices for a quarter because both "work". A closed union makes a
 * typo a compile error and keeps the whole taxonomy readable in one file.
 *
 * WHAT MAY BE SENT. Only the fields declared below. There is no `payload` and
 * no spread, for the same reason `logShipmentSignal` has none: §52 forbids
 * collecting shipment or document data in analytics, and the reliable way to
 * honour that is to give it nowhere to travel. No tracking number, no
 * shipment id, no email, no address, no document name, no rate. A funnel needs
 * to know that a quote was submitted, not what was in it.
 *
 * CONSENT AND CONFIGURATION ARE NOT THIS MODULE'S JOB — and that is
 * deliberate. `gtag` only exists after `ConsentAnalytics` has both a
 * measurement id AND consent. Until then `track()` finds nothing on `window`
 * and returns silently, so no call site needs a guard and none can forget one.
 */

/** Every business event the site may emit. Add here or not at all. */
export type AnalyticsEvent =
  // Quote funnel
  | "quote_view"
  | "quote_started"
  | "quote_submitted"
  | "quote_failed"
  // Carrier funnel
  | "dispatch_cta"
  | "carrier_application_started"
  | "carrier_application_submitted"
  | "new_authority_inquiry"
  // Utility and contact
  | "tracking_lookup"
  | "contact_submitted"
  | "meeting_booked"
  | "account_signup";

export const ANALYTICS_EVENTS = [
  "quote_view",
  "quote_started",
  "quote_submitted",
  "quote_failed",
  "dispatch_cta",
  "carrier_application_started",
  "carrier_application_submitted",
  "new_authority_inquiry",
  "tracking_lookup",
  "contact_submitted",
  "meeting_booked",
  "account_signup",
] as const satisfies readonly AnalyticsEvent[];

/**
 * The only parameters an event may carry. All optional, all low-cardinality,
 * none identifying.
 */
export interface AnalyticsParams {
  /** Which page the event fired from, e.g. "request-a-quote", "shippers". */
  surface?: string;
  /** A coarse failure reason — never the server's message, never user input. */
  reason?: "validation" | "rate_limited" | "turnstile" | "server";
  /** Whether the brokerage gate was open. Answers "is the funnel pre-launch?" */
  brokerage_active?: boolean;
}

type GtagFn = (
  command: "event",
  name: string,
  params?: Record<string, unknown>,
) => void;

/**
 * Send one event. Safe to call anywhere, at any time.
 *
 * Never throws: analytics that can break a submit button is worse than no
 * analytics. Never queues — an event fired before consent is an event that
 * should not exist, not one to replay later.
 */
export function track(event: AnalyticsEvent, params: AnalyticsParams = {}): void {
  try {
    if (typeof window === "undefined") return;
    const gtag = (window as unknown as { gtag?: GtagFn }).gtag;
    if (typeof gtag !== "function") return;
    gtag("event", event, { ...params });
  } catch {
    /* a funnel measurement must never be the reason a form fails */
  }
}
