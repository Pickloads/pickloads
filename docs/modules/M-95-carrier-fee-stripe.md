# M-95 — The $9.99 carrier pre-registration fee (Stripe)

**Branch:** `final-website-production` · **Baseline:** M-94 / M-94b (`29e652f`)
**Status:** implemented in **Stripe TEST MODE ONLY**, committed locally, **not
pushed, not deployed, no live charges**.

---

## 1. The flow, and where this module sits in it

```
1. FMCSA verification          M-94
2. Eligibility / review gate   M-94  (+ the staff review queue)
3. $9.99 Stripe payment        ← M-95
4. Company information         M-94  startOnboarding — now ALSO needs (3)
5. Documents
6. Agreement (SignWell)
7. Portal account              M-94  completeOnboarding
```

M-94's FMCSA gate is untouched. No eligibility semantics changed, and no
defect was found in them.

---

## 2. The one rule

**A carrier advances past the payment gate only when a row exists in
`carrier_onboarding_payments` with `status = 'paid'`, written by the
signature-verified Stripe webhook.**

Not trusted, anywhere, by anything:

| Not trusted | Why it cannot help an attacker |
|---|---|
| the return URL / `?return=success` | selects a *sentence* on the return page; the state comes from the ledger. Asserted by `tests/e2e/carrier-fee-return.spec.ts` |
| client state | `FeeCheckoutState` has no `paid` member to set — the shape cannot express it |
| localStorage / sessionStorage | never read; the wizard step is a server conclusion (`wizard-resume.ts`) |
| a submitted `payment_status` | `startCarrierFeeCheckout` reads **no** form field at all — asserted at source level |
| `carrier_pre_registrations.payment_status` | a MIRROR for the staff queue. The gate deliberately reads the ledger instead |

---

## 3. Reusing the existing Stripe architecture

There is **one** Stripe integration, not two: the same account, the same
`/api/stripe/webhook` endpoint, the same `STRIPE_WEBHOOK_SECRET`, the same
`webhook_events (provider, event_id)` idempotency ledger and the same ops-alert
path M-31 built. M-95 adds event branches to it.

A second endpoint would have meant a second signing secret, a second dedup
table and two places to get signature verification right.

M-31's compliance rule is unchanged: PickLoads bills its own dispatch fee and
now its own onboarding fee. **No freight money transits a PickLoads account.**

---

## 4. Checkout Session

Created in `src/app/actions/carrier-fee.ts`, server-side only, in this order:

1. **Rate limit** — 12 per 10 min per IP. This creates objects in a payment
   processor; an unbounded endpoint is an unbounded liability.
2. **The M-94 gate** — `loadEligiblePreRegistration` must return an eligible,
   live, unspent pre-registration. **A MANUAL_REVIEW applicant cannot reach a
   Checkout at all**, which is the §"MANUAL REVIEW" requirement enforced by
   construction rather than by a later check.
3. **Already paid?** — the ledger is consulted; a settled applicant is told so
   and no session is created.
4. **Open session?** — an existing `open` Checkout is reused rather than
   creating a second payable object for one fee.
5. **The price is verified** (see §5) — *before* a session exists.
6. **Create**, then **record** a `session_created` row. If that row cannot be
   written, the session is **expired immediately** and the applicant is not
   sent to it: a payment with no row is money taken for something we cannot
   prove they bought.

The session carries `metadata.purpose = carrier_prereg_fee` and
`metadata.pre_registration_id`, on both the session and the PaymentIntent (so
`charge.refunded` can be attributed). `customer_email` is prefilled from the
verified record.

`success_url` and `cancel_url` both point at `/become-a-carrier/payment`, a
**server** route that re-reads the database.

---

## 5. Price validation — three times, in three places

The amount is never in code as a charge. `STRIPE_CARRIER_PREREG_PRICE_ID`
names a Stripe Price, and:

1. **Before creating a session** — the Price is retrieved and must be
   `active`, **one-time** (no `recurring`), **usd**, and **exactly 999**.
   A wrong id fails closed and charges nobody.
2. **On the completed event** — `amount_total === 999 && currency === 'usd'`.
3. **Against the line items** — the price actually charged is re-read from
   Stripe (`listLineItems`) and compared to the configured id, and there must
   be exactly one line item.

Check 3 is the one metadata cannot fake. A webhook that trusted its own labels
would settle a $0.50 payment carrying `purpose: carrier_prereg_fee`.

Failing 2 or 3 **throws** → the event is marked `failed`, ops are emailed, and
Stripe gets a 500 and retries. Nothing is ever marked paid on a path that
could not finish its checks.

---

## 6. Webhook behaviour

| Situation | Response |
|---|---|
| no signature header | 400, nothing written |
| bad signature | **401**, nothing written, no audit |
| no signing secret configured | 503 |
| storage unavailable | 503 → Stripe retries |
| duplicate delivery | **200**, short-circuited by the dedup key before any handler runs |
| a second settle of one session | no re-stamp of `paid_at`; audited as `carrier_fee_paid_duplicate_event` |
| not our `purpose` | ignored silently — somebody else's payment is not ours to guess at |
| `completed` but `payment_status !== 'paid'` | **not settled** (delayed payment methods) |
| wrong amount / wrong currency / wrong Price | **not settled**, audited, 500 |
| session we never created | **not settled**, 500 |
| database write fails | **not settled**, 500 → retry |
| `expired` / `async_payment_failed` | row closed to `failed`, never touching a `paid` row |
| `async_payment_succeeded` | settles, same checks |
| `charge.refunded` | recorded as `refunded`; **nothing revoked** (§8) |
| any other event | acknowledged and archived, acted on by nothing |

The stored `webhook_events.payload` for our events is **minimised** to session
id, applicant id, payment status, amount, currency and livemode — the raw event
carries `customer_details` (name, email, sometimes an address) and none of it
is needed to reconcile a $9.99 fee.

---

## 7. Duplicate-payment protection

Four layers, of which only the last is unconditional:

1. the action refuses when the ledger already says paid;
2. an open session is reused rather than duplicated;
3. `webhook_events (provider, event_id)` makes redelivery a no-op;
4. **`onboarding_payments_one_paid_per_pre_registration`** — a partial unique
   index over `status = 'paid'` from `0032`. Even the service role, even a
   replay that slipped past everything above, cannot record two settled fees
   for one applicant. Proved in RLS §18g, together with the fact that an
   unpaid *attempt* is still allowed (a cancelled Checkout then a successful
   one is ordinary).

Browser refreshes cannot create a second charge: the fee step creates nothing
on render, and the return page is read-only.

---

## 8. Refunds — **OWNER DECISION REQUIRED**

**No automated refund exists.** Nothing in this repository calls
`stripe.refunds.create`, and there is no UI, action or endpoint that could.

What is implemented is the **state model only**: `charge.refunded` marks the
ledger row `refunded` and mirrors it, so a fee refunded by hand in the Stripe
dashboard stops reading as revenue. It deliberately does **not** revoke
anything — whether a refund should un-onboard a carrier who has already
uploaded documents and signed an agreement is a business decision nobody has
made, and guessing at it in a webhook is how a paying customer loses their
account overnight.

**REFUND POLICY BLOCKED / OWNER DECISION REQUIRED.** Needed: who may refund,
within what window, what happens to a carrier mid-onboarding, and whether a
refunded applicant may re-apply.

---

## 9. The combined gate

`startOnboarding` now requires **both**, each re-read from the database on the
call:

```
FMCSA decision === 'eligible_to_continue'   (M-94)
AND  a paid row in carrier_onboarding_payments   (M-95)
```

They are ANDed and they do not interact. **Paying does not make a
MANUAL_REVIEW applicant eligible** — a test asserts that a paid applicant with
each of `manual_review`, `not_eligible` and `null` is still refused, and writes
nothing.

`completeOnboarding` is deliberately **not** given a payment condition. It
already requires a bound eligible pre-registration, and on the public path such
a binding can only be produced by `startOnboarding`, which required payment. So
the public funnel is fully gated by transitivity, while M-94's staff-run legacy
adoption is not blocked by a fee that did not exist when those applicants
applied — see §12.

---

## 10. Resuming the wizard (why a marketing page became dynamic)

The wizard was a client-side step machine: reload and you were back at step 1.
That stops being survivable the moment the applicant **leaves the site to pay**,
because Stripe returns them through a fresh page load — which for a carrier who
had just been charged $9.99 would have looked exactly like losing their money.

`src/lib/carrier-authority/wizard-resume.ts` resolves the step on the server
from the httpOnly cookie plus the database: `precheck` · `fee` · `company` ·
`manual_review` · `not_eligible` · `already_onboarded`.

**The cost, named:** `/become-a-carrier` was statically generated and is now
`force-dynamic`. The alternative was resolving the step in the browser — the
client deciding where it is in a payment flow — which is the thing this whole
module refuses. (The build summary lists it as `●` because its locale params
come from a parent `generateStaticParams`; there is no prerendered
`become-a-carrier.html` and neither route appears in `prerender-manifest.json`,
so it genuinely renders per request.)

---

## 11. Database

**No migration.** `0032` already modelled `carrier_onboarding_payments`
exactly, including both unique indexes. Its column names are provider-agnostic;
the mapping to the requirement's suggested names is:

| Requirement | Column |
|---|---|
| `pre_registration_id` | `pre_registration_id` |
| `stripe_checkout_session_id` | `provider_session_id` (+ `provider = 'stripe'`) |
| `stripe_payment_intent_id` | `provider_payment_intent_id` |
| amount / currency | `amount_cents`, `currency` |
| status | `status` (`unpaid`/`session_created`/`paid`/`failed`/`refunded`) |
| created_at / paid_at | `created_at`, `paid_at` |

Plus `test_mode`, set from Stripe's `livemode` so a test payment can never be
mistaken for revenue.

**Never stored:** card numbers, CVC, payment-method credentials, Stripe
secrets. PickLoads never sees them — Checkout is Stripe-hosted.

---

## 12. Environment

| Variable | Where | Notes |
|---|---|---|
| `STRIPE_SECRET_KEY` | server only | already existed (M-31) |
| `STRIPE_WEBHOOK_SECRET` | server only | already existed; same endpoint |
| `STRIPE_CARRIER_PREREG_PRICE_ID` | server only | **new**. A Price id, never an amount. Test-mode price with a test-mode key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | — | **still unused.** Checkout is Stripe-hosted, so there is no legitimate client-side Stripe surface. Left unset rather than shipped for symmetry |

Register these events on the existing endpoint:
`checkout.session.completed`, `checkout.session.expired`,
`checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `charge.refunded`.

---

## 13. Security checks run

| Check | Result |
|---|---|
| secret leakage | `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` never leave the server; asserted absent from client components; customer-facing messages carry no Stripe error, key or price id |
| forged success URL | e2e: five forged URLs, none produces a paid claim |
| forged payment status | no form field is read; source-level assertion |
| wrong pre-registration id | the applicant comes from the httpOnly cookie, re-read from the DB; a submitted id is ignored |
| cross-tenant access | RLS §18: no browser role can read or write the ledger, including a carrier's own row |
| replayed webhook | dedup key + conditional settle; `paid_at` never re-stamped |
| duplicate Checkout | open-session reuse + partial unique index |
| wrong amount / currency / Price | three independent checks; all refuse |
| incomplete / failed payment | `payment_status !== 'paid'` never settles |
| expired session | closed to `failed`, never touches `paid` |

---

## 14. Gate result

| Lane | M-94 close | Now |
|---|---|---|
| `npm run typecheck` | clean | **clean** |
| `npm run lint` | clean | **clean** |
| unit | 2221 + 4 skipped | **2291 + 4 skipped** |
| e2e | 649 | **657** |
| RLS | 849 | **856** |
| integration | 369 | **369** |
| pages built | 439 | **444** |
| `npm audit` | 0 | **0** |

Nothing decreased. The RLS and integration lanes were executed the same way as
in M-94 (PGlite over the wire protocol, project runners unmodified) — see
`M-94-carrier-pre-registration-wiring.md` §19 for the diagnosis and commands.

**Two known flakes under parallel load**, both pre-existing and both unrelated
to this change: `responsive.spec.ts › portal /portal` and
`axe.spec.ts › /knowledge-base`. Each failed once across several full runs and
passes in isolation and on re-run. Recorded rather than re-run until green and
called clean.

---

## 15. Files changed

**New**

```
src/lib/carrier-authority/onboarding-fee.ts    price checks, ledger, settle
src/lib/carrier-authority/wizard-resume.ts     server-side step resolution
src/lib/carrier-fee-state.ts                   the (deliberately thin) shape
src/app/actions/carrier-fee.ts                 Checkout creation
src/components/onboarding/CarrierFeeStep.tsx   the fee step
src/app/[locale]/(site)/become-a-carrier/payment/page.tsx   the return route
tests/unit/carrier-fee-checkout.test.ts        35 tests
tests/unit/carrier-fee-webhook.test.ts         24 tests
tests/e2e/carrier-fee-return.spec.ts            8 tests
docs/modules/M-95-carrier-fee-stripe.md
```

**Changed**

```
src/app/api/stripe/webhook/route.ts            checkout.* + charge.refunded
src/app/actions/onboarding.tsx                 the payment half of the gate
src/components/onboarding/CarrierWizard.tsx    real fee step + resume
src/components/onboarding/CarrierPrecheck.tsx  resumed outcomes
src/app/[locale]/(site)/become-a-carrier/page.tsx   dynamic + resume
supabase/tests/20_rls_isolation.sql            §18g + a duplicate-key helper
tests/unit/onboarding-step1.test.ts            combined-gate tests (+10)
tests/unit/carrier-precheck.test.ts            precise client-import check
tests/unit/i18n-coverage-ratchet.test.ts       ru/ht +8 with the accounting
messages/{en,es,fr,ru,ht}.json                 20 keys
.env.example                                   the new price id + event list
```

---

## 16. Going live — the checklist this module does NOT perform

1. Approve a **refund policy** (§8).
2. Decide whether **legacy adopted carriers** owe the fee (§9 / M-94 §18).
3. Create the **live-mode** Price at $9.99 USD one-time; set
   `STRIPE_CARRIER_PREREG_PRICE_ID` to it **and** swap `STRIPE_SECRET_KEY` to
   the live key — the two must be from the same mode or Stripe cannot find the
   price at all, which fails closed.
4. Register the five events on the live endpoint and set the **live**
   `STRIPE_WEBHOOK_SECRET`.
5. Set `NEXT_PUBLIC_SITE_URL` — the return URLs are built from it.
6. Run one **test-mode** payment end to end and confirm: a `paid` row, the
   mirror, the audit trail, and that `startOnboarding` opens.
7. Only then consider live charges. Nothing in this repository switches modes
   on its own.
