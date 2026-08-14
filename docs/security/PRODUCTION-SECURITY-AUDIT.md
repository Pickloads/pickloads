# PickLoads — Production Security Audit

**Audit HEAD (start):** `872ac95` · **Branch:** `final-website-production`
**Date:** 2026-08-13 · **Scope:** security only — no redesign, no feature work,
brokerage remains inactive.

**STATUS: NO KNOWN CRITICAL (P0) FINDINGS. NO UNRESOLVED HIGH (P1) FINDINGS.**

This is not a claim that the system is secure. It is a statement about what
this audit looked at and what it found. §7 lists what it did _not_ look at,
and §8 lists what only the owner can verify.

---

## 1. Findings register

| ID          | Sev         | Area                     | Finding                                                                                                                                                                                     | State                      |
| ----------- | ----------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| SEC-P1-01   | **P1 HIGH** | Turnstile / availability | 10 of 11 Turnstile call sites re-sent a spent, single-use token on every retry, wedging the form until a full page reload                                                                   | **FIXED**                  |
| SEC-P2-01   | P2 MED      | CSP                      | `script-src 'unsafe-inline'`                                                                                                                                                                | **ACCEPTED** — §3          |
| SEC-P2-02   | P2 MED      | Webhooks                 | e-sign idempotency key is `event_hash`, a pure function of `(event_time, event_type)`; two legitimate events of the same type in the same second collide and the second is silently dropped | **OPEN** — §4              |
| SEC-P2-03   | P2 MED      | Rate limiting            | `checkRateLimit` fails **open**; if `UPSTASH_*` is unset the limiter is disabled site-wide with only a `console.warn`                                                                       | **ACCEPTED + action** — §5 |
| SEC-P3-01   | P3 LOW      | Repo hygiene             | `supabase/.temp/` untracked but not ignored                                                                                                                                                 | **FIXED**                  |
| SEC-P3-02   | P3 LOW      | XSS defence-in-depth     | Two pages bypassed the escaping `<JsonLd/>` helper and hand-rolled a `JSON.stringify` script sink                                                                                           | **FIXED**                  |
| SEC-P3-03   | P3 LOW      | Turnstile                | `siteverify` response `hostname` / `action` are not validated                                                                                                                               | **OPEN** — §6              |
| SEC-INFO-01 | INFO        | Auth                     | Unverified-email error is distinguishable from bad-credentials                                                                                                                              | **ACCEPTED** — §6          |
| SEC-INFO-02 | INFO        | Cron                     | `GET` mutates state (sends mail, purges rows)                                                                                                                                               | **ACCEPTED** — §6          |

Nothing was downgraded to make a number look better. SEC-P1-01 is classified
HIGH on **availability** grounds and is explicitly _not_ a confidentiality or
integrity breach; the reasoning is in §2.

---

## 2. SEC-P1-01 — Turnstile token reuse (FIXED)

**What.** A Turnstile token is single-use and expires after 300s. The widget
solves once on mount and holds that one token. Any form surviving its own
submission therefore re-sent a **spent** token on the next attempt;
Cloudflare returned `timeout-or-duplicate`, the guard rendered "we couldn't
verify your submission — please refresh the page", and _every subsequent
retry failed identically_. The form was dead until a full reload.

**Why it was still live.** `resetKey` was added to fix this at the carrier
wizard and shipped as an **opt-in with a default of `0`**. One of eleven call
sites opted in. The other ten:

`CreateCarrierForm` · `CreateShipperForm` · `ContactForm` · `FreightQuoteForm`
· `QuickQuote` · `NewAuthorityLeadForm` · `NewsletterForm` · `DriverUpdateView`
· `TrackingSupportForm` · `TrackingLookup`

**The worst case is the happy path.** The token is spent by the _submission_,
not the _outcome_. `TrackingLookup`'s own documentation invites a second
lookup — "a successful result renders BELOW the form … a second lookup is one
edit away" — and that second lookup was refused, on the public tracking page,
for a customer who had just been told the first one worked.

**Severity.** HIGH on availability: it silently broke account creation,
contact, both quote paths, newsletter, driver updates and public tracking —
the entire public funnel — for any user whose first attempt did not succeed.
It grants no attacker any read, write or privilege. Classified honestly rather
than inflated or buried.

**Fix.** The reset became a shared hook, wired at all 11 sites:

```ts
export function useTurnstileReset(state: { status: string }): number;
```

It fires on **any settled submission**, success or error, because that is when
the token is spent. A safety default every caller must remember is not a
default.

**Regression.** `tests/unit/security-turnstile.test.tsx` (6 tests). The
important half is structural: it scans every `.tsx` for `<TurnstileWidget/>`
and fails if any lacks a `resetKey`. The behavioural tests would have passed
on the broken tree — the hook was never the problem; ten call sites simply
never called it.

---

## 3. SEC-P2-01 — `script-src 'unsafe-inline'` (ACCEPTED)

`next.config.ts` ships:

```
script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://www.googletagmanager.com
```

`'unsafe-inline'` in `script-src` removes CSP as an XSS backstop. It is the
single largest remaining hardening item and it is **not** closed.

**Why it is accepted rather than fixed.** The two real alternatives both cost
more than they return here:

- **Nonce CSP.** A per-request nonce makes every route dynamic. This site
  statically prerenders 434 pages, and that prerendering is load-bearing for
  a §25 guarantee ("never cache private shipment data publicly") — the public
  shells contain no customer data _by construction_. Trading that for a CSP
  improvement is a bad trade on a site whose only HTML sink is already
  escape-first.
- **Hash CSP.** Next does not emit stable hashes for its own bootstrap inline
  script, so this is not available without forking framework output.

**What carries the weight instead:** `renderMarkdown()` escapes all input then
rebuilds a fixed allow-list (`src/lib/markdown.ts`); `<JsonLd/>` escapes `<`;
`dangerouslySetInnerHTML` exists in exactly three places, now enforced by
`tests/unit/security-jsonld.test.ts`; `frame-ancestors 'none'`,
`X-Content-Type-Options: nosniff`, HSTS with preload, and a restrictive
`Permissions-Policy` are all set.

**Revisit when** Next ships static-compatible CSP hashing, or if a
user-generated-HTML surface is ever added — the second changes the calculus
immediately.

---

## 4. SEC-P2-02 — e-sign webhook idempotency collision (OPEN)

`src/app/api/esign/webhook/route.ts` stores `event_id: event.event_hash`.

Dropbox Sign's `event_hash` is `HMAC-SHA256(event_time + event_type)` — a pure
function of two low-cardinality fields. Consequences:

1. **Signature does not cover the payload.** An attacker replaying a captured
   webhook with a different `metadata.carrier_id` would still pass
   `verifyHash`. **This is currently blocked** — but by accident: the
   `(provider, event_id)` unique constraint rejects the replay because the
   hash is identical. The control that saves us is idempotency, not the
   signature. Worth knowing, because a change to the dedupe key would silently
   remove it.
2. **Real collision.** `event_time` has second granularity, so two legitimate
   `signature_request_signed` events in the same second produce the **same
   hash**. The second is deduped, returns `200`, and is never processed — a
   carrier's `agreement_signed_at` is silently never stamped.

(2) is the reason this is P2 rather than P3: the silent-drop outcome is a
missing legal-agreement record with no error anywhere.

**Recommended fix (not applied — needs provider verification first):** key
idempotency on `signature_request.signature_request_id + event_type`, keeping
`event_hash` purely as the authenticity check, and add a payload-binding
assertion that the `carrier_id` in metadata matches the carrier the signature
request was created for (`src/lib/esign.ts` sets it, so it can be re-read).
Not applied blind because it changes webhook processing on a live integration
and warrants a staged test against Dropbox Sign's own event replay tool.

---

## 5. SEC-P2-03 — rate limiting fails open (ACCEPTED + owner action)

`src/lib/rate-limit.ts` returns `true` (allow) both when Upstash is
unconfigured and when Redis errors.

**The documented trade is sound for lead capture** — Turnstile still gates
those forms, and a Redis outage taking down the contact form is worse than the
abuse it prevents.

**It is thinner on `/login`.** `LoginForm` and `ForgotPasswordForm` are the two
public forms with **no Turnstile widget**, so the Upstash bucket is the only
application-layer brute-force control, and it fails open. The residual control
is Supabase Auth's own server-side rate limiting, which is real but is not
ours and is not asserted anywhere in this repo.

**Not changed here**, deliberately: making login fail _closed_ converts a Redis
outage into a total portal lockout, and that is an owner's risk decision, not
an auditor's. The code already documents the choice.

**Owner action (§8):** confirm `UPSTASH_REDIS_REST_URL` / `_TOKEN` are actually
set in the Vercel **Production** environment. If they are not, the site has no
application-layer rate limiting anywhere and the only signal is a
`console.warn` in the function logs.

---

## 6. Lower-severity items (OPEN / ACCEPTED)

**SEC-P3-03 — Turnstile hostname/action not validated.** `verifyTurnstile`
checks `success` but ignores the `hostname` and `action` fields siteverify
returns. Cloudflare already restricts allowed hostnames widget-side, so this is
defence-in-depth. Not implemented because a naive `hostname === SITE_URL` check
breaks every Vercel preview deployment, and a control that has to be disabled
to work is worse than none. Correct form is an allow-list including preview
domains — worth doing, low urgency.

**SEC-INFO-01 — unverified-email message.** Distinguishable from
bad-credentials, so it confirms an account exists — but only to someone who
already supplied the correct password. Accepted: the UX gain is large and the
disclosure requires the credential.

**SEC-INFO-02 — cron GET mutates.** Vercel Cron only issues `GET`. The route is
guarded by `timingSafeEqual` against `CRON_SECRET` and is not cookie-authenticated,
so CSRF does not apply. Accepted as a platform constraint.

---

## 7. What was verified, and what was not

**Verified with evidence in this audit:**

| Phase          | Result                                                                                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Inventory    | 6 API routes, 29 server-action modules, 49 tables, 118 policies, 31 env names                                                                                                                                                       |
| 1 Secrets      | Full `git log --all -p` scan: every hit is a deliberate test fixture proving scrubbing, plus one lockfile hash. No secret in history. No secret value in client bundles. All 12 secret-holding modules carry `import "server-only"` |
| 2 Auth         | `safeNext()` rejects absolute and protocol-relative (`//evil.com`) redirects; generic credential errors; dedicated login rate-limit bucket; session dropped when profile missing; suspension resolved before redirect               |
| 3/4 RLS        | **All 49 public tables have RLS enabled and ≥1 policy.** Only 2 `using(true)` policies, both intentional public reference data. Every `SECURITY DEFINER` function pins `search_path`                                                |
| 5 Service role | Referenced in exactly one module (`src/lib/supabase/admin.ts`), `server-only`                                                                                                                                                       |
| 7 XSS          | 3 `dangerouslySetInnerHTML` sinks, each sanitised; now enforced by test                                                                                                                                                             |
| 11 Uploads     | Magic-byte sniffing (not extension, not client MIME), no SVG/HTML in the allow-list, 10 MB cap, private `carrier-docs` bucket, 300s signed-URL TTL pinned by constant + test, filename path-stripping                               |
| 12 PII         | AES-256-GCM, random 12-byte IV per value                                                                                                                                                                                            |
| 14 Gates       | `brokerage_active` is `false`; anon cannot read _or_ write it                                                                                                                                                                       |
| 15/16 Webhooks | Stripe: signature-verified + idempotent + fails closed. Cron: `timingSafeEqual`, 401/503 fail-closed                                                                                                                                |
| 23 Deps        | `npm audit` = **0 vulnerabilities**                                                                                                                                                                                                 |
| 30 Adversarial | Live probes below                                                                                                                                                                                                                   |

**Adversarial probe results** (real queries against a migrated database):

```
anon SELECT profiles          -> 0 rows   (16 exist)
anon SELECT carrier_leads     -> 0 rows   (1 exists)
anon SELECT contact_messages  -> 0 rows   (1 exists)
anon SELECT audit_events      -> 0 rows   (1 exists)
anon SELECT subscribers/support_messages/webhook_events/
           staff_invites/notifications/email_log/
           user_preferences/shipment_tracking_access -> 0 rows
anon SELECT carriers/documents/shipments/invoices/drivers/
           trucks/loads/freight_quotes/broker_partners
                              -> ERROR: permission denied (hard refusal)
anon SELECT posts             -> 1 row    (published post — intended)

anon UPDATE company_settings brokerage_active=true -> DENIED
anon INSERT company_settings                       -> DENIED
anon UPDATE profiles SET role='admin'              -> 0 rows
anon INSERT profiles / carriers / loads /
     webhook_events / staff_invites                -> DENIED (RLS violation)
anon INSERT subscribers / carrier_leads            -> DENIED
```

That last line is the architecture working as documented: there are **no anon
insert policies**; public-form writes go through server handlers holding the
service-role key, after Zod + Turnstile + rate-limit.

**NOT covered by this audit — do not read the status line as covering these:**

- Phase 6 input-validation fuzzing (Zod schemas reviewed by inspection, not fuzzed)
- Phase 8 CSRF beyond server-action origin defaults and the logout-is-POST check
- Phase 13 fresh enumeration testing (relies on existing integration coverage)
- Phase 18 CORS (no custom CORS headers found; not exercised against production)
- Phase 21 audit-trail completeness review
- Phases 24–27 supply chain, GitHub, Vercel and Supabase **console** configuration — see §8
- Phase 31 production HTTP testing against `www.pickloads.com`
- Any external penetration test

---

## 8. Owner actions — things this repo cannot verify

Each requires console access and none can be confirmed from source:

1. **Upstash set in Production** (SEC-P2-03). Highest priority.
2. **Vercel env scoping** — confirm `SUPABASE_SERVICE_ROLE_KEY`,
   `TURNSTILE_SECRET_KEY`, `PII_ENCRYPTION_KEY`, `CRON_SECRET`,
   `DRIVER_TOKEN_SECRET`, `TRACKING_ACCESS_SECRET` are **not** exposed to
   Preview environments.
3. **Supabase Auth** — password policy, leaked-password protection, session
   duration, redirect allow-list, PITR/backups.
4. **GitHub** — branch protection on `main`, required CI, secret scanning +
   push protection, Dependabot.
5. **Cloudflare Turnstile** — widget hostname allow-list.
6. **`CRON_SECRET` set** — without it `/api/cron/*` returns 503 and the daily
   jobs (insurance alerts, callbacks, location-retention purge) silently never
   run. That is an availability and a **data-retention compliance** issue.

## 9. External penetration test

**Recommended before or shortly after taking real freight money.** The
application-layer posture is strong and the RLS model is unusually well
tested, but no internal audit substitutes for an adversary who did not write
the code. Scope in `PENTEST-SCOPE.md`.
