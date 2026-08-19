# M-94 — Wiring the FMCSA pre-registration gate into real carrier onboarding

**Branch:** `final-website-production` · **Baseline:** M-93 (`e59c248`)
**Status:** implemented, committed locally, **not pushed and not deployed**.

---

## 1. What this module is

M-93 built a carrier-authority engine — an FMCSA QCMobile adapter, an identity
matcher, a deterministic risk engine, an activation gate and three tables
(migration `0032`). **Nothing in `src/` imported any of it.** It was a library
sitting beside a live onboarding flow that had never heard of it.

M-94 is the join. The public carrier onboarding now begins with a server-side
FMCSA check, and no `carriers` row, no auth user and no portal account can be
created without a stored, live, unspent pre-registration that the risk engine
marked `eligible_to_continue`.

**Not in this module** (§28): Stripe Checkout, live $9.99 collection, refunds,
the credit provider, SignWell template changes, brokerage activation, automatic
carrier activation.

---

## 2. The previous flow

```
[Company info form] ──► carriers row created ──► documents ──► agreement ──► account
        ▲
        └─ this was step 1: a `carriers` row appeared the moment somebody typed
           a company name. No authority check, no payment, no identity check.
```

Consequences that were live before this change:

* `carriers` was a table of strangers. "Has this carrier been verified?" was
  unanswerable, because the row existed either way.
* `startOnboarding` had a secretless-dev shortcut that returned
  `{status: "success", carrierId: randomUUID()}` when no service-role key was
  configured — a wizard handle minted for a caller nobody checked.
* Two guard-passing submissions produced two carrier rows. There was no
  idempotency key on the insert and the old test said so honestly.
* The public page presented a four-step process starting with "Company info".

---

## 3. The new flow

```
1. Carrier verification   ← M-94.   FMCSA USDOT + MC + legal-name check.
                                    Creates ONLY a pre-registration.
2. Verification fee       ← M-95.   $9.99. Placeholder state today; nothing
                                    is charged and nothing is marked paid.
3. Company info           ← gated.  startOnboarding: creates the carriers row
                                    and SPENDS the pre-registration.
4. Documents
5. Agreement (SignWell)
6. Portal account         ← gated.  completeOnboarding: requires the carrier
                                    row to have a pre-registration bound to it.
                              ─────
   Staff compliance review → activation (evaluateActivationEligibility, M-93)
```

The step strip renders **six** steps, not §23's suggested five. There is a real
company-details step between the fee and the documents — the wizard needs a
contact name, a phone number and a home state before it can create anything —
and folding it into a neighbour to hit a target count would be the inaccurate
labelling §23 is about. `tests/e2e/i18n-locales.spec.ts` also samples the
translated string "Company info" on this route.

---

## 4. Trust boundaries

| Boundary | Who may cross it | Enforced by |
|---|---|---|
| FMCSA credential | server only | `import "server-only"` in `fmcsa-qcmobile.ts`; `FMCSA_WEBKEY` read from `process.env` inside it |
| Raw FMCSA payload | never persisted, never returned | the adapter normalizes and keeps only a SHA-256 digest (`raw_response_sha256`) |
| The decision | computed and stored server-side, re-read on every use | `runCarrierPrecheck` → `carrier_pre_registrations.decision`; `loadEligiblePreRegistration` re-reads it |
| The pre-registration id | httpOnly cookie, never in the DOM | `precheck-session.ts` |
| Reason codes | staff only, except three applicant-safe ones | `APPLICANT_SAFE_REASON_CODES` (M-93), `publicReasonCodes()` |
| The three 0032 tables | staff, or the service role | `0032` RLS: no `anon` policy and no `authenticated` policy exists |

**There is no parameter anywhere in this module through which a caller can
assert a verdict.** `PrecheckState` — the only shape the browser receives — has
exactly one field, `status`, plus an error message. No id, no reason codes, no
`verified` boolean. §17's forged fields are not ignored at runtime; they are
unrepresentable.

---

## 5. The server-side FMCSA call sequence

```
submitCarrierPrecheck (server action)
  └─ guardPublicForm("carrier-precheck")      rate limit → Turnstile
  └─ carrierPrecheckSchema.safeParse           normalize USDOT/MC, reject junk
  └─ runCarrierPrecheck
       ├─ INSERT carrier_pre_registrations (status: pending)
       ├─ audit: pre_registration_created, fmcsa_check_started
       ├─ Promise.all([
       │     provider.lookupByUsdot(usdot),        GET /carriers/{dot}
       │     provider.lookupDocketNumbers(usdot),  GET /carriers/{dot}/docket-numbers
       │  ])
       ├─ evaluatePrecheck  (PURE)
       │     merge dockets into the record
       │     compareIdentity  → name / dot / mc / DOCKET relationship
       │     assessCarrierRisk → decision + tier + reason codes
       ├─ INSERT carrier_verifications (normalized fields + digest)
       ├─ UPDATE carrier_pre_registrations (status, tier, decision, codes)
       └─ audit: fmcsa_check_completed + the decision event
  └─ eligible → setPrecheckCookie(id);  otherwise no cookie at all
```

The two lookups run concurrently: sequentially they would double the worst case
an applicant waits through for no benefit. Neither can throw — the adapter
converts every failure into a status.

The row is created **before** the provider is called, in `pending`, so a lookup
that times out still leaves a record a human can pick up. An applicant whose
FMCSA call failed is exactly the applicant manual review exists for.

### The MC ↔ USDOT check (§6, non-negotiable)

The docket set from `/carriers/{dot}/docket-numbers` is merged into the record
and compared by `matchDocketRelationship`, which requires `prefix === "MC"`.
FF and MX numbers live in separate series and collide with MC numbers freely,
so digits alone are never enough:

| Submitted | FMCSA holds | Result |
|---|---|---|
| MC-777777 | FF-777777 only | **mismatch** → MANUAL_REVIEW |
| MC-777777 | MX-777777 only | **mismatch** → MANUAL_REVIEW |
| MC-777777 | MC-777777 | relationship confirmed |
| MC-123456 | MC-123456 + FF-900001 + MX-123456 | confirmed (multi-series) |
| MC-123456 | docket call failed | **unverified** → MANUAL_REVIEW |

`dockets: null` means "not retrieved" and `[]` means "retrieved, none exist".
The two are never collapsed, because only one of them is a finding about the
carrier.

---

## 6. Decision states and failure behaviour

`ELIGIBLE_TO_CONTINUE` · `MANUAL_REVIEW` · `NOT_ELIGIBLE`.

Everything below routes to MANUAL_REVIEW. None of them can become VERIFIED and
none can become NOT_ELIGIBLE:

FMCSA timeout · 429 · 5xx · malformed JSON · unrecognised envelope · credential
rejected · docket endpoint unavailable · provider not configured · unknown
authority token · absent authority fields · legal-name material mismatch ·
MC↔USDOT unverified · MC not provided · database write failure · **no
service-role key**.

NOT_ELIGIBLE is reachable from exactly two places, and both require FMCSA to
have said something affirmative:

* `not_found` — FMCSA has no such USDOT (`USDOT_NOT_FOUND`);
* `outOfService === true`, or `allowedToOperate === false`.

A `null` out-of-service flag is never read as `false`.

**Insurance** (§10): `INSURANCE_REVIEW_REQUIRED` is emitted unconditionally.
FMCSA *does* expose bipd/cargo/bond filing indicators — they are normalized as
`FmcsaInsuranceIndicators` for the staff view and **no rule reads them**. A
federal filing is not a PickLoads COI.

**Safety** (§11): `crashTotal`, OOS rates and `safetyRating` are normalized and
change nothing. There is no PickLoads safety score and no hidden ranking. A
test asserts a carrier with 91 crashes and 88% vehicle OOS gets the same
decision as a clean one.

---

## 7. The account-creation boundary

**What the pre-check creates:** one `carrier_pre_registrations` row and one
`carrier_verifications` row.

**What it does not create:** an auth user, a `carriers` row, a portal account,
a membership, a CRM lead, a document folder, a signature request, a payment
row. It does not set `carriers.active` and it does not charge anything. A test
asserts the exact set of tables written and that no row carries `active`,
`profile_id`, `claimed_carrier_id` or a payment status.

### `startOnboarding` — the gate

1. `guardPublicForm` (rate limit + Turnstile) — first, before anything.
2. `readPrecheckCookie()` → `loadEligiblePreRegistration()`, which re-reads
   **decision, expiry and claim** from the row. Missing / malformed / unknown /
   expired / already-claimed / not-eligible / unreadable all refuse.
   No service-role key also refuses: an unverifiable claim is not waved through.
3. **Company name, MC and USDOT are taken from the pre-registration**, never
   from the submitted form. Without this, an applicant could verify as one
   carrier and register as another by editing three fields between two
   requests, and the whole check would have proved nothing.
4. Insert the `carriers` row, then `claimPreRegistration` — a conditional
   `UPDATE ... WHERE claimed_carrier_id IS NULL AND decision = 'eligible_to_continue'
   AND expires_at > now()`. Postgres evaluates that under the row lock, so two
   requests racing on one verification cannot both win.
5. If the claim loses, the just-created `carriers` row is **deleted**. A carrier
   row with no verification bound to it is the orphan this milestone exists to
   stop creating; leaving one on the error path would reintroduce it one race
   at a time.
6. Clear the cookie.

### `completeOnboarding` — the account gate

`startOnboarding` is not the only door to an account. This action takes a
`carrier_id` and creates an auth user for it, so it has its own check, and it
is a fact about the row rather than a claim about the request: a
`carrier_pre_registrations` row must exist with `claimed_carrier_id =` this
carrier and `decision = 'eligible_to_continue'`.

**Accepted consequence:** `carriers` rows created by the pre-M-94 flow have no
pre-registration and can no longer self-serve an account. That is the correct
side of the trade — those rows are exactly the unverified strangers this
milestone exists to stop — but it is a real operational change. See §12.

Nothing here touches `evaluateActivationEligibility()`. There is no override,
no bypass, and `carriers.active` is still written by nobody.

---

## 8. Database

**One migration, `0033`, and it adds three columns to an existing table** —
`reviewed_by`, `reviewed_at`, `review_note` — for the staff queue (§17). No new
TABLE: `0032` (M-93) already models everything the gate itself needed, and
adding one would have created a second answer to "is this applicant verified?".

`0033` also adds a `pre_registration_review_is_whole` check (a reviewer and a
timestamp, or neither) and a partial index for the queue's own query. It defines
NO new policy: 0032's `staff manage pre registrations` is `for all using
(is_staff())` and already covers every column, and two rules governing one table
is how a table ends up with two different answers about who may write it.

What M-94 adds is the TYPES for those tables — `carrier_pre_registrations`,
`carrier_verifications`, `carrier_onboarding_payments` in
`src/lib/supabase/database.types.ts`. They shipped without types because
nothing consumed them; an untyped `.from("carrier_pre_registrations")` would
have made every column name a string literal nobody checks.

`carrier_onboarding_payments` is declared now although **M-95 owns its writes**:
the gate has to be able to say "not paid" long before anything can say "paid".

### RLS

`0032` enables RLS on all three tables and defines **one** policy each,
`using (is_staff())`. There is no `anon` policy and no `authenticated` policy,
so Postgres denies every verb to a browser session by default — the denial is
the absence of a rule, not the outcome of one.

That was a claim in a comment until this module. `supabase/tests/20_rls_isolation.sql`
§18 now asserts it with **37 new assertions**, including the two §26 names:

* an ANONYMOUS attempt to mutate `verification_status` changes nothing, and
  neither can anyone forge a staff review (`reviewed_by` / `reviewed_at` /
  `review_note`, §18f);
* a CARRIER cannot self-approve a manual-review pre-registration, cannot mark
  itself paid, cannot erase its reason codes, cannot un-spend a claimed
  pre-registration, and cannot set `carriers.active = true`;
* a carrier cannot read the pre-registration bound to **its own** carrier row —
  ownership is not a route in, because no `authenticated` policy exists at all;
* holding the exact opaque UUID does not let `anon` read the row, which is what
  makes it safe to carry in a cookie;
* non-vacuity: the rows exist, RLS is enabled on all three, and no policy on
  any of them names `anon` or `authenticated`.

---

## 9. Rate limiting, Turnstile, enumeration

`guardPublicForm("carrier-precheck", …)` — the standard public-form pipeline,
5 submissions per 10 minutes per IP (Upstash sliding window) plus a Cloudflare
Turnstile siteverify, both **before** the service-role client is touched and
before a single byte goes upstream.

This matters more here than on a lead form: an unauthenticated endpoint that
performs an FMCSA lookup on demand, with our credential paying for it, is an
FMCSA enumeration proxy. Tests assert that a rate-limited or Turnstile-refused
submission reaches the provider **zero times**.

The refusal message says nothing about how the limit is keyed — no IP, no
window, no bucket, no token — and rate-limit and Turnstile refusals are
indistinguishable to the caller.

Public responses carry no FMCSA record: no EIN, no physical address, no
insurance filing, no raw payload, no internal database id, no provider error,
no WebKey, and no risk reason code outside the applicant-safe three
(`USDOT_NOT_FOUND`, `MC_NOT_PROVIDED`, `PROVIDER_UNAVAILABLE`).

---

## 10. Audit events and analytics

**Audit** (`audit_events`, service-role writer, staff-read-only):
`pre_registration_created` · `fmcsa_check_started` · `fmcsa_check_completed` ·
`pre_registration_eligible` · `manual_review_required` ·
`pre_registration_not_eligible` · `onboarding_gate_denied`.

`onboarding_gate_denied` carries the internal reason (`missing`, `malformed`,
`unknown`, `expired`, `already_claimed`, `not_eligible`, `unavailable`,
`unverified_carrier`) — "expired" and "somebody is replaying a spent token" are
very different operational events. **The applicant is shown one neutral
sentence for all of them**, and a test asserts every refusal produces the same
message.

No audit detail carries a secret, an email, a raw payload or a WebKey.

**Analytics** (§22): `carrier_precheck_started`, `_completed`,
`_manual_review`, `_not_eligible`, `_continue`. `AnalyticsParams` has no field
that could carry an MC, a USDOT, a legal name or an email — the taxonomy is a
closed union with three low-cardinality parameters, so honouring §22 is
structural rather than a matter of remembering.

---

## 11. UX, responsiveness, accessibility, i18n

* `/become-a-carrier` opens on the verification form. The old four-step strip
  is gone; the hero and the page `<description>` say verification comes first.
* The three outcome screens: **verified** ("no account has been created yet" +
  "Continue to verification fee"), **manual review** (explicitly *not* a
  decision about the application, with a phone number and an email address),
  **not eligible** (§5's neutral wording, no mechanism named).
* The fee step states plainly that card payment is not live, that nothing is
  charged today, and that no account is activated until the fee is settled.
  It creates no session and records no payment. §13/§28.
* The success screen no longer says "You're onboarded." It says
  **"Account created — pending compliance review."** and names what is still
  outstanding. §23.
* **Mobile** (§24): `inputMode="numeric"` on USDOT and MC (not `type="number"`,
  which brings spinners and a scroll wheel that edits a registration number);
  the six-step strip reflows 3→2→1 columns; no horizontal overflow at 320px.
* **Accessibility** (§25): every field has a `<label for>`, hints are wired
  through `aria-describedby`, the outcome heading takes focus when it replaces
  the form (2.4.3), errors are in a `role="alert"` region and the verified
  state in `role="status"`, and no state is signalled by colour alone.
* **i18n**: 32 new v4 keys, all authored in `es` and `fr`. Nine mirror English
  in `ru` and `ht` — the price, the two "what an account does not mean"
  sentences, the payment statement, the adverse-outcome sentence and the three
  public promises about the process. Those are the categories
  `docs/COWORK-CONTENT-REVIEW.md` §3 reserves for a native translator. The
  ratchet in `tests/unit/i18n-coverage-ratchet.test.ts` was raised (ru 521→530,
  ht 540→549) with that accounting written into the file.

---

## 12. Known remaining blockers

Closed since the first M-94 pass: the staff queue (§17), legacy carrier
handling (§18), and the two unrun test lanes (§19).

1. **The $9.99 fee is not collected.** M-95. The step exists, says so, and
   marks nothing paid. `PAYMENT_CONFIRMED` remains false in the activation
   gate.
2. **Nothing activates carriers.** `carriers.active` is still written by no
   code path — including the staff review queue, which resolves a
   pre-registration and nothing else. `evaluateActivationEligibility()` is
   pure and unwired. That is M-93's finding and it is unchanged here.
3. **The secretless-dev wizard walkthrough is gone past step 1.** Without a
   service-role key the pre-registration cannot be read, so the gate refuses.
   Keeping it walkable would have meant trusting the browser, which is the
   bypass §16 asks to close. The e2e lane runs without a service key and
   therefore exercises the pre-check screen and the refusal, not a full
   walkthrough.
4. **Live FMCSA has not been exercised through this path.** `FMCSA_WEBKEY` is
   not available in this environment. M-93 validated the adapter against the
   live service; M-94's own tests stub the provider. The first live pre-check
   should be watched — and note that the legacy adoption path (§18) makes a
   real FMCSA call too, so the same caveat applies to the first adoption.
5. **The legacy backlog has not been worked.** The mechanism exists and is
   tested; the actual pre-M-94 rows in production have not been through it.
   Someone has to sit with the queue. Until they do, those applicants cannot
   finish onboarding — which was already true, and is now fixable.
6. **iOS device validation for M-94b is outstanding.** External to this
   codebase; see `M-94b-mobile-nav-scroll-lock.md` §5.

---

## 13. Environment variables

No new variables. M-94 consumes what M-93 declared:

| Variable | Used by | Behaviour when unset |
|---|---|---|
| `FMCSA_WEBKEY` | `fmcsa-qcmobile.ts`, server only | provider reports `not_configured` → every pre-check is MANUAL_REVIEW. Never "verified", never a refusal. |
| `SUPABASE_SERVICE_ROLE_KEY` | the orchestrator and both gates | no pre-registration can be written or read → pre-check is MANUAL_REVIEW and onboarding is refused |
| `UPSTASH_REDIS_REST_*` | `checkRateLimit` | limiter disabled (logged); Turnstile still gates |
| `TURNSTILE_SECRET_KEY` | `verifyTurnstile` | check skipped (logged) |

---

## 14. Extension points

* **M-95 (payment).** `carrier_onboarding_payments` is typed and its
  duplicate-payment index is in `0032`. The fee step is a placeholder component
  in `CarrierWizard.tsx`; replacing it with a Checkout redirect needs the
  pre-registration id, which is already in the httpOnly cookie and already
  re-validated by `loadEligiblePreRegistration`. The gate should gain a
  `payment_status = 'paid'` condition at that point — deliberately absent today
  rather than present and unenforced.
* **Staff queue.** Read `carrier_pre_registrations` joined to
  `carrier_verifications`; `reason_codes` and `risk_tier` are the staff-facing
  explanation and are already stored. Do not surface them to applicants.
* **Periodic re-verification.** `carrier_verifications.next_verification_at`
  and `idx_verifications_due` exist for it; `carrier_id` (rather than
  `pre_registration_id`) is the arm of the `verification_targets_exactly_one`
  constraint that a re-check of an onboarded carrier uses.
* **A different authority provider.** Implement `CarrierAuthorityProvider`.
  Nothing above `pre-registration.ts` knows the provider's name, and
  `runCarrierPrecheck` takes it as an injectable dependency — which is also how
  the tests reach every failure mode without a fake HTTP server.

---

## 15. Files changed

**New**

```
src/lib/carrier-authority/pre-registration.ts     orchestrator + pure decision + the gate
src/lib/carrier-authority/precheck-session.ts     the httpOnly cookie
src/lib/validation/carrier-precheck.ts            the public form's schema
src/lib/carrier-precheck-state.ts                 shared client/server state
src/app/actions/carrier-precheck.ts               the public server action
src/components/onboarding/CarrierPrecheck.tsx     step 1 UI + three outcomes

supabase/migrations/0033_pre_registration_staff_review.sql
src/lib/validation/carrier-review.ts              review + legacy-adoption schemas
src/lib/carrier-authority/review-labels.ts        staff-facing reason labels
src/app/actions/carrier-review.ts                 resolve a manual review
src/app/actions/carrier-legacy.ts                 adopt a pre-M-94 carrier row
src/app/[locale]/portal/admin/carrier-verifications/page.tsx        the queue
src/app/[locale]/portal/admin/carrier-verifications/[id]/page.tsx   the detail
src/components/portal/CarrierReviewForm.tsx       the decision form
src/components/portal/LegacyCarrierAdoptForm.tsx  the adoption control

tests/unit/carrier-precheck.test.ts               48 tests — the decision matrix
tests/unit/carrier-precheck-action.test.ts         9 tests — the public door
tests/unit/carrier-review-queue.test.ts           25 tests — the staff surface
tests/unit/carrier-legacy-adoption.test.ts        17 tests — adoption, not exemption
tests/e2e/carrier-verifications-gate.spec.ts       4 tests — anonymous access
docs/modules/M-94-carrier-pre-registration-wiring.md
```

**Changed**

```
src/app/actions/onboarding.tsx                    both gates
src/components/onboarding/CarrierWizard.tsx       six steps; honest success copy
src/lib/onboarding-state.ts                       StartState.companyName
src/lib/supabase/database.types.ts                the 0032 tables, typed
src/lib/analytics.ts                              five precheck funnel events
src/app/[locale]/(site)/become-a-carrier/page.tsx hero + metadata
src/app/v4.css                                    .field-hint, six-step grid
messages/{en,es,fr,ru,ht}.json                    32 keys
supabase/tests/10_fixtures.sql                    0032 fixtures
supabase/tests/20_rls_isolation.sql               §18 — 43 assertions
src/components/portal/PortalSidebar.tsx           the queue's nav entry
tests/unit/onboarding-step1.test.ts               rewritten for the gate (37 tests)
tests/unit/i18n-coverage-ratchet.test.ts          ru/ht baselines + the accounting
tests/e2e/become-a-carrier.spec.ts                5 tests for the new first step
```

---

## 16. Gate result

| Lane | Baseline (M-93) | Now |
|---|---|---|
| `npm run typecheck` | clean | **clean** |
| `npm run lint` | clean | **clean** |
| unit (`npm test`) | 2105 + 4 skipped | **2221 + 4 skipped** |
| e2e (`npm run test:e2e`) | 629 | **649** |
| RLS (`npm run test:rls`) | 806 | **849** |
| integration (`npm run test:integration`) | 369 | **369** |
| pages built | 434 | **439** |
| `npm audit` | 0 | **0** |

Nothing decreased. The RLS baseline of 806 was re-measured against the
pre-M-94 versions of the two suite files rather than taken from the previous
report — see §19.

The five new pages are the queue route across the five locales; the review
detail route is dynamic (`ƒ`) because it carries a parameter. Both render the
same way every other `/portal/admin` page does.

---

## 17. The staff manual-review queue

`/portal/admin/carrier-verifications` (+ `/[id]`), in the sidebar as **Carrier
verifications**, for `admin` and `dispatcher`.

### Why dispatcher and not admin-only

Resolving an FMCSA timeout or a legal name that differs by more than
punctuation is dispatch work, and a queue only admins can see is a queue that
waits for an admin while a real carrier waits for us. The surfaces that decide
*who a counterparty is* — broker partners, users, settings — stay admin-only,
and this one does not belong with them because clearing an application grants
nothing: it lets somebody pay a fee and upload documents.

### What a reviewer sees

Three things side by side, because the decision is a comparison: what the
applicant **typed** (never overwritten — that is why 0032 stores it
separately), what FMCSA **returned** normalized, and what the engine
**concluded** as reason codes with plain-English labels
(`review-labels.ts`).

Deliberately absent, and asserted absent by
`tests/unit/carrier-review-queue.test.ts`:

* no raw FMCSA payload — it is never stored; the SHA-256 digest is shown
  truncated as provenance, not as data;
* no EIN and no physical address — both are in the live FMCSA response and
  both are dropped at the adapter boundary, so there is no column that could
  render them;
* no `FMCSA_WEBKEY` — it exists only in `process.env` inside a `server-only`
  module;
* no insurance filing presented as compliance (§10).

### What a reviewer can do

Two outcomes — **clear to continue** or **not eligible** — and a mandatory note
of at least twelve characters, because "why did we let this through?" is the
only question a cleared carrier ever generates and "ok" does not answer it.

`reviewCarrierPreRegistration` writes `decision`, `manual_review_required`,
`reviewed_by`, `reviewed_at`, `review_note` and appends
`STAFF_REVIEW_CLEARED` / `STAFF_REVIEW_REFUSED` to the engine's own codes. It
writes **nothing else** — not `verification_status`, not `risk_tier`, not
`payment_status`, not `expires_at`, not `claimed_carrier_id`, and no row in any
other table.

`verification_status` is the sharpest of those omissions and the reason is in
`0033`'s header: a dispatcher clearing an applicant after an FMCSA outage has
not made FMCSA answer. Keeping the provider's statement separate from the
human's is what lets a later activation gate tell "the authority confirmed
this" apart from "somebody decided it was fine".

### Safety properties

* **Staff gate re-read from the session on every call.** A server action is a
  public HTTP endpoint; the page that rendered the form is not a control.
* **The write runs cookie-bound**, so RLS re-checks `is_staff()` at the
  database. The service role appears once, inside `recordAuditEvent`, because
  `audit_events` grants INSERT to nobody.
* **Only an application actually in `manual_review` and actually unspent can
  be resolved**, and both conditions are re-asserted inside the UPDATE — two
  dispatchers pressing at once means exactly one wins.
* **Audited** as `pre_registration_staff_review` with the actor, the target
  and the outcome. The note's TEXT is not copied into the ledger; its length
  is. The note itself lives in its own column.
* **No activation.** No `carriers` row is touched and `evaluateActivationEligibility()`
  is neither called nor bypassed. A source-level test asserts that no staff
  surface in this module contains `active: true` or references the activation
  gate at all.

---

## 18. Legacy carriers

### The blast radius, measured rather than assumed

`completeOnboarding` requires the `carriers` row to have a pre-registration
bound to it. Two groups could in principle be affected; only one actually is.

* **Carriers who already have an account** (`profile_id` is not null) —
  **unaffected**. `completeOnboarding` refuses them earlier and always did
  ("this application already has an account — sign in instead"), and no other
  code path in the product reads a pre-registration: the only consumers are
  the two onboarding actions and the staff surfaces above. Their portal,
  documents, agreements, loads and invoices are untouched.
* **Unclaimed rows** (`profile_id` is null) created by the old flow — these
  are mid-wizard applicants, and they are the ones who could not finish.

### The strategy: adoption, not exemption

A "Applications that predate verification" section on the queue page lists
exactly that set, with one control per row: **Verify with FMCSA**.

It runs the **same** `runCarrierPrecheck` a public applicant runs, on the
carrier row's own identity, and binds the result only if the engine cleared it.
There is no exemption flag, no grandfather column, and no parameter anywhere in
`adoptLegacyCarrier` that skips a check. An application FMCSA refuses stays
refused; one the engine cannot decide alone lands in the review queue like any
other and is resolved by a human on the record.

Two details make it work in practice:

* **The reviewer supplies the email**, because the old `carriers` table never
  had one, and the **USDOT** when the row has none — the old wizard made USDOT
  optional, so a great many legacy rows simply do not carry one. Nothing else
  is retyped: the legal name and MC come from the row itself.
* **It is safe to press twice.** The common path is: run it → MANUAL_REVIEW →
  a dispatcher clears it in the queue → somebody presses the button again. The
  second press finds the now-eligible application and BINDS it instead of
  creating a duplicate, and while one is still awaiting review it refuses to
  start another. The lookup is keyed on the USDOT **and** a `LEGACY_ADOPTION`
  marker code, so it can never bind a pre-registration a member of the public
  created for themselves and has not used yet.

On a successful bind the carrier row's `company_name`, `dot_number` and
`mc_number` are re-written from the verified application — the same rule
`startOnboarding` follows, and for the same reason: leaving an unverified
identity on the record the rest of the product reads would defeat the check.
`active` is not among them.

Audited as `legacy_carrier_verification_run` (every attempt, with the decision)
and `legacy_carrier_verification_bound` (only when a binding actually
happened).

### What this does NOT do

It does not create accounts, send email, charge anything or activate anybody.
After adoption the carrier is exactly where a new applicant is after a clean
pre-check: able to continue, and approved for nothing.

---

## 19. Running the RLS and integration lanes here

Both lanes ran and passed. Getting there needed a workaround worth recording,
because the next person on this machine will hit the same wall.

### The failure

Native PostgreSQL **cannot fork a backend** in this environment. The postmaster
starts, binds, logs "database system is ready to accept connections" — and then
every child process dies with Windows `0xC0000142` (`STATUS_DLL_INIT_FAILED`).
The first casualty is the autovacuum worker at exactly the two-minute naptime;
every `psql` connection hangs the same way, because the backend it needs is
never born.

It is not the agent sandbox (it fails identically with the sandbox disabled),
not the shell (PowerShell-started servers fail the same), and not the data
directory. The decisive test is **single-user mode**, which does not fork:

```
postgres --single -D <datadir> postgres   →   works
```

The engine, the cluster and the SQL path are all healthy. Only PostgreSQL's
Windows fork-emulation — `CreateProcess` of a suspended `postgres.exe` child
followed by writing the parent's state into it — fails. Nothing in this
repository can fix that, and no test change should try.

### The workaround that actually executed the suites

PGlite is the same PostgreSQL engine compiled to WASM: one process, no fork.
`@electric-sql/pglite-socket` puts it on TCP speaking the wire protocol, so the
project's **real runners** connect to it with `psql`, unmodified.

```bash
# in a scratch directory OUTSIDE this repo (no dependency is added to it)
npm init -y && npm pkg set type=module
npm install @electric-sql/pglite @electric-sql/pglite-socket

# serve.mjs
#   import { PGlite } from "@electric-sql/pglite";
#   import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
#   const db = await PGlite.create();
#   await new PGLiteSocketServer({ db, port: 5433, host: "127.0.0.1" }).start();
node serve.mjs &

# then, in the repo, the ordinary commands:
export PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres
npm run test:rls          # → 849 assertions passed
npm run test:integration  # → 369 passed
```

**One caveat that matters:** PGlite has a single database, and both runners
begin with `drop database … / create database …`. Restart `serve.mjs` between
the two lanes or the second inherits the first's schema and fails on
`type "user_role" already exists`.

### Why the numbers can be trusted

* The **baseline was re-measured**, not quoted: running the suite with the
  pre-M-94 versions of `10_fixtures.sql` and `20_rls_isolation.sql` (from
  `git show HEAD:…`) yields exactly **806**, the figure M-93 reported. The
  delta is therefore real.
* **Non-vacuity was proven**: flipping one §18 expectation from 3 to 99 turns
  the run red with `RLS ASSERTION FAILED … (expected 99 row(s), got 3)` and a
  non-zero exit. A harness that cannot fail proves nothing.
* The suite **caught a bad assertion of mine** during this work — an early
  §18f line asserted no carrier is active, which the fixtures deliberately
  contradict (two active tenants exist for the isolation tests). It was
  replaced with the claim that is actually true and actually meaningful:
  resolving a review creates no carrier account.

### The proper fix

A native PostgreSQL 16/17 on a machine that can fork, or Docker/WSL — neither
is available here. If the team wants this reproducible in CI, vendoring the
PGlite runner as a dev dependency is a reasonable follow-up; it was deliberately
kept out of the repository rather than adding to a locked stack unasked.
