# M-84b — Production observability

**Status:** ✅ Complete · **Phase:** C (tracking completion — final module) ·
**Date:** 2026-08-11

Scope: `docs/FINAL-IMPLEMENTATION-PLAN.md` §7, Phase C module table, row M-84b —
*"Observability — Sentry wiring (not reuse: it does not exist), the 9 tracked
signals, the 'never log' enforcement, retention purger cron"*. Authority:
`docs/DIRECTIVE-tracking.md` §26.

**No migration. No route. No UI.** This module adds a transport and a
redaction layer to code that already existed.

---

## What was built

| File | Contents |
|---|---|
| `src/instrumentation.ts` | Server + edge `Sentry.init`, and Next 15's `onRequestError` |
| `src/instrumentation-client.ts` | Browser init + `onRouterTransitionStart` |
| `src/lib/observability/sentry-options.ts` | The one options object all three runtimes share; `sentryEnabled()` |
| `src/lib/observability/capture.ts` | The §26 signal transport — severity map, fingerprinting, tags |
| `src/lib/observability/scrub.ts` | §26's never-log list as pure functions |
| `tests/unit/observability-scrub.test.ts` (44) | Every §P category, each with a non-vacuity control |

Changed: `src/lib/shipments/observability.ts` (the body of `logShipmentSignal`
only), `.env.example`, `package.json`.

---

## Why

### Why the transport is separate from the vocabulary

M-72 shipped `observability.ts` with a closed nine-signal union, a fixed field
set and a `console` transport, and wrote down that M-84b would *"swap the body
of this function and NO CALL SITE CHANGES"*. That prediction held exactly: this
module adds three lines inside `logShipmentSignal` and touches no caller.

The SDK import lives in `capture.ts` rather than in `observability.ts` because
the latter is imported by the transition engine, the public lookup and the
notification worker. Those are the paths that must stay cheap and pure, and the
1,638-test unit lane should not be loading an error-monitoring SDK to assert
that a status transition is illegal.

### Why the console line stays

It is not redundancy for its own sake. `console` keeps working when Sentry is
unconfigured (every test lane and every local build), unreachable, or out of
quota — and it is what Vercel's log drain groups on. An observability design
whose only transport is a third-party service goes blind exactly when that
service is the thing having a bad day.

### Why severity is assigned per signal

All nine §26 signals are failures; they are not equally urgent. A provider
timeout is noise to review in aggregate. An `unauthorized_access_attempt` is
somebody probing the system. Sending both at the same level means the second
one is buried under the first within a week.

### Why fingerprinting is not left to Sentry

Sentry groups by stack trace. Every one of these signals is captured from the
same helper, so the default grouping would collapse all nine into a single
issue titled after `captureShipmentSignal`. Grouping on
`scope + signal + code` produces one issue per genuine failure mode, which is
what an operator can actually triage.

---

## How the never-log list is enforced

§26 and directive §P name twelve categories that must never leave the
platform. Three overlapping rules, written on the assumption that any one of
them will eventually miss:

1. **Whole containers are dropped, not filtered** — cookies, request body,
   query string, and every header except `content-type`, `user-agent` and
   `accept-language`. An allow-list is right here because the useful set is
   tiny and known.
2. **Forbidden key names, at any depth** — `password`, `token`, `cookie`,
   `session`, `access_code`, `driver_link`, `ein`, `tax_id`, `ssn`, `w9`,
   `account_number`, `routing`, `iban`, `cvv`, `api_key`, `service_role`,
   `signature`, `file_content`, `attachment`, `insurance`, `internal_message`,
   `delay_reason_internal`, `carrier_pay`, `gross_shipper_amount`, `margin`.
3. **Forbidden value shapes under innocent keys** — JWTs, `Bearer` headers,
   Stripe `sk_`/`whsec_`, PEM blocks, `token=` query strings, exact
   latitude/longitude pairs, bare EINs. This is the rule that matters most in
   practice: the realistic leak is not somebody logging a password on purpose,
   it is a driver-update URL or a provider error string quoted verbatim.

URLs keep origin and path and lose the query — which is precisely where M-76's
driver token and M-77's signed document URL live. `user` is reduced to an id:
no email, no IP address. `sendDefaultPii` stays `false`, because that single
boolean would restore the entire list. **Session Replay is deliberately not
enabled**: it records the DOM, and this DOM carries shipment addresses, contact
details and document names — §26's never-log list rendered as pixels.

**Fails closed.** A matched value is replaced wholesale rather than masked in
part, because a partial mask still discloses length, prefix and context. If
`scrubEvent` throws, the event is **discarded**, not sent unscrubbed.

### The bug the tests caught

`looksLikeCredential` lowercased the haystack but not the marker, so `eyJ` —
the base64 prefix of every JWT header, and the single most likely credential to
be quoted into an error string — never matched. The suite found it before it
shipped. Recorded here rather than quietly fixed, because it is the exact
failure mode the tests exist for: a redaction rule that looks right and does
nothing.

### Anti-vacuity

Each of the twelve categories is asserted twice: once that the scrubbed payload
does not contain the value, and once that the *unscrubbed* payload does. The
whole-event sweep has the same pair — eight secrets absent after scrubbing, all
eight present before. A redaction test that cannot fail proves nothing.

---

## Retention (§Q) — already complete, and why this module adds nothing

Stated plainly rather than padded with a second implementation: **the retention
purger was already built and already scheduled.**

| Layer | Where | Status |
|---|---|---|
| Rules | `src/lib/shipments/retention.ts` — window resolution, `retention_expires_at`, expiry predicate | M-80 |
| Executor | `purge_expired_shipment_locations()` in migration **0027** — bounded batch, `for update skip locked`, two-predicate window, returns what it did | M-80 |
| Caller | `purgeExpiredLocations()` in `src/lib/shipments/locations.ts` | M-80 |
| Schedule | `/api/cron/daily` invokes it; `vercel.json` runs that at `0 11 * * *` | M-80 |
| Safety | Shortening the window takes effect immediately; lengthening it does not resurrect rows already expired. Deletion is capped per call, so a backlog cannot lock the table | 0027 |

An earlier audit of this workspace reported "pure helper functions only, no
purger" after reading `retention.ts` alone. That was wrong, and the correction
belongs here: `retention.ts` is the *window computation*, extracted so the SQL
ladder and the TypeScript ladder can be pinned against each other. The purger
is in the migration, where a nightly sweep is one statement instead of a
paginated read/delete loop over PostgREST.

---

## DB changes

**None.**

## Endpoints

**None.** `instrumentation.ts` is a Next runtime hook, not a route.

## Env vars

| Variable | Required? | Effect |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | No | Absent, blank or containing `placeholder` → the SDK is **disabled everywhere**: no init cost, no network, no behaviour change |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | No | Overrides `VERCEL_ENV` / `NODE_ENV` |
| `NEXT_PUBLIC_SENTRY_RELEASE` | No | Overrides `VERCEL_GIT_COMMIT_SHA`. Left **undefined** when unknown rather than invented — a trace attributed to the wrong build is worse than one with no build |
| `SENTRY_AUTH_TOKEN` | No | CI source-map upload only |

The DSN is `NEXT_PUBLIC_` on purpose. A Sentry DSN is a write-only ingest key,
public by design; treating it as a secret is how projects end up with no
client-side monitoring at all.

## Deployment

Set `NEXT_PUBLIC_SENTRY_DSN` in Vercel and redeploy. Nothing else changes.
Leaving it unset is a supported production state — the platform runs
identically, with `console` as the only transport.

**Rollback: revert-only.** No schema, no data, no config. `git revert` removes
the files and the dependency.

---

## Tests

| Suite | Count | Was |
|---|---|---|
| `npm test` | **1,638** | 1,594 (+44) |
| `npm run test:rls` | 806 | unchanged — no schema change |
| `npm run test:integration` | 369 | unchanged |
| `npx playwright test` | 371 | unchanged |
| `npm run build` | 388 pages | unchanged |

`npm audit`: **0 vulnerabilities** (138 packages added).

**Honest limitations.**

- The scrubber is proved against **hand-built events**, not against payloads
  the SDK itself produces. It is the `beforeSend` contract that is tested, and
  a field the SDK attaches under a key none of the three rules match would not
  be caught. The three rules overlap specifically to make that unlikely, not
  impossible.
- **No event has been sent to a real Sentry project**, because no DSN is
  configured. What is proved: the options are well-formed, the SDK accepts
  them, the scrubber runs, and the whole thing is inert without a DSN. What is
  not proved: that Sentry ingests and groups these events as intended. That is
  a ten-minute check on the first deploy with a real DSN, and it is on the
  runbook rather than claimed here.
- Severity and fingerprint choices are **judgement**, not measurement. They
  should be revisited once there is a month of real signal volume.
