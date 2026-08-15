# M-93 — Carrier Pre-Qualification, Compliance & Paid Onboarding

**Status:** PHASE 0 AUDIT COMPLETE — implementation not started, pending owner
decisions (§6). **Starting HEAD:** `13ae378` · **Date:** 2026-08-15

---

## 1. Phase 0 — what exists today

Audited against the source, not from memory.

| Area                    | State                                                                                                                                                                                        | Reuse?                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Become-a-Carrier wizard | 4 steps: company info → documents → agreement → account. `src/components/onboarding/CarrierWizard.tsx`                                                                                       | **Reuse** — becomes steps 3–4 of the new lifecycle  |
| Account creation        | `startOnboarding` creates an **unclaimed `carriers` row immediately**, before any verification. `completeOnboarding` creates the auth user                                                   | **Must change** — §2                                |
| `carriers` schema       | `company_name, mc_number, dot_number, ein, home_state, factoring_company, insurance_expiry, dispatch_fee_pct, agreement_signed_at, active, dba, rep_title, address_line1, city, postal_code` | Reuse                                               |
| Documents               | `documents` table with `type` enum, `status` (pending/approved/rejected/expired), `reviewed_by`, `review_note`, `expires_at`                                                                 | **Reuse — Phase 13 is already half-built**          |
| Storage                 | private `carrier-docs`, magic-byte sniffing, 10 MB cap, 300 s signed URLs, path-stripped names, no SVG                                                                                       | **Reuse unchanged** — Phase 12 is already satisfied |
| RLS                     | 49/49 tables, 118 policies, no anon insert policies                                                                                                                                          | Reuse doctrine                                      |
| **Carrier activation**  | **`carriers.active` is never set to `true` by any code path.** No activation action, no service, no admin mutation                                                                           | **Does not exist — must be built**                  |
| Stripe                  | `stripe.invoices.create` for dispatch-fee billing (M-31). **No Checkout Sessions, no Products, no Prices**                                                                                   | Partial — §4                                        |
| SignWell                | M-91 webhook + M-92 send, `test_mode: true`, `signature_requests` with one-active partial index                                                                                              | Reuse                                               |
| Dropbox Sign            | Auto-send disabled (M-92 final); webhook + historical records intact                                                                                                                         | Leave alone                                         |
| Turnstile / Upstash     | 11/11 call sites reset tokens; per-form + per-actor buckets                                                                                                                                  | Reuse                                               |
| Audit log               | `audit_events` + `recordAuditEvent()`                                                                                                                                                        | Reuse                                               |
| Compliance fields       | Only `insurance_expiry`. **No FMCSA fields, no verification state, no risk tier, no payment state**                                                                                          | Must be built                                       |

### The two findings that change the plan

**1. There is no activation gate to preserve.** M-92 said it "preserves the
carrier activation gate", and that was true in the narrow sense — the send
path never writes `active`. But auditing for Phase 16 shows **nothing writes
`active = true` anywhere in the codebase.** Activation today is a manual
database edit. Phase 16's escape hatch — "unless existing owner-approved
workflow already does that" — does not apply, because there is no workflow.
Building one is a business-process decision, not a refactor.

**2. Account creation happens far too early for this lifecycle.** Step 1 of
the wizard already inserts a `carriers` row. The new lifecycle requires
verification and payment _before_ an account exists, so `startOnboarding` must
stop creating carriers and write a pre-registration instead. That is a change
to the live onboarding path, not an addition beside it.

---

## 2. Proposed current → target transition

```
CURRENT   wizard step 1 ──> carriers row (unclaimed) ──> docs ──> account
                            ▲ no verification, no payment, no gate

TARGET    pre-check ──> FMCSA ──> decision ──> $9.99 ──> account+carrier
                                     │                      │
                                 MANUAL_REVIEW          docs ──> review
                                                            │
                                              SignWell ──> countersign
                                                            │
                                            ELIGIBLE ──> staff ──> ACTIVE
```

`carrier_pre_registrations` is a new table (opaque `id`, expiring, no auth
user). `carriers` is created only at the account step, bound server-side to
the pre-registration that was verified and paid.

**No duplicate concepts:** documents, storage, audit, signature_requests,
Turnstile and Upstash are all reused as-is. The genuinely new tables are the
pre-registration, the FMCSA verification record, and the payment record.

---

## 3. Phase 2 — FMCSA provider, verified

**Selected: FMCSA QCMobile API** — the agency's own service, not a reseller.

|            |                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| Base URL   | `https://mobile.fmcsa.dot.gov/qc/services/`                                                                     |
| Auth       | `webKey` query parameter                                                                                        |
| Credential | Requires a **Login.gov**-backed FMCSA developer account → "My WebKeys" → "Get a new WebKey"                     |
| Docs       | <https://mobile.fmcsa.dot.gov/QCDevsite/docs/qcApi> · <https://mobile.fmcsa.dot.gov/QCDevsite/docs/apiElements> |

**Verified live on 2026-08-15**, not assumed. An unauthenticated probe returns
a real, current response:

```
GET /qc/services/carriers/76830?webKey=INVALID_TEST_KEY   → HTTP 404
{"content":"Webkey not found","retrievalDate":"2026-08-15T06:00:03.368+0000", …}
```

So: the service is up, the path shape is right, and auth is enforced. (Public
reports of past QCMobile outages are real — Phase 20's `PROVIDER_UNAVAILABLE`
state is not theoretical.)

### Endpoints

| Purpose                  | Path                                             |
| ------------------------ | ------------------------------------------------ |
| By USDOT                 | `/carriers/{dotNumber}`                          |
| By docket (MC)           | `/carriers/docket-number/{docketNumber}`         |
| By name                  | `/carriers/name/{name}`                          |
| Operating authority      | `/carriers/{dotNumber}/authority`                |
| Out-of-service           | `/carriers/{dotNumber}/oos`                      |
| Operating classification | `/carriers/{dotNumber}/operation-classification` |
| Safety (BASICs)          | `/carriers/{dotNumber}/basics`                   |
| Docket numbers           | `/carriers/{dotNumber}/docket-numbers`           |

### Fields it actually returns

`legalName` · `dbaName` · `allowToOperate` (Y/N) · `outOfService` (Y/N) ·
`outOfServiceDate` · `dotNumber` · `mcNumber` · `phyStreet` · `phyCity` ·
`phyState` · `phyZip` · `phyCountry` · `telephone`

### What Phase 2 asked for and QCMobile does NOT provide

- **Insurance / filing indicators.** Not in the documented element set. That
  data lives in FMCSA's separate **L&I (Licensing & Insurance)** system, which
  has no equivalent public JSON API. Phase 14's "FMCSA filing status" cannot be
  sourced from QCMobile — see §6.
- **Authority grant / effective date.** Not in the carrier element list; the
  `/authority` endpoint may carry it, unverifiable without a webKey.

**This is why `carrier_address` etc. must still come from the applicant:**
QCMobile returns a _physical_ address (`phyStreet`…) which is a useful
cross-check but is not necessarily the carrier's contracting address.

---

## 4. Payment — what exists vs what Phase 9 needs

Existing Stripe code creates **invoices** for dispatch fees. Phase 9 wants
**hosted Checkout** for a $9.99 one-time fee. These share only the client.

Needed and absent: a Stripe **Product + Price** for the onboarding fee (Phase 9
explicitly prefers this over scattering `999` in source), a Checkout Session
creator, `checkout.session.completed` handling in the existing webhook, and a
payment record keyed to `pre_registration_id`.

The existing webhook is a good host: it already verifies signatures and
enforces `(provider, event_id)` idempotency.

---

## 5. Phase 32 — STOP CONDITIONS ALREADY MET

Five of the seven are true **before any code is written**. Per Phase 32 these
are owner/provider actions, and I am reporting rather than inventing around
them.

| #   | Condition                                        | Status                                                                                                                                                                                                        |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Official FMCSA access cannot be verified**     | **BLOCKED.** The API is verified live, but **no webKey exists** for this project and none can be self-issued — it needs a Login.gov account under PickLoads. Without it, FMCSA verification cannot run at all |
| 2   | **Stripe production credentials absent**         | **BLOCKED for live.** `STRIPE_SECRET_KEY` is empty in `.env.example`; I cannot read Vercel. No Product/Price exists for the $9.99 fee                                                                         |
| 3   | **SignWell template locking unverified**         | **STILL OPEN** from M-92 §F5. `scripts/signwell-template-check.mjs` has not been run — a carrier may currently be able to edit their own `dispatch_fee`                                                       |
| 4   | **Refund policy undecided**                      | **BLOCKED.** Phase 8 requires `ONBOARDING_FEE_REFUND_POLICY` as an owner decision. Until decided, payment must not go live                                                                                    |
| 5   | **Credit provider needs a commercial agreement** | **EXPECTED.** No provider selected. Phase 5 says implement the interface and report `CREDIT_CHECK_NOT_CONFIGURED` — that part is buildable                                                                    |
| 6   | Would weaken RLS                                 | No                                                                                                                                                                                                            |
| 7   | Requires exposing a secret                       | No                                                                                                                                                                                                            |

---

## 6. Owner decisions required before implementation

1. **FMCSA webKey.** Register at <https://mobile.fmcsa.dot.gov/QCDevsite> with
   a Login.gov account; application type _commercial_. Provide as
   `FMCSA_WEBKEY` (Production scope). **Nothing in Phase 2–4 can be truthfully
   built without it** — I will not implement a stub that reports "VERIFIED".
2. **Insurance source.** QCMobile does not expose filing/insurance data.
   Options: (a) treat FMCSA insurance status as _not available_ and rely
   solely on the COI + `insurance_expiry` PickLoads requirement; (b) commission
   an L&I integration separately. Phase 14 requires these be shown as
   _independent_ statuses either way — (a) is honest and cheap.
3. **Refund policy** wording for `ONBOARDING_FEE_REFUND_POLICY`.
4. **Activation authority.** There is no activation workflow today. Confirm
   Phase 16's preference: `ELIGIBLE_FOR_ACTIVATION` → **explicit staff
   approval** → `ACTIVE`, with no auto-activation.
5. **Does the $9.99 gate apply to existing carriers?** The lifecycle is written
   for new applicants; existing carrier rows predate it.

---

## 7. What is buildable now, unblocked

Independent of every blocker above:

- `carrier_pre_registrations` + `carrier_verifications` + payment tables, with
  RLS, opaque ids, expiry (Phases 1, 27)
- `CarrierAuthorityProvider` interface + normalized model + the QCMobile
  adapter, returning `PROVIDER_UNAVAILABLE` until a webKey exists (Phases 2, 20)
- Identity matching + normalization (Phase 3)
- Deterministic risk engine with reason codes (Phase 4)
- `CarrierCreditProvider` returning `CREDIT_CHECK_NOT_CONFIGURED` (Phase 5)
- Centralized `evaluateActivationEligibility()` — pure, testable (Phase 16)
- Staff review queue + audit events (Phases 17, 24)
- Adversarial test suite (Phase 28)

Blocked: live FMCSA calls, live payment, production signing, actual activation.
