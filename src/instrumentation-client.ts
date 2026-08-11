import * as Sentry from "@sentry/nextjs";

import { sharedSentryOptions } from "@/lib/observability/sentry-options";

/**
 * M-84b — browser error monitoring.
 *
 * Same options as the server (see `sentry-options.ts`), plus two client-only
 * exclusions:
 *
 *   * Session Replay is NOT enabled. It records the DOM, and this app's DOM
 *     contains shipment addresses, contact details and document names —
 *     §26's never-log list rendered as pixels.
 *   * `sendDefaultPii` stays false, so no IP address is attached.
 */
Sentry.init(sharedSentryOptions());

/** Required by Next 15 to report client-side navigation spans. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
