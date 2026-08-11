import * as Sentry from "@sentry/nextjs";

import { sharedSentryOptions } from "@/lib/observability/sentry-options";

/**
 * M-84b — server and edge error monitoring.
 *
 * Next 15 calls `register()` once per runtime before any request is served.
 * Both runtimes get the SAME options object, so the scrubbing rules cannot
 * differ between a middleware error and a route-handler error.
 *
 * With no DSN configured `enabled` is false and every call below is a no-op,
 * which is the state the test suite and every local build run in.
 */
export function register(): void {
  const runtime = process.env.NEXT_RUNTIME;
  if (runtime === "nodejs" || runtime === "edge") {
    Sentry.init(sharedSentryOptions());
  }
}

/**
 * Next 15's hook for errors thrown in server components, route handlers and
 * server actions — the ones that never reach a client error boundary and were
 * previously visible only as a 500 in a log drain.
 */
export const onRequestError = Sentry.captureRequestError;
