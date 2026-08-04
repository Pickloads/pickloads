# M-43 — Launch runbook + module index

## What

- **`docs/LAUNCH-RUNBOOK.md`** — the single ordered path from repo to
  production: Supabase staging+prod (migrations 0001→0004 in order, seed,
  first-admin SQL snippet, `supabase gen types` replacement, auth redirect
  URLs for M-42 recovery), Vercel (full env-var table with scope +
  where-to-get-it), DNS, Resend SPF/DKIM, Turnstile, Upstash, Stripe webhook
  registration (`invoice.paid` + `invoice.payment_failed`), Dropbox Sign
  template requirements (signer role **must** be named `Carrier`) + callback
  test, `CRON_SECRET`, GA4 + Search Console. Ends with the go-live checklist
  (arch §10 legal items, `company_settings` switchboard state, content
  prerequisites: 2 blog articles, lawyer PDFs, RU/HT native review) and the
  **"day the MC activates" one-pager** (flip 3–4 settings keys, zero
  deploys).
- **`README.md`** — deployment section rewritten to point at the runbook
  with the two iron rules (service-role key never public; `NEXT_PUBLIC_*`
  inlined at build).
- **`docs/modules/INDEX.md`** — one-table summary of all modules M-00…M-43
  with phase and doc links.

## Why

The platform is code-complete and gate-green but launch depends on ~10
external services and 4 external content dependencies; the exact order (DNS
before Resend verification, template before `DROPBOX_SIGN_TEMPLATE_ID`,
redirect URLs before recovery emails work) was previously spread across 27
module docs.

No code, DB, endpoint or env changes. Gates: typecheck/lint/build/test all
green (docs-only module, run for the commit anyway).
