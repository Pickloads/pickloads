# M-92 — SignWell send side

**Status:** implemented, `test_mode: true`, NOT deployed · **Date:** 2026-08-14 (final pre-deployment pass)

---

## 1. Audit — the safest trigger point

The onboarding wizard already auto-sends a Dropbox Sign request at step 4,
after account creation, non-fatally (`src/app/actions/onboarding.tsx:415`).
Two conclusions:

1. **Auto-firing SignWell there too would send two agreements.** Both
   providers stamp the same `carriers.agreement_signed_at`, so the carrier
   receives two contracts and whichever completes first wins. That is not a
   race worth having in a contracting flow.
2. **An explicit action is the safer trigger.** It is idempotent, authorized
   per call, rate-limited, audited, and it cannot make account creation fail.

So the trigger is a **server action**, wired to the carrier agreements page.
The onboarding auto-send is left on its existing path and untouched. Choosing
one provider is the open decision recorded in §10.

## 2. Route / action used to send

|                       |                                                                     |
| --------------------- | ------------------------------------------------------------------- |
| **Server action**     | `sendAgreementAction` — `src/app/actions/agreements.ts`             |
| Called from           | `AgreementSendButton` on `/portal/carrier/agreements`               |
| Library               | `sendDispatchAgreement()` — `src/lib/agreements/send.ts`            |
| **SignWell endpoint** | `POST https://www.signwell.com/api/v1/document_templates/documents` |
| Auth header           | `X-Api-Key: $SIGNWELL_API_KEY`                                      |

No public API route was added. A server action is already POST-only,
origin-checked by Next, and reachable only with a session — an API route would
have needed all of that rebuilt by hand.

## 3. Recipient mapping

| #     | `placeholder_name`                    | Name                                           | Email                                                    | Order                   |
| ----- | ------------------------------------- | ---------------------------------------------- | -------------------------------------------------------- | ----------------------- |
| `"1"` | `Carrier`                             | owner profile `full_name`, else `company_name` | owner's auth email                                       | signs **first**         |
| `"2"` | `PickLoads Authorized Representative` | `SIGNWELL_COUNTERSIGNER_NAME`                  | `SIGNWELL_COUNTERSIGNER_EMAIL`, else `EMAIL_INTERNAL_TO` | countersigns **second** |

`apply_signing_order: true`. Without it SignWell emails both at once and
PickLoads can "countersign" a document the carrier has not signed — which is
two unrelated signatures, not a countersignature.

`send_email: true` on both. It defaults to **false**, and a signature request
nobody is told about is indistinguishable from one never sent.

**The placeholder names must match the template exactly** or SignWell rejects
the request.

## 4. Field mapping

`template_fields[].api_id` → source. These `api_id` values must equal the API
IDs on the template's fields; a mismatch is **silent** (SignWell accepts and
leaves the field blank).

| `api_id`               | Source                                 | Available today |
| ---------------------- | -------------------------------------- | --------------- |
| `carrier_legal_name`   | `carriers.company_name`                | ✅              |
| `carrier_dba`          | `carriers.dba`                         | 🆕 0031         |
| `carrier_mc_number`    | `carriers.mc_number`                   | ✅              |
| `carrier_usdot_number` | `carriers.dot_number`                  | ✅              |
| `carrier_rep_name`     | owner `profiles.full_name`             | ✅              |
| `carrier_rep_title`    | `carriers.rep_title`                   | 🆕 0031         |
| `carrier_address`      | `carriers.address_line1`               | 🆕 0031         |
| `carrier_city`         | `carriers.city`                        | 🆕 0031         |
| `carrier_state`        | `carriers.home_state`                  | ✅ onboarding   |
| `carrier_zip`          | `carriers.postal_code`                 | 🆕 0031         |
| `carrier_phone`        | owner `profiles.phone`                 | ✅              |
| `carrier_email`        | owner auth email                       | ✅              |
| `dispatch_fee`         | `carriers.dispatch_fee_pct`, as `"5%"` | ✅              |
| `effective_date`       | send date, `YYYY-MM-DD`                | computed        |

Empty values are **omitted**, not sent blank: a blank stamps the contract with
"answered: nothing", where an omitted field leaves the signer something to
complete.

## 5. ⚠ Field locking — OWNER ACTION REQUIRED

**Requirement 7 cannot be satisfied from the API.** SignWell's field object has
no `locked`, `readonly`, `read_only` or `editable` property — verified against
their `createDocument` reference. The only related property is
`lock_sign_date`, which is date-field specific.

Editability is a **template** property: a field assigned to a recipient is
editable by that recipient; a field not assigned to anyone renders as static
text.

**To lock these five, edit the template in the SignWell dashboard and leave
them UNASSIGNED (sender-filled), not assigned to the Carrier recipient:**

- `carrier_legal_name`
- `carrier_mc_number`
- `carrier_usdot_number`
- `carrier_email`
- `dispatch_fee`

Until that is done the values are pre-filled but a carrier can overwrite them —
including the dispatch fee. This is the single most important item in this
document.

## 6. Status lifecycle

`not_sent` is the **absence of a row**, never a stored value.

| Portal state                        | Stored status               | Set by                                            |
| ----------------------------------- | --------------------------- | ------------------------------------------------- |
| Not sent                            | _(no row)_                  | —                                                 |
| Sent                                | `sent`                      | insert on send; `document_sent`                   |
| Viewed                              | `viewed`                    | `document_viewed`                                 |
| Carrier signed                      | `carrier_signed`            | `document_signed` from a non-carrier signer       |
| Awaiting PickLoads countersignature | `awaiting_countersignature` | `document_signed` where signer email == carrier's |
| Completed                           | `completed`                 | `document_completed`                              |
| Declined                            | `declined`                  | `document_declined`                               |
| Expired                             | `expired`                   | `document_expired`                                |

Terminal statuses (`completed`, `declined`, `expired`) are never moved
backwards. Webhook ordering is not guaranteed and SignWell retries, so a late
`document_viewed` after completion would otherwise un-complete an executed
agreement in the carrier's portal.

## 7. Database changes — migration 0031

**`carriers`** — 5 nullable columns: `dba`, `rep_title`, `address_line1`,
`city`, `postal_code`.

**No `mailing_state`.** An earlier draft added one, reasoning that a mailing
address is not an operating address. True in principle, wrong here:
`home_state` already exists, is collected at onboarding step 1, and is the only
state this system has. A second column would be a duplicate nothing ever
writes, so `carrier_state` reads `home_state` directly.

**`signature_requests`** — new. `carrier_id`, `provider`,
`provider_document_id`, `agreement_type`, `status`, `test_mode`, `sent_by`,
and per-state timestamps. Unique on `(provider, provider_document_id)`.

**The duplicate-send guarantee is an index, not a check:**

```sql
create unique index signature_requests_one_active_per_carrier
  on signature_requests (carrier_id, agreement_type)
  where status in ('sent','viewed','carrier_signed','awaiting_countersignature');
```

A SELECT-then-INSERT cannot promise this — two clicks 50 ms apart both read
"none active" and both create a document. Verified against a real database:
the second insert is refused, and a `declined` request can still be superseded.

**RLS:** enabled, staff `ALL`, member `SELECT` on own carrier. **No INSERT or
UPDATE policy for `authenticated`** — writes go through the service role after
the action authorizes. Probed: `anon` is hard-denied.

## 8. Security

- `SIGNWELL_API_KEY` read only in `src/lib/signwell.ts` (`server-only`); never
  logged, never returned.
- **A non-staff caller cannot name a carrier.** There is no parameter — the id
  comes from their membership rows. "Carrier A sends for Carrier B" is not a
  request this action can express. Staff may name one, gated on a server-read
  role.
- Idempotent: existing active request returned; lost race cancelled.
- Fixed error sentences; provider reasons logged only.
- `recordAuditEvent("agreement.send")` with document id, type and `test_mode`.
- Rate limited per **actor** (3), not per IP — a dispatcher office behind one
  NAT should not throttle itself.

## 9. Activation is untouched

The send path never writes `carriers.active` and never stamps
`agreement_signed_at` — asserted by test. Activation remains dependent on the
existing gate: completed agreement, approved documents, current insurance,
staff decision. Brokerage is untouched; `brokerage_active` stays false.

## 10. Open decisions

1. **Template field locking** (§5) — owner action, highest priority.
2. **`SIGNWELL_COUNTERSIGNER_NAME` / `_EMAIL`** are not yet set. Without them
   the countersignature request goes to `EMAIL_INTERNAL_TO` under the name
   "PickLoads Logistics Group". A contract should name a person.
3. **`test_mode: true`** — set by instruction. Documents signed in test mode
   are **not legally executed**. The portal shows a "Test mode" badge for
   exactly this reason. Flip in `src/lib/signwell.ts`.
4. **Two providers still active.** Dropbox Sign auto-sends during onboarding;
   SignWell sends from the agreements page. Both stamp the same column and
   both guard on `.is(null)`, so they cannot corrupt each other — but a carrier
   could receive two agreements. Retiring one is a business decision.
5. **Address data has no capture UI.** The five new columns are writable by
   staff but no carrier-facing form collects them, so early agreements will
   have blank address fields for the carrier to complete on the document.

## 11. Fields requiring owner input

| Needed                                                                                    | Status                        |
| ----------------------------------------------------------------------------------------- | ----------------------------- |
| Template `api_id` values matching §4                                                      | ⚠ must be set on the template |
| Five fields left unassigned to lock them                                                  | ⚠ §5                          |
| `SIGNWELL_COUNTERSIGNER_NAME` / `_EMAIL`                                                  | ⚠ not set                     |
| Carrier address capture UI                                                                | Not built — §10.5             |
| Confirmation that `SIGNWELL_TEMPLATE_ID` points at the countersigned 2-recipient template | ⚠ unverified from code        |

---

# M-92 FINAL — pre-deployment pass (2026-08-14)

## F1. Endpoint — verified

```
POST https://www.signwell.com/api/v1/document_templates/documents
```

Built as `API_BASE + "/document_templates/documents"` where
`API_BASE = "https://www.signwell.com/api/v1"`. The template is named in the
**body** as `template_id`; it is never interpolated into the path. A test now
fails if a path-interpolated variant appears in source or docs — one had crept
into M-91's extension-points section and has been corrected.

## F2. Dropbox Sign auto-send — DISABLED

`src/app/actions/onboarding.tsx` no longer calls
`sendAgreementSignatureRequest()`, no longer imports it, and no longer sends
the "your agreement is on its way" email.

**Not deleted, and nothing historical touched:** `src/lib/esign.ts` and
`/api/esign/webhook` remain; the webhook still stamps `agreement_signed_at`, so
an in-flight Dropbox request signed tomorrow still completes correctly. The
carrier-portal re-send (`requestAgreementResend`) still uses Dropbox — it
services an agreement that already went out through it, rather than creating a
competing one.

Guarded by `tests/unit/agreement-single-provider.test.ts`, which asserts
onboarding calls **neither** provider, and that exactly one caller of the
Dropbox sender remains.

Onboarding does **not** auto-send SignWell either — per §8 that stays explicit
until the workflow is owner-approved.

## F3. Countersigner — fails closed in production

| Variable                       | Required            | Value to set                       |
| ------------------------------ | ------------------- | ---------------------------------- |
| `SIGNWELL_COUNTERSIGNER_NAME`  | **Production: yes** | `Emmanuel Larocque`                |
| `SIGNWELL_COUNTERSIGNER_EMAIL` | **Production: yes** | _(your address — not in the repo)_ |

In production, a missing either refuses the send and logs the variable names
(never values). Outside production the old `EMAIL_INTERNAL_TO` fallback
survives so previews still work.

The name is **not** hardcoded: putting a person in the repository makes a
deploy the way to change who signs a contract.

## F4. Template configuration — how to set the `api_id` values

In SignWell: **Templates → the Dispatch Service Agreement → Edit**. Select each
field, open its settings, and set **API ID** to exactly the value below
(case-sensitive, no spaces).

| API ID                 | Field on the contract          |
| ---------------------- | ------------------------------ |
| `carrier_legal_name`   | Carrier legal entity name      |
| `carrier_dba`          | DBA / trade name               |
| `carrier_mc_number`    | MC number                      |
| `carrier_usdot_number` | USDOT number                   |
| `carrier_rep_name`     | Authorized representative name |
| `carrier_rep_title`    | Representative title           |
| `carrier_address`      | Street address                 |
| `carrier_city`         | City                           |
| `carrier_state`        | State                          |
| `carrier_zip`          | ZIP                            |
| `carrier_phone`        | Phone                          |
| `carrier_email`        | Email                          |
| `dispatch_fee`         | Dispatch fee (sent as `"5%"`)  |
| `effective_date`       | Effective date (`YYYY-MM-DD`)  |

Recipient placeholders must be named **exactly**:

| Signing order | Placeholder name                      |
| ------------- | ------------------------------------- |
| 1             | `Carrier`                             |
| 2             | `PickLoads Authorized Representative` |

**Verify with the diagnostic rather than by eye:**

```bash
SIGNWELL_API_KEY=… SIGNWELL_TEMPLATE_ID=… \
  node scripts/signwell-template-check.mjs
```

It calls `GET /api/v1/document_templates/{id}` and reports missing `api_id`s,
extra fields, placeholder mismatches, and which locked-list fields are
recipient-editable. It prints structure only — no key, no template id, no
values — so the output is safe to paste anywhere. Exit 0 pass · 1 problems ·
2 not configured.

## F5. Locked fields — NOT SATISFIED, and cannot be from code

These five must not be Carrier-editable:

`carrier_legal_name` · `carrier_mc_number` · `carrier_usdot_number` ·
`carrier_email` · `dispatch_fee`

SignWell's `template_fields` has **no** `locked` / `readonly` / `editable`
property. No code-level lock is faked.

A template field is editable by a recipient **exactly when it is assigned to
one**. So the fix is in the template: for each of the five, set the field's
recipient to **none / sender** so it renders as pre-filled static text rather
than an input owned by the Carrier.

**This is unverified from code — I do not have the API key.** Run the
diagnostic; every line it prints as

```
✖ dispatch_fee — assigned to "Carrier" → EDITABLE by that recipient.
```

is a field you must change before production. Until that run comes back clean,
**treat requirement 6 as open.** A carrier can currently edit their own
dispatch fee if the template assigns that field to them.

## F6. Address fields — audited

**Not collected anywhere.** Onboarding step 1 captures `company_name`,
`full_name`, `email`, `phone`, `mc_number`, `dot_number`, `home_state`,
`factoring_company`, `ein`, `insurance_expiry` — no street, city or ZIP.

Every `city`/`state` column elsewhere in the schema belongs to **shipment
stops** (`0019_shipment_events`, `0027_shipment_locations`) — freight
geography, not a carrier's mailing address. Mapping those would be a category
error, so they are not mapped.

- `carrier_state` → `carriers.home_state` (real data, collected today)
- `carrier_address` / `carrier_city` / `carrier_zip` → new nullable columns,
  **currently always empty**, therefore omitted from the request and left for
  the signer to complete on the document. Correct for test mode.

The duplicate `mailing_state` column from the first draft has been removed.

## F7. Preserved

Idempotency (two layers) · `signature_requests_one_active_per_carrier` ·
RLS (staff ALL, member SELECT, no authenticated write) · private `carrier-docs`
storage with 300 s signed URLs · webhook HMAC verification · activation gate
(`.is("agreement_signed_at", null)`, never `active`) · `brokerage_active` false
and untouched.

## F8. Is it safe to push for TEST MODE only?

**Yes for test mode, with two conditions.**

Safe because: `test_mode: true` (documents are not legally executed and the
portal badges them); send is explicit, never automatic; exactly one provider
creates agreements; the endpoint is verified; production fails closed without a
countersigner; nothing about brokerage, activation or RLS moved.

**Before the first real send:**

1. Run `scripts/signwell-template-check.mjs`. If it exits non-zero the
   agreement is not ready — F5 in particular.
2. Set `SIGNWELL_COUNTERSIGNER_NAME` / `_EMAIL` in Production, or every
   production send refuses (by design).

**Before leaving test mode:** flip `test_mode` in `src/lib/signwell.ts`, and
only after a clean diagnostic — a test-mode document with an editable dispatch
fee is a rehearsal; a live one is a contract.
