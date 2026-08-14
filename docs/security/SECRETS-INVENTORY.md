# PickLoads — Secrets Inventory

**Variable NAMES only. No values appear in this file and none ever may.**

## Server-only secrets

Each is referenced in exactly one module, and every one of those modules
begins with `import "server-only"` — a build-time failure if a client
component ever pulls it in.

| Name                          | Sole reference                                    | Blast radius if leaked                  |
| ----------------------------- | ------------------------------------------------- | --------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`   | `src/lib/supabase/admin.ts`                       | **Root.** Full read/write, bypasses RLS |
| `PII_ENCRYPTION_KEY`          | `src/lib/crypto.ts`                               | Decrypts stored EIN / bank fields       |
| `TRACKING_ACCESS_SECRET`      | `src/lib/shipments/access-code.ts`                | Forge public tracking access codes      |
| `DRIVER_TOKEN_SECRET`         | `src/lib/shipments/driver-token.ts`               | Forge driver update links               |
| `CRON_SECRET`                 | `src/app/api/cron/{daily,notifications}/route.ts` | Trigger jobs / mail sends               |
| `TURNSTILE_SECRET_KEY`        | `src/lib/turnstile.ts`                            | Bypass bot protection                   |
| `RESEND_API_KEY`              | `src/lib/email/send.ts`                           | Send mail as the domain                 |
| `UPSTASH_REDIS_REST_TOKEN`    | `src/lib/rate-limit.ts`                           | Read/flush rate-limit state             |
| `STRIPE_SECRET_KEY`           | `src/lib/stripe.ts`                               | Stripe account access                   |
| `STRIPE_WEBHOOK_SECRET`       | `src/app/api/stripe/webhook/route.ts`             | Forge payment events                    |
| `DROPBOX_SIGN_API_KEY`        | `src/lib/esign.ts`                                | Send/read signature requests            |
| `DROPBOX_SIGN_WEBHOOK_SECRET` | `src/app/api/esign/webhook/route.ts`              | Forge signature events                  |
| `SIGNWELL_API_KEY`            | `src/lib/signwell.ts`                             | Read/download signed documents          |
| `SIGNWELL_WEBHOOK_ID`         | `src/lib/signwell.ts`                             | **Forge signature events** — see below  |
| `SENTRY_AUTH_TOKEN`           | build only (`.env.example`)                       | Upload source maps                      |

## Public by design (`NEXT_PUBLIC_*`, inlined into browser bundles)

`NEXT_PUBLIC_SITE_URL` · `NEXT_PUBLIC_SUPABASE_URL` ·
`NEXT_PUBLIC_SUPABASE_ANON_KEY` · `NEXT_PUBLIC_TURNSTILE_SITE_KEY` ·
`NEXT_PUBLIC_GA4_MEASUREMENT_ID` · `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY` ·
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` · `NEXT_PUBLIC_SENTRY_DSN` ·
`NEXT_PUBLIC_SENTRY_ENVIRONMENT` · `NEXT_PUBLIC_SENTRY_RELEASE`

The anon key is _meant_ to be public — it is a claim of "no identity", and RLS
is what constrains it. Verified: `anon` reads 0 rows from every sensitive
table (`RLS-SECURITY-REVIEW.md`).

**No server secret is prefixed `NEXT_PUBLIC_`.** Verified by name inspection
of all 31 referenced variables.

## Non-secret operational

`DRIVER_TOKEN_TTL_HOURS` · `DROPBOX_SIGN_TEMPLATE_ID` ·
`DROPBOX_SIGN_TEST_MODE` · `EMAIL_FROM` · `EMAIL_INTERNAL_TO` ·
`NODE_ENV` · `VERCEL_ENV` · `VERCEL_GIT_COMMIT_SHA` · `NEXT_RUNTIME`

## Verification performed

| Check                                                                                          | Result                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full history scan (`git log --all -p`) for JWTs, `sk_live_`, `re_`, `ghp_`, `AKIA`, PEM blocks | **Clean.** Every hit is a deliberate test fixture asserting that such strings get scrubbed from logs, plus one npm lockfile integrity hash                                                           |
| Committed `.env` files                                                                         | Only `.env.e2e`, committed on purpose; contains placeholders chosen so the app takes its graceful-degradation path. Its own header documents this                                                    |
| `.env.local` ignored                                                                           | Yes (`.env*` with a `!.env.e2e` exception)                                                                                                                                                           |
| `supabase/.temp` ignored                                                                       | **Now yes** (SEC-P3-01, fixed this audit). It held a project ref and a pooler URL — no password, no token                                                                                            |
| Client bundle scan (`.next/static`)                                                            | Three matches, all false positives: an admin UI label naming `STRIPE_SECRET_KEY`, and the observability scrub denylist which lists `service_role`/`api_key` as terms to redact. **No secret value.** |
| `server-only` on every secret-holding module                                                   | 12 / 12                                                                                                                                                                                              |

## Rotation

No rotation has been performed and none is required by this audit — no
exposure was found. Rotate on: staff offboarding, suspected exposure, or any
of the incidents in `INCIDENT-RESPONSE-PLAN.md`.

Rotation order when the service-role key is involved: rotate in Supabase →
update Vercel Production → redeploy → verify cron + webhooks → revoke old.
Expect webhook and cron failures in the window; they retry.

## `SIGNWELL_WEBHOOK_ID` is a secret, not an identifier

It is the HMAC key for SignWell event-hash verification. SignWell's own docs
call it "the Webhook ID sent in the webhook POST resource", which reads like
metadata and is not — an implementation that takes the key from the request it
is authenticating lets a caller supply key and hash together, and every forgery
verifies.

Store it, scope it and rotate it exactly as you would an API key. It never
appears in a request body, a log line, or a client bundle
(`tests/unit/signwell-webhook.test.ts` enforces the first).

## Standing rules

1. Never add a server secret under `NEXT_PUBLIC_*`.
2. Every new secret-reading module starts with `import "server-only"`.
3. Never log a secret. The observability denylist is not a licence to try.
4. This file records names. If a value ever appears here, treat it as leaked.
