# M-69 — Production Integrity Pack

**Status:** ✅ Complete · **Phase:** A (integrity prerequisite) · **Date:** 2026-08-05

Scope: `docs/FINAL-IMPLEMENTATION-PLAN.md` §3, defects **P-1 … P-7**. Every
item is a repair to something already live in the shipped product. Nothing new
is featured; nothing in M-70+ should be built on top of the foundations this
module fixes. Three of the seven carried legal or trust exposure.

---

## What was built

| ID | Defect (live before this module) | Fix |
|---|---|---|
| **P-1** | `subscribers.unsubscribed_at` existed since 0001 with **zero writers**; no unsubscribe route existed at all, while `NewsletterConfirmationEmail.tsx:94` promised "unsubscribe anytime" | Tokenized `/newsletter/unsubscribe` page (5 locales, GET renders, POST acts) + RFC 8058 one-click `POST /api/newsletter/unsubscribe` + `List-Unsubscribe` header pair on marketing sends + a real unsubscribe link in the confirmation email. Idempotent, rate limited, honest without env. Migration **0014**. |
| **P-2** | `CtaBand.tsx:12` promised "// Refer a carrier who signs up → earn a referral bonus." on home, every `/blog/[slug]`, 8 `/dispatch/[equipment]`, `/truck-dispatch` and 6 state pages × 5 locales, with no referral programme in existence | Gated behind a **new** `company_settings.referral_program_active` (default **false**). The approved string is **not deleted** — it stays in `CtaBand.tsx` and all five catalogues and returns with one flag flip. Migration **0015** + seed. |
| **P-3** | `Footer.tsx:54` labelled `/shippers` "Freight Brokerage" sitewide while `brokerage_active = false` and the MC/BMC-84 are pending | The **label** is gated on `brokerage_active`, falling back to "For Shippers" — an already-approved V4 dictionary string used elsewhere in the same footer. The link is untouched; no new copy was invented. |
| **P-4** | `src/lib/audit.ts` was documented as the single `audit_events` writer, but 4 files inserted directly (`staff.ts` ×5, `carrier-portal.ts` ×2, `account.tsx` ×2, `quotes.ts` ×1), so its no-secrets / IP-capture / never-roll-back contract was unenforceable | All 10 sites routed through `recordAuditEvent()` with **identical semantics** (same action strings, same `detail`, same actor, same IP), plus an ESLint `no-restricted-syntax` rule that fails the build on any new `from("audit_events")` outside the writer and the admin security **reader** page. |
| **P-5** | `actions/carrier.ts` minted signed URLs for private carrier documents with **no audit event**, while `actions/admin.ts:166-171` audited the staff path | `document.download` journalled on the carrier path through the helper: actor, document id, carrier id, TTL. **Never** the signed URL (a live credential) and never file contents. |
| **P-6** | `packet_downloads_live` appeared only in a *comment* (`Packet.tsx:9`) with 4 hardcoded `href="#"` links; `testimonials_visible` was read **nowhere** in `src/` — two switchboard keys the runbook tells an operator to flip that did nothing | Both wired to real behaviour through the shared server-side accessor. Packet: flag decides live download links vs the honest pending toast. Testimonials: V4 markup restored behind the flag, rendering **nothing** when off *and* nothing when on with no approved rows — never sample content. |
| **P-7** | `loads.ts:63 formatRpm` divided gross by `loads.miles` (loaded only) and every surface labelled it "RPM"/"Avg RPM"; true RPM is measured over deadhead + loaded | Renamed `formatLoadedRpm`, all labels changed to "Loaded RPM" / "Avg Loaded RPM"; new `formatTrueRpm()` over `deadhead_miles + miles`; nullable `loads.deadhead_miles` column + an optional capture field on the load form. **No displayed value changed.** Migration **0016**. |

---

## Why these, and why first

The `FINAL-IMPLEMENTATION-PLAN` review found each of these in the shipped
product, independent of both directives:

- **P-1 is a CAN-SPAM exposure on the first marketing send.** §316.5 requires
  a working, login-free opt-out; Gmail/Yahoo bulk-sender rules add RFC 8058
  one-click on top. Both were promised in the email and neither existed.
- **P-2 is a live unfulfillable promise** on 20+ pages × 5 locales.
- **P-3, P-6** are the same honest-states standard the rest of the product
  already meets, applied where it wasn't.
- **P-4** is the prerequisite for M-72's event ledger: if four files can
  bypass the writer today, the tracking module's audit trail is not
  centrally enforceable tomorrow.
- **P-5** makes the §15 "document-access history" claim actually true.
- **P-7** is operationally misleading on exactly the screen where booking
  decisions are made.

---

## How

### P-1 — unsubscribe

Three modules, deliberately layered so the same rules apply to both entry
points:

- `src/lib/newsletter.ts` — plain module (no `server-only`): token
  validation, URL builders, `marketingUnsubscribeHeaders()`, the outcome
  vocabulary. Unit-testable, importable from React Email builders.
- `src/lib/newsletter-unsubscribe.ts` — `server-only`; the **only** place
  `unsubscribed_at` is written. `lookupUnsubscribe()` is read-only,
  `applyUnsubscribe()` is the write.
- `src/app/[locale]/(site)/newsletter/unsubscribe/page.tsx` — the human page;
  `src/app/api/newsletter/unsubscribe/route.ts` — the one-click endpoint.

**Token choice (documented decision).** A **dedicated `unsubscribe_token`
column** was added rather than reusing `confirm_token`:

1. *Capability separation.* The unsubscribe token is printed in every
   marketing send and handed to mailbox providers by design, so it leaks by
   design — scanners, forwards, archives. Reusing `confirm_token` would turn
   every forwarded newsletter into a credential that can **confirm** a
   pending double-opt-in subscription, not just cancel one.
2. *Lifecycle.* `subscribeNewsletter` resets `confirmed_at` and re-sends the
   same `confirm_token` on re-subscribe; the unsubscribe token must stay
   stable so links in already-delivered issues keep working. It is
   deliberately **not** rotated on re-subscribe.
3. *Revocability.* Either token can be rotated later without breaking the
   other flow.

**GET never mutates.** Outlook Safe Links, Proofpoint and Barracuda prefetch
every URL in an email. The page GET only *looks up*; removal requires the POST
button. `GET /api/newsletter/unsubscribe` redirects to the page rather than
acting.

**Idempotent.** A repeat request returns `already`, which every caller treats
as success (200 on the API, the success panel on the page). Providers retry
one-click POSTs; a 4xx on retry reads as a broken opt-out to both a compliance
auditor and the provider's reputation scoring.

**No enumeration.** The URL carries a token and never an email address; a
malformed token and an unknown token produce the identical state. The page
shows a **masked** address (`d••••r@fleet.example`) so the recipient can tell
which mailbox is being removed without a forwarded link disclosing it.

**Rate limited.** Page POST: 10 / 10 min per IP. One-click POST: 60 / 10 min
per IP (one provider egress IP legitimately carries many unsubscribes).

**Honest without env.** No service-role key ⇒ `unavailable` ⇒ "we couldn't
reach the list, nothing was changed, email support@" — never a fake success
that leaves a real address subscribed.

### P-2 / P-3 / P-6 — the switchboard accessor

`src/lib/company-settings.ts` is new and is now the one server-side reader for
`company_settings` gates.

- Uses a **cookie-less anon client** (these keys are already anon-readable per
  0002 `using (true)`), so reading a flag does **not** pull `cookies()` into
  the caller. The 300+ statically prerendered public pages stay prerendered;
  they simply pick up a 60 s revalidate window from `unstable_cache`, which is
  what lets a flag flip take effect **without a deploy**.
- **Fails closed.** Missing key, outage, junk value, secretless preview — all
  resolve to the caller's fallback, which is `false` for every
  promise-bearing gate. An unreachable switchboard must never light up a
  promise.
- Accepts both the JSON boolean the seed writes and the `"true"`/`"false"`
  strings the M-24 settings editor stores as free text.

Components take the flag as a **prop** rather than reading it themselves, so
each page/layout reads once and the components stay trivially testable.

For P-6/packet, `packet_downloads_live = true` serves the four PDFs from a
fixed path convention (`PACKET_DOC_PATH` in `Packet.tsx` → `public/packet/…`)
rather than operator-typed URLs, so a typo in the settings editor cannot
produce four broken links. **Flipping this flag is a two-part operation:
upload the four counsel-approved PDFs to `public/packet/` first, then flip.**

For P-6/testimonials there are **two locks**: the flag *and* at least one
approved review from `src/lib/testimonials.ts`, which returns `[]` until
**M-87** builds the table with its approval workflow and ratings. Either lock
closed ⇒ the section renders nothing. The V4 prototype's three sample quotes
are deliberately not carried over — they are marked "Sample content for
prototype" in the V4 source and shipping them is exactly the fake social proof
audit finding F-13 removed.

### P-4 — one writer, enforced

Every converted call keeps its exact recorded shape. Two notes:

- `staff.ts acceptStaffInvite` and both `account.tsx` signups previously
  passed `ip` explicitly. They no longer do — `recordAuditEvent()` derives it
  from the same `x-forwarded-for` / `x-real-ip` headers **in the same
  request**, so the stored value is unchanged.
- `account.tsx` signup rows carried no `actor_id` (a signup is not yet an
  authenticated actor). They now pass `actorId: null` explicitly, which
  produces the identical row.

The lint rule was validated by injection: a temporary file containing
`admin.from("audit_events").insert(...)` failed `npm run lint` with the M-69
message; removing it restored a clean run. The admin security **reader** page
(`src/app/[locale]/portal/admin/security/page.tsx`) is exempt by path and
still lints and builds clean.

### P-7 — RPM

`formatRpm` → **`formatLoadedRpm`** (identical arithmetic, honest name);
**`formatTrueRpm(gross, miles, deadheadMiles)`** is new. True RPM renders
`—` when `deadhead_miles` is NULL and **never** falls back to the loaded
figure — a silent fallback would make true RPM equal loaded RPM and re-create
the exact mislabel this fixes. `deadhead = 0` is a real answer (the truck was
already there) and computes normally.

Surfaces: the admin loads board gains a **True RPM** column beside **Loaded
RPM**; the carrier loads table says **Loaded RPM**; the admin dashboard tile
says **Avg Loaded RPM** with the sub-label "gross ÷ loaded miles, cancelled
excluded — deadhead not included". The load form gains an optional
**Deadhead miles** input so the data can start arriving.

---

## DB changes

Migrations **0014 – 0016**. `0001–0004` remain frozen; all three are additive
and touch no policy. The whole `0001 → 0016` chain plus `seed.sql` was applied
to a clean PostgreSQL 16 database by `npm run test:rls` (the M-01 validation
pattern) and the isolation suite ran green afterwards.

### `0014_subscriber_unsubscribe_token.sql`

Adds `subscribers.unsubscribe_token uuid not null default gen_random_uuid()`
plus a unique index. Existing rows are backfilled by the volatile default
(each gets its own value). Rationale for the dedicated column is above and
repeated in the migration header.

> **ROLLBACK**
> ```sql
> alter table subscribers drop column if exists unsubscribe_token;
> ```
> Drops `idx_subscribers_unsubscribe_token` with the column. Safe and
> lossless — nothing else depends on it. Unsubscribe links already mailed
> stop resolving; the page then shows its honest "this link is no longer
> valid, email support@" state, so the CAN-SPAM opt-out path degrades to the
> manual one rather than disappearing.

### `0015_company_settings_referral_flag.sql`

Idempotent upsert of `referral_program_active = false`
(`on conflict (key) do nothing`) — `company_settings` is key/value, so a new
key is data, not DDL. `supabase/seed.sql` carries the same row for fresh
installs, so both paths converge and neither clobbers an operator's chosen
value.

> **ROLLBACK**
> ```sql
> delete from company_settings where key = 'referral_program_active';
> ```
> Safe: the accessor treats a **missing** key as `false`, so deleting the row
> simply keeps the referral line hidden. Nothing errors.

### `0016_loads_deadhead_miles.sql`

Adds `loads.deadhead_miles integer` (**nullable, no default**) and a
`>= 0 or null` CHECK, added inside a `do $$ … $$` existence guard so a
re-apply is silent. NULL means "not captured", which is honestly different
from 0. A default of 0 would invent data and make true RPM silently equal
loaded RPM. `compute_load_fee()` (F-03) reads only `gross_rate` and
`fee_pct_applied`, so the fee snapshot is untouched.

> **ROLLBACK**
> ```sql
> -- capture anything already entered first:
> -- \copy (select id, deadhead_miles from loads where deadhead_miles is not null) to 'deadhead.csv' csv header
> alter table loads drop column if exists deadhead_miles;
> ```
> Lossless for every shipped surface: `formatTrueRpm()` is additive and only
> renders under a "True RPM" label that already states the data may be
> missing. Dropping the column discards captured deadhead figures.

---

## Endpoints

| Route | Method | Auth | Notes |
|---|---|---|---|
| `/{locale}/newsletter/unsubscribe?token=…` | GET | none (token *is* the credential) | `force-dynamic`, `noindex, nofollow`. Read-only render; the POST button is the only state change. Not in `PUBLIC_ROUTES`, so it is absent from the sitemap. |
| server action `unsubscribeNewsletter` | POST | none | Rate limited 10/10 min per IP. `already` reported as success. |
| `/api/newsletter/unsubscribe?token=…` | GET | none | **Redirects** to the page. Never mutates — mail scanners prefetch. |
| `/api/newsletter/unsubscribe?token=…` | POST | none | RFC 8058 one-click. `text/plain` responses, no redirect. 200 unsubscribed/already · 400 invalid or missing token · 429 rate limited (60/10 min per IP) · 503 list unreachable (retry; idempotency makes that safe). `x-unsubscribe-mode: one-click\|direct` for support triage — no PII, no token. |

Email headers on marketing-class sends (built by
`marketingUnsubscribeHeaders()`, never by hand):

```
List-Unsubscribe: <https://pickloads.com/api/newsletter/unsubscribe?token=…>, <mailto:support@pickloads.com?subject=unsubscribe>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

Transactional mail (invoices, document review, password reset) must **not**
carry them — you cannot offer an unsubscribe from a receipt, and mailbox
providers penalise the mismatch. `sendEmail({ headers })` is the passthrough.

---

## Env vars

**No new env vars.** Existing ones used here:

| Var | Used for | Absent ⇒ |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | absolute unsubscribe URLs in email + headers | falls back to `http://localhost:3000` / request origin |
| `SUPABASE_SERVICE_ROLE_KEY` | the unsubscribe read/write and the audit ledger | unsubscribe returns `unavailable` (honest state, never a fake success); audit writes are skipped with a warning |
| `NEXT_PUBLIC_SUPABASE_URL` / `…_ANON_KEY` | the switchboard read | every gate falls back to `false` — the fail-closed production default |
| `UPSTASH_REDIS_REST_*` | unsubscribe rate limits | limiter is a no-op with a warning (existing S-03 behaviour) |
| `RESEND_API_KEY` | delivering the confirmation email + its headers | log-only mode; `email_log` still records the attempt |

---

## Deployment

1. Apply migrations in order — `supabase db push` picks up `0014`, `0015`,
   `0016`. Run `psql $DATABASE_URL -f supabase/seed.sql` on any environment
   whose `company_settings` predates `referral_program_active` (the seed is
   `on conflict do nothing`, so it is safe to re-run anywhere).
2. Verify the three new switchboard states:
   ```sql
   select key, value from company_settings
    where key in ('referral_program_active','packet_downloads_live','testimonials_visible');
   -- all three must be false at deploy
   ```
3. Deploy the app. Nothing about the deploy changes user-visible copy except
   the three gated strings disappearing and the RPM labels becoming accurate.
4. Smoke: `GET /newsletter/unsubscribe` renders the honest invalid-link
   state; the footer says "For Shippers"; the home CTA band has no
   `.mono-note`.
5. Send one real newsletter confirmation to a Gmail address and confirm Gmail
   surfaces its own "Unsubscribe" affordance next to the sender — that is the
   RFC 8058 pair being honoured end to end.

**Flipping the gates later**

| Key | Precondition before flipping to `true` |
|---|---|
| `referral_program_active` | the referral programme (directive §32 J / M-95) actually pays out |
| `packet_downloads_live` | the four counsel-approved PDFs are uploaded to `public/packet/` (`dispatch-agreement.pdf`, `w-9.pdf`, `insurance-requirements.pdf`, `factoring-guide.pdf`) |
| `testimonials_visible` | M-87 has shipped **and** at least one review is approved — flipping early renders nothing, which is safe but pointless |
| `brokerage_active` | FMCSA authority + BMC-84 bond active (unchanged) |

A flip propagates within the 60 s cache window; no redeploy.

---

## Tests

| Suite | Count | New in M-69 |
|---|---|---|
| `npm test` (vitest) | **191** (was 168) | `tests/unit/newsletter.test.ts` (11) — token validation incl. non-UUID/e-mail/SQL-ish rejection, URL + RFC 8058 header shape, and the write path against a stubbed admin client: unsubscribe → `already` → `already` with **exactly one** UPDATE, unknown token → `invalid`, no key → `unavailable`, lookup provably read-only, masking. `tests/unit/settings-gates.test.tsx` (10) — fail-closed parse semantics + rendered proof that the referral line and "Freight Brokerage" are absent when the flags are off and return when on. `tests/unit/loads.test.ts` (+2) — `formatLoadedRpm` value unchanged, `formatTrueRpm` over deadhead + loaded, and `—` rather than a loaded-RPM fallback when deadhead is uncaptured. |
| `npm run test:rls` | **173** (was 165) | 8 assertions: the whole `0001→0016` chain applies clean; anon cannot read `subscribers.unsubscribe_token` or unsubscribe anyone directly; `referral_program_active` is seeded, anon-readable and **false**; anon cannot switch it on; `loads.deadhead_miles` stays inside existing tenant isolation. |
| `npx playwright test` | **160** (was 145) | `tests/e2e/integrity.spec.ts` (15) — unsubscribe page states in en + es, `noindex`, one-click GET redirects instead of acting, POST 400 on missing/malformed token, repeat POSTs identical; referral copy absent on `/`, `/dispatch/dry-van`, `/truck-dispatch/new-jersey` and in es/fr; footer label gated; packet pending toast; no testimonials band and no leaked sample quote. |

**Honest limitation.** The e2e lane is secretless by design (M-41), so the
"POST unsubscribes → second POST is idempotent with no second UPDATE"
assertion cannot run there — there is no row to unsubscribe. That assertion
lives in the unit suite against a stubbed admin client; e2e proves the
endpoint contract (status codes, no GET side effect, repeat-safety) instead.

---

## Files

**New:** `src/lib/company-settings.ts` · `src/lib/newsletter.ts` ·
`src/lib/newsletter-unsubscribe.ts` · `src/lib/testimonials.ts` ·
`src/app/[locale]/(site)/newsletter/unsubscribe/page.tsx` ·
`src/app/api/newsletter/unsubscribe/route.ts` ·
`src/components/forms/UnsubscribeForm.tsx` ·
`src/components/sections/PacketSection.tsx` ·
`src/components/sections/Testimonials.tsx` ·
`src/components/sections/TestimonialsSection.tsx` ·
`supabase/migrations/{0014,0015,0016}_*.sql` ·
`tests/unit/newsletter.test.ts` · `tests/unit/settings-gates.test.tsx` ·
`tests/e2e/integrity.spec.ts` · this doc.

**Changed:** `eslint.config.mjs` (the P-4 rule) · `src/lib/audit.ts` consumers
(`actions/staff.ts`, `actions/carrier-portal.ts`, `actions/account.tsx`,
`actions/quotes.ts`) · `actions/carrier.ts` (P-5) · `actions/newsletter.tsx`
(unsubscribe action + headers) · `actions/loads.ts` + `LoadForms.tsx`
(deadhead capture) · `lib/email/send.ts` (`headers` passthrough) ·
`lib/loads.ts` (P-7) · `emails/NewsletterConfirmationEmail.tsx` ·
`components/sections/{CtaBand,Packet}.tsx` · `components/layout/Footer.tsx` ·
`app/[locale]/(site)/layout.tsx` + the 5 CtaBand call sites +
`portal/page.tsx` · `portal/admin/{page,loads/page}.tsx` ·
`portal/carrier/loads/page.tsx` · `lib/supabase/database.types.ts` ·
`scripts/extract-i18n.mjs` + `messages/*.json` (13 new keys × 5 locales) ·
`supabase/seed.sql` · `supabase/tests/20_rls_isolation.sql` ·
`tests/unit/loads.test.ts`.

### i18n

13 new supplemental keys, authored **es/fr**; **ru/ht mirror English pending
native review**, flagged as a content prerequisite exactly like the
M-42/M-55/M-56 precedent. The restored testimonials band reuses the V4
prototype's own "What carriers say" / "Word of mouth is our load board."
entries, which already exist in all five locales — re-declaring them in
`SUPPLEMENTAL` would have **overwritten** the prototype's ru/ht wording, so
they are deliberately left alone (noted in `scripts/extract-i18n.mjs`). The
regenerated catalogues are purely additive: no existing translation changed.

---

## Extension points

- **M-86** (newsletter completion) inherits a working opt-out. Every future
  campaign send must reuse `marketingUnsubscribeHeaders()` and print
  `unsubscribeUrl()` in the footer; the token is already on every subscriber
  row. Segmentation/export should exclude `unsubscribed_at is not null` —
  the column now genuinely means something.
- **M-87** (testimonials) has one job in this area: replace the body of
  `getApprovedTestimonials()`. The gate, the V4 markup, the i18n keys and the
  tests are already in place, and the second lock means a half-built table
  cannot leak placeholder content.
- **M-92** (Downloads Center) can now build on a real `packet_downloads_live`
  gate instead of the fake one flagged as regression risk R-3.
- **M-72** (`shipment_events`) and **M-97** (audit-log expansion) build on an
  `audit_events` ledger whose single-writer contract is now enforced by lint,
  not just by documentation.
- **M-88** (carrier scorecard) can use `formatTrueRpm` directly — true RPM is
  one of the carrier-management playbook's five dispatch economics metrics,
  and the column now exists to feed it.
- `getBooleanSetting()` is the place to add future gates. Adding a key to
  `BooleanSettingKey` is **not** sufficient: it also needs an idempotent
  upsert migration *and* a `supabase/seed.sql` row, or environments silently
  get the fallback.

## Not fixed here (deliberate)

- The **referral programme itself** is not built — P-2 was scoped as "stop
  the promise", and §32 J / M-95 owns the feature. Decision **D-1** in the
  plan offered removal; gating preserves the approved copy and the five
  translations while achieving the same honesty, and needs no owner sign-off
  on marketing language.
- **Real testimonial data** — M-87 supplies it, as stated above.
- The four **counsel-approved packet PDFs** are a legal deliverable, not an
  engineering one; the gate is ready for them.
