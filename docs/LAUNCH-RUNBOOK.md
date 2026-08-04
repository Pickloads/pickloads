# PickLoads — Launch Runbook

Exact, ordered steps to take pickloads.com live. Work top to bottom; each
step lists what to do, where, and which env var it produces. The app
degrades gracefully when a secret is missing (dev warnings, honest pending
states) — so a partial deploy never crashes, it just quietly disables the
affected integration. **Production must have every var set.**

---

## 1. Supabase — staging + production projects

Create **two** projects at [supabase.com/dashboard](https://supabase.com/dashboard)
(org: PickLoads Logistics Group): `pickloads-staging` and `pickloads-prod`,
region `us-east-1` (closest to NJ ops). For **each** project, in order:

1. **Apply migrations in order** — SQL Editor (or `supabase db push` with the
   CLI linked to the project). Order matters:
   1. `supabase/migrations/0001_types_and_tables.sql` (enums, 13 tables, triggers)
   2. `supabase/migrations/0002_rls.sql` (RLS on all tables — no anon insert policies by design)
   3. `supabase/migrations/0003_auth_and_journal.sql` (signup → profile trigger, CRM status journaling)
   4. `supabase/migrations/0004_storage.sql` (private `carrier-docs` bucket + storage policies)
2. **Seed** — run `supabase/seed.sql` (idempotent, `on conflict do nothing`).
   Seeds the 8 `company_settings` keys with launch-safe defaults: MC/USDOT
   "pending", brokerage off, testimonials hidden, sample ticker, packet
   downloads off.
3. **Auth configuration** — Authentication → URL Configuration:
   - Site URL: `https://pickloads.com` (staging: the Vercel preview domain).
   - Redirect URLs: `https://pickloads.com/**` — required for the M-42
     password-recovery `redirectTo` (`/reset-password` and its locale
     variants) to be honored.
   - Email templates: brand the "Reset Password" template at minimum.
4. **Create the first admin** — Authentication → Users → *Add user* (enter
   email + strong password, check *Auto Confirm*). The `on_auth_user_created`
   trigger creates the `profiles` row (role defaults to `carrier`). Promote
   it in the SQL Editor:

   ```sql
   update public.profiles
   set role = 'admin', full_name = 'Emmanuel Larocque'
   where id = (select id from auth.users where email = 'admin@pickloads.com');
   ```

   Verify: sign in at `/login` → you should land in the admin dashboard.
   All further staff (`dispatcher` role) are promoted the same way (invite-
   only by design, audit S-04 — there is no self-serve staff signup).
5. **Regenerate DB types** (once, against either project — schemas are
   identical). Replaces the committed placeholder-typed file:

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts
   npm run typecheck   # must stay green; commit the regenerated file
   ```
6. Collect the three keys (Settings → API): Project URL, `anon` key,
   `service_role` key → env table below. **The service-role key is
   server-only — never expose it with a `NEXT_PUBLIC_` prefix.**

## 2. Vercel project

1. Import the Git repo at [vercel.com/new](https://vercel.com/new) — framework
   auto-detects Next.js; no build overrides needed (`npm run build`).
2. Set environment variables per the table below. Scope **Preview** to the
   staging Supabase project and test-mode keys; **Production** to the prod
   project and live keys. `vercel.json` registers the daily cron
   automatically on deploy.
3. Deploy once to a preview URL and click through: home, `/es`, quick-quote
   submit, `/become-a-carrier` wizard (secretless steps warn but complete),
   `/login`.

### Environment variable table

| Name | Scope | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | build/public | `https://pickloads.com` (prod) / preview URL (staging) — drives canonical URLs, sitemap, hreflang |
| `NEXT_PUBLIC_SUPABASE_URL` | build/public | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | build/public | Supabase → Settings → API → `anon` key |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | Supabase → Settings → API → `service_role` key |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | build/public | Cloudflare → Turnstile → widget for `pickloads.com` |
| `TURNSTILE_SECRET_KEY` | server only | same Turnstile widget |
| `UPSTASH_REDIS_REST_URL` | server only | Upstash → Redis DB → REST API |
| `UPSTASH_REDIS_REST_TOKEN` | server only | same |
| `RESEND_API_KEY` | server only | Resend → API Keys (after domain verifies) |
| `EMAIL_FROM` | server only | `PickLoads <notifications@pickloads.com>` |
| `EMAIL_INTERNAL_TO` | server only | `support@pickloads.com` (lead/quote notifications) |
| `PII_ENCRYPTION_KEY` | server only | generate: `openssl rand -base64 32` — **required before first real carrier: EINs are dropped, not stored, without it** |
| `DROPBOX_SIGN_API_KEY` | server only | Dropbox Sign → Settings → API |
| `DROPBOX_SIGN_WEBHOOK_SECRET` | server only | = API key unless a dedicated app secret is configured |
| `DROPBOX_SIGN_TEMPLATE_ID` | server only | template created in step 7 |
| `DROPBOX_SIGN_TEST_MODE` | server only | `true` on staging, **unset/`false` in production** |
| `STRIPE_SECRET_KEY` | server only | Stripe → Developers → API keys (test key on staging, live on prod) |
| `STRIPE_WEBHOOK_SECRET` | server only | signing secret from step 8 |
| `CRON_SECRET` | server only | generate: `openssl rand -hex 32` — Vercel Cron sends it as the Bearer token automatically |
| `NEXT_PUBLIC_GA4_MEASUREMENT_ID` | build/public | GA4 admin (step 10) — fires only after cookie consent (S-05) |
| `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY` | build/public | Google Cloud → Maps Embed API key, HTTP-referrer-restricted to pickloads.com |
| `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_AUTH_TOKEN` | public / CI | Sentry project (optional at launch, decision Q8) |

> Build-time note: `NEXT_PUBLIC_*` values are inlined at build; changing them
> requires a redeploy, not just a restart.

## 3. DNS + domain

1. Vercel project → Domains → add `pickloads.com` and `www.pickloads.com`
   (www → apex redirect).
2. At the registrar, either delegate nameservers to Vercel or set
   `A @ → 76.76.21.21` and `CNAME www → cname.vercel-dns.com`.
3. Wait for the certificate to issue; verify `https://pickloads.com` and that
   HSTS is present (configured in `next.config.ts`).

## 4. Resend — email domain (SPF/DKIM)

1. Resend → Domains → Add `pickloads.com`, sending region us-east.
2. Add the DNS records Resend displays at the registrar/Vercel DNS —
   typically: TXT SPF on the `send` subdomain (`v=spf1 include:amazonses.com
   ~all`), MX on `send`, and the `resend._domainkey` TXT (DKIM). Verify in
   the Resend dashboard.
3. Create the API key → `RESEND_API_KEY`. Send a test through the contact
   form and check the admin Notifications feed (`email_log`).

## 5. Cloudflare Turnstile

Cloudflare dashboard → Turnstile → Add widget: domain `pickloads.com`
(+ the Vercel preview domain on the staging widget), Managed mode. Copy the
site key (public) and secret. The widget renders on every public form;
server-side verification fails closed once the secret is set.

## 6. Upstash Redis (rate limiting)

Upstash console → Create Redis database (region us-east-1, TLS). Copy the
REST URL + token. Limits are 5 requests/10 min per IP per form (uploads
wider) — sliding window, fail-open on outage by design.

## 7. Dropbox Sign (e-sign)

1. Upload the **lawyer-approved dispatch agreement** as a template. **The
   signer role must be named exactly `Carrier`** — the API call fills
   `signers[Carrier][name|email_address]` and breaks with any other role
   name. Merge fields as documented in `docs/modules/M-22-esign-webhook.md`.
2. Copy the template ID → `DROPBOX_SIGN_TEMPLATE_ID`; API key →
   `DROPBOX_SIGN_API_KEY` (+ webhook secret).
3. Settings → API → Event callback URL:
   `https://pickloads.com/api/esign/webhook`, then press **Test** — expects
   the `callback_test` 200 ("Hello API Event Received").
4. Production: ensure `DROPBOX_SIGN_TEST_MODE` is unset/`false`.

## 8. Stripe (dispatch-fee invoicing)

1. Activate the live account; copy the live secret key.
2. Developers → Webhooks → Add endpoint
   `https://pickloads.com/api/stripe/webhook`, events: **`invoice.paid`** and
   **`invoice.payment_failed`**. Copy the signing secret →
   `STRIPE_WEBHOOK_SECRET`.
3. Compliance guard is code-enforced: invoices carry ONLY the dispatch fee
   line (never freight charges) — see `src/lib/stripe.ts`.

## 9. Cron (O-01 daily ops alerts)

Set `CRON_SECRET` in Vercel and deploy — `vercel.json` schedules
`GET /api/cron/daily` at 11:00 UTC (insurance-expiry threshold alerts +
callback digest). Verify once manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://pickloads.com/api/cron/daily
```

## 10. GA4 + Search Console

1. GA4: create the property, Web stream for `https://pickloads.com` →
   measurement ID → `NEXT_PUBLIC_GA4_MEASUREMENT_ID` → redeploy. The tag
   loads **only after cookie-consent accept** (audit S-05) — verify in
   Realtime after accepting the banner.
2. Search Console: verify the domain property (DNS TXT), submit
   `https://pickloads.com/sitemap.xml`, confirm hreflang pages index.

---

## Go-live checklist (block launch until all checked)

**Legal (arch §10) — external dependency: lawyer**
- [ ] Privacy policy, Terms of service, Cookie policy delivered and pasted
      into `/legal/*` pages; remove their `noindex` once counsel-approved.
- [ ] Carrier agreement + dispatch agreement finalized → Dropbox Sign
      template (step 7) rebuilt from the final text.
- [ ] Lawyer-approved carrier packet PDFs uploaded → flip
      `packet_downloads_live` to `true`.
- [ ] ESIGN consent language reviewed (onboarding step 4 checkbox).

**company_settings switchboard (admin → Settings, seeded pending-safe)**
- [ ] `mc_number` / `usdot_number` — stay `pending` until FMCSA grants; see
      the one-pager below.
- [ ] `bond_status` — `in_process` until BMC-84 is filed.
- [ ] `brokerage_active` — `false` until MC + bond are live (gates all
      shipper "brokerage live" messaging).
- [ ] `testimonials_visible` — `false` until 5+ verified reviews exist.
- [ ] `stats` — replace nulls with real figures when available.
- [ ] `load_ticker_mode` — `sample` until Phase 3 live data.

**Content prerequisites**
- [ ] Publish **2 blog articles** minimum via the admin blog editor (empty
      blog looks abandoned; SEO needs crawlable content at launch).
- [ ] **RU/HT native review** of the translated catalogs — machine-assisted
      RU/HT strings plus the M-42 supplemental strings (which deliberately
      mirror English in ru/ht) need a native speaker pass.
- [ ] Founder photo (About page shows a monogram until the shoot).

**Technical smoke (after DNS cutover)**
- [ ] `npm test` + `npm run test:e2e` green on the release commit.
- [ ] Quick-quote submits → row in `carrier_leads` + notification email at
      `EMAIL_INTERNAL_TO` + `email_log` row.
- [ ] Full onboarding walkthrough on staging: wizard → uploads → e-sign
      (test mode) → portal.
- [ ] Password recovery round-trip (forgot → email → reset → portal).
- [ ] `robots.txt`, `sitemap.xml`, hreflang, security headers (check on
      [securityheaders.com](https://securityheaders.com)).
- [ ] Stripe + Dropbox Sign webhook test deliveries show in
      `webhook_events`.

---

## One-pager: the day the MC activates

Total time: ~10 minutes, zero deploys. Everything is driven by
`company_settings` (audit F-13) and updates site-wide immediately.

1. Sign in → Admin → **Settings**.
2. `mc_number` → `{"status":"active","value":"MC-XXXXXXX"}`
3. `usdot_number` → `{"status":"active","value":"XXXXXXX"}`
4. `bond_status` → `{"status":"active","value":"BMC-84 $75K"}` (only once
   the bond is actually filed/effective).
5. Result: footer + compliance blocks swap "PENDING" for the real numbers;
   FAQ answers update.
6. **Only when brokerage ops are truly ready** (bond effective, broker
   processes in place): flip `brokerage_active` → `true` — shipper pages
   drop "Launching Soon".
7. Announce: publish the prepared "We're live" blog post; email the carrier
   list (subscribers table) via Resend.
8. Verify `/`, `/faq`, `/shippers` in an incognito window (ISR: pages
   revalidate; force with a redeploy if anything looks cached).
