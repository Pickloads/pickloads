# Final website — technical readiness

**Measured 2026-08-11.** Every number below was produced by running the lane,
not read from a previous report.

|                  |                              |
| ---------------- | ---------------------------- |
| **HEAD**         | `d9feece` + this commit      |
| **Branch**       | `final-website-production`   |
| **Baseline tag** | `m84b-certified` (untouched) |
| **Route files**  | 89 (`page.tsx` + `route.ts`) |
| **Built pages**  | **434**                      |

---

## 1 · Certified gate

| Lane             | Result                                                     |
| ---------------- | ---------------------------------------------------------- |
| TypeScript       | ✅ PASS                                                    |
| ESLint           | ✅ PASS                                                    |
| Unit             | ✅ **1,785 / 1,785** (1,782 + 3 new extractor-guard tests) |
| RLS              | ✅ **806 / 806**                                           |
| Integration      | ✅ **369 / 369**                                           |
| E2E              | ✅ **546 / 546**                                           |
| Responsive       | ✅ 12 breakpoints, in Chromium                             |
| Accessibility    | ✅ WCAG 2.2 AA (axe), executed                             |
| Production build | ✅ 434 pages                                               |
| `npm audit`      | ✅ **0**                                                   |

Two lanes could not be run at all on this machine when the audit started, and
neither failure was visible as a failure. Both are fixed and re-run in §9 — the
numbers above are from after those fixes. The integration lane takes **67
minutes** on Windows; that is a real cost, not a rounding error, and §9 says
why.

**Test-server strategy.** `playwright.config.ts` sets
`reuseExistingServer: false`. It used to be `true`, and a server left on :4321
from an earlier build silently absorbed a whole session's verification — correct
code looked broken and work was reverted on false evidence. An occupied port now
fails the run loudly. **If a Playwright failure ever makes no sense, check the
port first.**

## 2 · Feature status

| Area            | Status                                                                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Search**      | ✅ Public-only, by construction. Index derives from the same sources as the sitemap, so a page not public enough for the sitemap _cannot_ be indexed. No DB query, no session, no client index. 21 unit + 7 e2e                 |
| **Theme**       | **DARK — APPROVED / PRODUCTION READY**<br>**LIGHT — DEFERRED PENDING APPROVED DESIGN SYSTEM**<br>**SYSTEM — NOT APPLICABLE UNTIL LIGHT EXISTS**<br>Design approval required; **not a technical blocker**                        |
| **PWA**         | ✅ Installable. Valid manifest at the root URL, `application/manifest+json`, PickLoads identity, public `start_url`, dark `theme_color`. **No service worker, deliberately** — see §4. **Icons: EXTERNAL/BRAND ASSET REQUIRED** |
| **SEO**         | 🟡 Sitemap + hreffang, robots, canonical, breadcrumbs on every new page, Service/FAQ/Article JSON-LD, `noindex` on private and filtered surfaces. Brokerage `Service` node withheld while `brokerage_active` is false           |
| **Analytics**   | ✅ Closed 16-event taxonomy, no free strings, no field able to carry form content. **Inert without a GA4 id**                                                                                                                   |
| **Performance** | 🟡 Not measured — see §6                                                                                                                                                                                                        |
| **Link QA**     | ✅ Every public route crawled in-browser; no 404, no `href="#"`, no admin/dispatcher path, no storage URL, no raw document file. Locale alternates resolve                                                                      |
| **Environment** | 🟡 Audited — see §5                                                                                                                                                                                                             |
| **CI**          | ⚠️ **CONFIGURED — NOT REMOTE-VERIFIED.** The workflow exists and has never executed; this repository has no remote                                                                                                              |
| **Deployment**  | 🟡 Configuration reviewed; not deployed                                                                                                                                                                                         |

## 3 · Security

- **RLS 806/806.** Cross-tenant isolation for shipper, carrier and broker; public DTO key-sets; enumeration protection; driver-token scope, expiry and revocation; document visibility; column-level grants (0030).
- **Brokerage fail-closed.** `brokerage_active = false`, enforced by `trg_shipments_brokerage_gate` at the database. The public page withholds its `Service` structured data while the gate is shut — a machine-readable claim of brokering freight is harder to walk back than a sentence.
- **No public surface exposes** an admin or dispatcher path, a storage URL, a signed URL, a private document, an internal carrier rating, or a tracking credential. Each asserted, most with non-vacuity controls.
- **Migrations 0001→0030** apply cleanly from shim → seed → fixtures.

## 4 · Why there is no service worker

Every screen worth caching on this platform is one that must not be cached:
shipment detail, the driver-token page, documents, invoices, carrier and shipper
records, tracking results. A worker caching "the app" would put freight and
identity data in a store that outlives the session, survives sign-out, and is
readable by anything with the device profile.

The only safe alternative — an allow-list covering the marketing shell and
nothing else — duplicates what the CDN already does while adding cache
invalidation and an offline surface to audit.

**If one is ever added:** PUBLIC routes by explicit allow-list only, never a
runtime-caching default, and never `/portal/*`, `/api/*`, `/driver/*` or a
tracking result. Three tests currently assert none is registering, none is
served, and no cache storage is populated.

## 5 · Environment audit

Every variable referenced in `src/` and `scripts/`, classified. **No values
printed.**

**Method:** the set of `process.env.*` reads in the source was extracted and
diffed against the declarations in `.env.example`, in both directions — so the
table below is a mechanical result, not a reading of the code. The two-way diff
is what surfaced the finding: a one-way check for _undeclared_ variables would
have caught `DRIVER_TOKEN_SECRET`, but nothing would have flagged the three
variables declared and never read.

| Variable                                                                                                    | Class                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`                    | REQUIRED — external config                                                                                                                                                                                                |
| `NEXT_PUBLIC_SITE_URL`                                                                                      | REQUIRED — external config                                                                                                                                                                                                |
| `TRACKING_ACCESS_SECRET`                                                                                    | REQUIRED (public tracking refuses to operate without it)                                                                                                                                                                  |
| **`DRIVER_TOKEN_SECRET`**                                                                                   | **REQUIRED — was MISSING from `.env.example`; added this phase**                                                                                                                                                          |
| `DRIVER_TOKEN_TTL_HOURS`                                                                                    | OPTIONAL (safe default in code)                                                                                                                                                                                           |
| `PII_ENCRYPTION_KEY`                                                                                        | REQUIRED for carrier EIN encryption                                                                                                                                                                                       |
| `CRON_SECRET`                                                                                               | REQUIRED for the daily + notification crons                                                                                                                                                                               |
| `TURNSTILE_SECRET_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`                                                    | REQUIRED for production spam protection (absent → guard no-ops)                                                                                                                                                           |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`                                                        | REQUIRED for production rate limiting (absent → limiter disabled)                                                                                                                                                         |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_INTERNAL_TO`                                                         | REQUIRED for transactional email                                                                                                                                                                                          |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                                                                | REQUIRED for dispatch-fee invoicing                                                                                                                                                                                       |
| `DROPBOX_SIGN_API_KEY`, `DROPBOX_SIGN_TEMPLATE_ID`, `DROPBOX_SIGN_WEBHOOK_SECRET`, `DROPBOX_SIGN_TEST_MODE` | REQUIRED for e-sign; **blocked on counsel-approved template**                                                                                                                                                             |
| `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, `NEXT_PUBLIC_SENTRY_RELEASE`                    | OPTIONAL — absent = monitoring inert, app unaffected                                                                                                                                                                      |
| `NEXT_PUBLIC_GA4_MEASUREMENT_ID`                                                                            | OPTIONAL — **absent = the whole analytics taxonomy emits nothing**                                                                                                                                                        |
| `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY`                                                                         | Declared, unused (the contact embed is keyless)                                                                                                                                                                           |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `SENTRY_AUTH_TOKEN`                                                   | Declared in `.env.example`, **not referenced anywhere in `src/` or `scripts/`** — `SENTRY_AUTH_TOKEN` is consumed by the build plugin, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is currently unused (checkout is server-side) |
| `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`, `NODE_ENV`, `NEXT_RUNTIME`                                           | Platform-provided                                                                                                                                                                                                         |

**Finding:** `DRIVER_TOKEN_SECRET` was used by `driver-token.ts` and documented
nowhere. A driver-update URL _is_ the grant — shipment-scoped, expiring,
revocable — and that secret is what makes a forged one invalid. Now documented,
with rotation guidance.

## 6 · Not measured

Stated rather than estimated:

- **Core Web Vitals.** No LCP/CLS/INP figures were captured. Doing it honestly
  needs a production-like deploy with real images and network conditions;
  numbers from a local build on placeholder env would be misleading. **Not a
  blocker, not a claim.**
- **CI has never run.** The workflow is configured and unexecuted.
- **No Sentry event has reached a real project.** The scrubber is proved
  against hand-built events, not SDK output. The runbook carries the one manual
  check that closes this.
- **Real photography** is absent; honest placeholders remain.

## 7 · Outstanding

**P0 — external, blocking public launch**

1. **Legal documents.** Ten identified, **zero with approved content**; two have no shell at all (Broker-Carrier, Shipper-Broker). Counsel is the longest lead item on the whole path. → `LEGAL-DOCUMENTS-REQUIRED.md`
2. **FMCSA broker authority + BMC-84 bond.** Business milestones. The platform is built and fail-closed behind them.

**P1 — engineering**

1. **`extract-i18n.mjs` — now fail-closed (see §8).** The structural defect
   remains (it regenerates rather than merges); it can no longer destroy
   anything. Full remediation is still to make it merge.
2. **Integration lane spawns one `psql` per statement** (§9). Timeouts now
   scale by platform so the lane passes, but it takes **67 minutes** on
   Windows. A persistent connection is the real fix.
3. CI configured, never executed — needs a remote.
4. Core Web Vitals unmeasured.
5. **CSP carries `script-src 'unsafe-inline'`.** Required by Next's inline
   bootstrap and the GA4/Turnstile snippets as currently loaded; a nonce-based
   policy is the upgrade. Known posture, not a regression.

**External configuration required**
GA4 measurement id · Sentry DSN · **PWA brand icons** · Google Business Profile · booking URL · Maps embed key · real photography · four counsel-approved packet PDFs · Dropbox Sign template.

**Cowork content review** — unresolved by engineering, by design:
24/7 Dispatch (topbar, every page) · one-business-hour response · first load
within 24 hours · RATE IN 1 HOUR · SAME-DAY DOCS · same-day document delivery ·
homepage pricing tiers · FAQ pricing percentages (now also in FAQ structured
data) · Careers/Partners positioning · Referral terms.
→ `COWORK-CONTENT-REVIEW.md`

## 8 · The i18n extractor, measured

The standing instruction was never to run `scripts/extract-i18n.mjs`, because
one run destroyed 743 lines and turned 45 tests red. That instruction protected
the catalogs but left a loaded script in the repository, one `node
scripts/…` away from firing — and the rule lived in a conversation, not in the
code.

**What it actually does.** It regenerates `messages/<locale>.json` from two
in-file sources — the V4 dictionary scraped out of the prototype, and the
`SHIPMENT` table inside the script. It never reads what is already on disk. Any
key added by a later milestone is therefore not reproduced, and a write deletes
it.

**Blast radius, measured rather than estimated:**

|                                     |                                                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Keys deleted per locale             | **126**                                                                                                                 |
| Across five locales                 | **630**                                                                                                                 |
| `shipment` namespaces lost entirely | `document` (31), `broker` (37), `optout` (15), `location` (12)                                                          |
| Also lost                           | 6 post-extraction `v4` keys, plus later additions inside `shipment.label`, `phrase`, `page`, `result`, `a11y`, `driver` |

A namespace-level reading of the script suggested 95 keys. The true figure is
126 — the extra 31 are keys added _inside_ namespaces the script does know
about, which only a path-level diff exposes. That gap is the argument for the
fix below: judging this by reading the source under-counted it.

**The fix.** The script now builds all five catalogs in memory, diffs the leaf
paths it would write against the leaf paths on disk, and — if a single path
would disappear — prints what would be lost and exits 1 **having written
nothing**. All five are proved before any is written, so a failure on the
fourth locale cannot leave the first three rewritten.

**Proved, not assumed.** The script was executed against hashed catalogs: exit
code 1, and all six files byte-identical afterwards.
`tests/unit/i18n-extractor-guard.test.ts` re-runs that whole experiment —
spawn, assert refusal, assert hashes unchanged — plus a non-vacuity control
that the catalogs really do contain unreproducible keys, so the guard cannot
pass by never triggering.

This does not make regeneration correct. It makes destruction impossible, which
is the property that was missing.

## 9 · Two lanes that could not run — and did not say so

Both were found by trying to execute the gate rather than citing it. Neither
announced itself as broken; each is a _platform assumption_ baked into test
infrastructure, and both hid behind output that looked like something else.

### RLS — aborted before the first assertion

`supabase/tests/20_rls_isolation.sql` discarded chatter with `\o /dev/null`.
`\o` is interpreted by **psql**, not the shell, so a native Windows psql treats
that as an ordinary file path, finds no such directory, and stops:

```
20_rls_isolation.sql:172: error: /dev/null: No such file or directory
```

The migration chain had already applied cleanly, so the run _looked_ like it
was working until the moment it wasn't. Compounding it, both runners defaulted
`PGHOST` to `/tmp/pgsock` — and Windows PostgreSQL has no unix-domain sockets
at all, so that default can never connect. The suite reported "Cannot reach
PostgreSQL", which reads as a missing server rather than an impossible default.

**Fixed:** the runner now picks the platform's null device (`/dev/null` or
`NUL`) and passes it as `-v discard`, and `PGHOST` defaults to `localhost` on
Windows. `npm run test:rls` needs no overrides. **806 / 806.**

### Integration — reported skips instead of failures

`vitest.integration.config.ts` set `testTimeout: 30_000` and left `hookTimeout`
at vitest's **10s default**. Every database call in the lane is a separate
`psql` subprocess, which costs ~2s on Windows, so fixtures doing twenty
statements needed forty seconds and never survived a ten-second hook.

The damage was in how that was _reported_. When a `beforeAll` hook fails,
vitest marks the file's remaining tests **skipped** — so the run said:

```
Test Files  12 failed (12)
Tests  1 failed | 22 passed | 346 skipped (369)
```

346 of 369 assertions never executed, and not one of them disagreed with the
code. A summary dominated by "skipped" invites the reading that those tests
were deliberately not applicable. They were, and they were silent.

**Fixed:** both budgets now scale by platform (`×6` on Windows), so a genuine
hang still trips quickly on Linux while Windows gets the room its process model
costs. The asymmetry — one timeout tripled, the other forgotten — was the whole
bug.

**Root cause, not yet fixed (P1):** a subprocess per statement. With the
budgets corrected the lane passes **369 / 369** — and takes **4,046 seconds
(67 minutes)** on Windows. The same lane is minutes on Linux. Nearly all of
that is process creation, TCP connect and auth, repeated once per statement;
almost none of it is PostgreSQL doing work.

That number is the argument for fixing it properly. A 67-minute local lane is
one developers skip, and a lane that gets skipped is the state this project has
already been burned by twice. A persistent connection would return it to
seconds. Deliberately not attempted here — it touches every helper in the lane,
and this was an audit, not a refactor.

### A third, smaller one: the new link-QA crawl flaked on its first run

`link-qa.spec.ts` failed once with `ECONNRESET` on `/login` — a connection
reset, not a status. Rather than assume "flake" and re-run until green, the
route was probed directly: **85 consecutive requests, 85× 200**. The path is
fine; firing several dozen sequential requests through one Playwright request
context occasionally catches the Node server recycling a keep-alive socket.

The test now retries **once, and only when no response arrived at all**. Any
response ≥400 is returned to the assertion immediately with no second attempt,
so a genuinely broken route still fails on the first try. Re-run: **546 / 546.**

The distinction matters more than the fix. "Retry the request" would have made
a real 404 take two attempts to notice; "retry only a connection that produced
no response" cannot.

### What this changes about the rest of this document

These lanes are the _evidence_ for the security claims in §3. Had they been
cited rather than run, this report would have asserted 369 passing integration
assertions and 806 RLS assertions on the strength of a suite that could not
execute on the machine it was being reported from. Every figure in §1 was
re-measured after these fixes.

## 10 · Scores

|                                 | Score        | Reasoning                                                                                                                                                                |
| ------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Technical website readiness** | **92 / 100** | Every lane green and executed; 434 pages; security proved. Held back by: CWV unmeasured, CI unverified, i18n extractor unsafe, PWA icons absent                          |
| **Dispatch launch readiness**   | **70 / 100** | Engineering essentially done. Gated entirely on legal documents and external service configuration — not on code                                                         |
| **Brokerage launch readiness**  | **35 / 100** | Code complete and fail-closed. Gated on MC authority, BMC-84 bond, and two agreements that do not exist yet. **Do not treat the technical score as brokerage readiness** |

Technical readiness and legal readiness are different things, and the gap
between 92 and 35 is entirely the second one.

## 11 · Remaining actions before public launch

1. **Engage counsel** — Privacy, Terms, Cookie, Dispatch/Carrier agreements.
   Longest lead time; start first.
2. **Cowork content pass** — rule on the claims in §7.
3. **Configure external services** — GA4, Sentry, Turnstile, Upstash, Resend,
   Stripe, Supabase production project.
4. **Supply PWA brand icons** and real photography.
5. **Push to a remote and let CI run once** — then CI status stops being an
   asterisk.
6. **Staging deploy** → verify live integrations → run the Sentry privacy check
   in the runbook → capture real Core Web Vitals.
7. **Upload the four counsel-approved packet PDFs**, then flip
   `packet_downloads_live` — confirming the documents are _approved_, not merely
   present (`LEGAL-DOCUMENTS-REQUIRED.md` §2b).
8. **Dispatch goes live.**
9. **Separately:** MC authority + bond land → the business owner flips
   `brokerage_active`. Not an engineering step.
