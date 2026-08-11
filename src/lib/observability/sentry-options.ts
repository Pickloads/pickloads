import { scrubEvent } from "./scrub";

/**
 * M-84b — the options every Sentry entry point shares.
 *
 * WHY ONE MODULE. Sentry initialises in three places (server, edge, browser).
 * Three copies of a `beforeSend` is three chances for one of them to be the
 * unscrubbed one, and the one that drifts is always the one nobody reads.
 *
 * GRACEFUL WITHOUT A DSN. `enabled` is false when the DSN is absent or still
 * the `.env.example` placeholder, so every `Sentry.*` call becomes a no-op.
 * That is the state the whole test suite and every local build runs in, and it
 * must never be a crash — §26's transport is an aid, not a dependency.
 */

/** True only when a usable DSN is configured. */
export function sentryEnabled(dsn: string | undefined): boolean {
  if (!dsn) return false;
  const trimmed = dsn.trim();
  if (trimmed === "") return false;
  // `.env.example` ships the key with no value; `.env.e2e` omits it entirely.
  // A literal "placeholder" follows the convention the rest of the app uses.
  return !trimmed.toLowerCase().includes("placeholder");
}

/**
 * `NEXT_PUBLIC_` because the browser bundle needs it too. A Sentry DSN is a
 * write-only ingest key and is public by design — it is not a secret, and
 * treating it as one is how projects end up with no client-side monitoring.
 */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

/**
 * The options object, with its type INFERRED rather than declared.
 *
 * `scrubEvent` is generic (`<E extends ScrubbableEvent>(e: E) => E | null`) so
 * that the SDK's concrete `ErrorEvent` and `TransactionEvent` flow straight
 * through it. Pinning an explicit interface here would collapse that generic
 * to `ScrubbableEvent` and the options would no longer satisfy `Sentry.init` —
 * which is a real incompatibility, not a typing nuisance: it would mean the
 * scrubber returning an object the SDK does not consider a complete event.
 */
export function sharedSentryOptions() {
  return {
    dsn: SENTRY_DSN,
    enabled: sentryEnabled(SENTRY_DSN),

    // Environment tagging (§P). Vercel sets VERCEL_ENV to
    // production/preview/development; NODE_ENV is the local fallback.
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ??
      process.env.VERCEL_ENV ??
      process.env.NODE_ENV ??
      "development",

    // Release tagging (§P). Vercel exposes the commit SHA; without it the
    // release is left undefined rather than invented, so a stack trace is
    // never attributed to a build that did not produce it.
    release:
      process.env.NEXT_PUBLIC_SENTRY_RELEASE ??
      process.env.VERCEL_GIT_COMMIT_SHA,

    // Errors are the point; traces are sampled thinly. A brokerage platform
    // with no traffic yet does not need 100% transaction volume, and the quota
    // is better spent on errors.
    tracesSampleRate: 0.1,

    // NEVER true. `sendDefaultPii` attaches IPs, cookies and request bodies —
    // precisely §26's never-log list, added back by a single boolean.
    sendDefaultPii: false as const,

    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
  };
}
