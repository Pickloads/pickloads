# PickLoads — Security Launch Checklist

Repo-verifiable items are ticked with evidence. Console items are **not**
ticked — nobody can verify them from source, and pretending otherwise is how a
checklist becomes decorative.

## A. Verified in the repository ✅

- [x] RLS enabled on **49/49** public tables, every one with ≥1 policy
- [x] 118 policies · 806 RLS assertions passing
- [x] Only 2 `using(true)` policies, both intentional public reference data
- [x] Every `SECURITY DEFINER` function pins `search_path`
- [x] `anon` reads 0 rows from every sensitive table (probed)
- [x] `anon` cannot write `company_settings`, `profiles.role`, or any core table (probed)
- [x] No anon INSERT policies — public writes go through server actions
- [x] `brokerage_active = false`, and anon cannot flip it
- [x] Service-role key in exactly one module, `server-only`
- [x] All 12 secret-holding modules `server-only`
- [x] No secret in git history; no secret value in client bundles
- [x] No server secret under `NEXT_PUBLIC_*`
- [x] `.env.local` and `supabase/.temp/` ignored
- [x] Passwords never in URLs; generic credential errors
- [x] `safeNext()` blocks absolute and `//` protocol-relative redirects
- [x] Logout is POST and destroys the session server-side
- [x] Uploads: magic-byte typing, no SVG, 10 MB cap, private bucket, 300 s signed URLs
- [x] PII: AES-256-GCM, random IV per value
- [x] Cron: `timingSafeEqual` on `CRON_SECRET`, 401/503 fail-closed
- [x] Stripe webhook: signature-verified, idempotent, fails closed
- [x] XSS sinks: 3, all sanitised, enforced by test
- [x] Security headers: CSP, HSTS preload, `nosniff`, `frame-ancestors 'none'`, Referrer-Policy, Permissions-Policy
- [x] `npm audit` = 0
- [x] Turnstile token freshness at **11/11** call sites (SEC-P1-01 fixed)

## B. Owner must verify in a console ⬜

- [ ] **`UPSTASH_REDIS_REST_URL` + `_TOKEN` set in Vercel Production.**
      Highest priority: without them there is no application-layer rate
      limiting anywhere, including `/login`, and the only signal is a
      `console.warn` (SEC-P2-03)
- [ ] **`CRON_SECRET` set.** Without it `/api/cron/*` returns 503 and the daily
      jobs never run — insurance alerts, callback digests, and the §9
      location-retention purge. The purge is a data-retention commitment
- [ ] `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, `PII_ENCRYPTION_KEY`,
      `DRIVER_TOKEN_SECRET`, `TRACKING_ACCESS_SECRET` set in Production
- [ ] Production secrets **not** exposed to Preview environments
- [ ] Turnstile widget hostname allow-list matches production domains
- [ ] Supabase: password policy, leaked-password protection, session duration,
      redirect allow-list
- [ ] Supabase: PITR / backup schedule confirmed
- [ ] GitHub: branch protection on `main`, required CI, secret scanning + push
      protection, Dependabot
- [ ] Vercel: deployment protection on Preview; canonical `www` redirect
- [ ] Confirm production source maps are not publicly served

## C. Open findings accepted for launch

| ID          | Severity | Why it is acceptable now                                                                                                                                        |
| ----------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-P2-01   | P2       | `script-src 'unsafe-inline'`. Nonce CSP would destroy static prerendering, which is itself a privacy control. No user-generated-HTML surface exists             |
| SEC-P2-02   | P2       | E-sign idempotency collision. Needs staged testing against the provider; failure mode is a missed agreement stamp, detectable against the provider's own record |
| SEC-P2-03   | P2       | Rate limiting fails open. Documented trade; Supabase Auth retains its own limits. Conditional on B.1                                                            |
| SEC-P3-03   | P3       | Turnstile hostname not validated. Cloudflare enforces widget-side                                                                                               |
| SEC-INFO-01 | INFO     | Unverified-email message requires the correct password first                                                                                                    |

## D. Not done, and not claimed

External penetration test · input-validation fuzzing · CORS testing against
production · production HTTP header verification against `www.pickloads.com` ·
audit-trail completeness review · storage-RLS adversarial probing.

## Launch statement

> **NO KNOWN CRITICAL OR HIGH SECURITY FINDINGS AFTER THE DEFINED AUDIT.**

Valid only with section B completed. B.1 and B.2 are the two that change the
statement if they fail.
