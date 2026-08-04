# M-22 — E-Signature Webhook (Dropbox Sign)

**Status:** ✅ Complete · **Phase:** 2 · **Date:** 2026-08-04

## What was built
`POST /api/esign/webhook` — the receiving half of the e-sign integration
(sending lives in `src/lib/esign.ts`, wired in M-20 step 4).

Pipeline (audit S-02 hardening, in order):
1. **503 when `DROPBOX_SIGN_WEBHOOK_SECRET` unset** — honest "not configured"
   state; nothing is processed or stored.
2. **Body parsing** — Dropbox Sign's multipart `json` field, with a raw-JSON
   fallback; malformed bodies → 400.
3. **HMAC verification** — `event_hash` must equal
   HMAC-SHA256(secret, `event_time + event_type`), compared with
   `timingSafeEqual`. Bad signature → 401, never stored.
4. **`callback_test`** (the dashboard's connectivity check) → verified, 200,
   not stored.
5. **Idempotency** — insert into `webhook_events` with
   `(provider='dropbox_sign', event_id=event_hash)`; unique-violation (23505)
   → 200 immediately (duplicate delivery already handled). This is the M-01
   S-02 dedup table doing its job; Stripe (M-31) shares it.
6. **Processing** — `signature_request_signed` / `signature_request_all_signed`
   read `metadata.carrier_id` (stamped by our send call) and set
   `carriers.agreement_signed_at` (only if currently null — a re-sign never
   moves the original timestamp). All other event types are archived as
   `processed` without action.
7. **Failure path** — event row marked `failed` with the error, **alert email
   to support** (`WebhookFailureEmail`, journaled to `email_log` like every
   send), and a 500 so Dropbox Sign retries with backoff.

Every accepted 200 body is `"Hello API Event Received"` (Dropbox Sign
requires the literal string to consider the callback delivered).

## Judgment calls
- `event_hash` doubles as the dedup `event_id`: it is unique per event
  delivery group (hash of time+type) and is what Dropbox Sign retries with.
- Signed-event with missing/invalid `metadata.carrier_id` is treated as a
  processing failure (alert + retry) rather than silently ignored — it means
  a signature request was created outside the app flow; ops should know.
- No admin client (secretless env) → 503: without storage there is no dedup,
  so asking the provider to retry later is the safe behavior.

## DB changes
None. Writes: `webhook_events`, `carriers.agreement_signed_at`, `email_log`.

## Endpoints
`POST /api/esign/webhook` (force-dynamic; `/api` is already excluded from
middleware, robots and sitemap).

## Env vars
`DROPBOX_SIGN_WEBHOOK_SECRET` — per Dropbox Sign docs this is the account
API key unless an app-specific one is issued. Optional; 503 without it.

## Deployment
In the Dropbox Sign web app: Settings → API → Event callback URL →
`https://pickloads.com/api/esign/webhook`; press "Test" (expects the
`callback_test` 200) after setting the env var in Vercel.

## Verification
typecheck ✓ · lint ✓ · build ✓ · local smoke: unset secret → 503; bad
signature → 401; valid `callback_test` HMAC → 200 "Hello API Event Received" ✓

## Extension points
- Stripe webhook (M-31) copies this shape: verify → dedupe via
  `webhook_events` → process → alert-on-failure.
- The admin Notifications feed (M-24+) lists `webhook_events` rows with
  `status='failed'` for triage.
