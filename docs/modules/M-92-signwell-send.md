# M-92 — SignWell send side

**Status:** implemented, `test_mode: true` · **Date:** 2026-08-14

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

| `api_id`               | Source                                   | Available today    |
| ---------------------- | ---------------------------------------- | ------------------ |
| `carrier_legal_name`   | `carriers.company_name`                  | ✅                 |
| `carrier_dba`          | `carriers.dba`                           | 🆕 0031            |
| `carrier_mc_number`    | `carriers.mc_number`                     | ✅                 |
| `carrier_usdot_number` | `carriers.dot_number`                    | ✅                 |
| `carrier_rep_name`     | owner `profiles.full_name`               | ✅                 |
| `carrier_rep_title`    | `carriers.rep_title`                     | 🆕 0031            |
| `carrier_address`      | `carriers.address_line1`                 | 🆕 0031            |
| `carrier_city`         | `carriers.city`                          | 🆕 0031            |
| `carrier_state`        | `carriers.mailing_state` ?? `home_state` | 🆕 0031 (fallback) |
| `carrier_zip`          | `carriers.postal_code`                   | 🆕 0031            |
| `carrier_phone`        | owner `profiles.phone`                   | ✅                 |
| `carrier_email`        | owner auth email                         | ✅                 |
| `dispatch_fee_pct`     | `carriers.dispatch_fee_pct`, `"5%"`      | ✅                 |
| `effective_date`       | send date, `YYYY-MM-DD`                  | computed           |

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
- `dispatch_fee_pct`

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

**`carriers`** — 6 nullable columns: `dba`, `rep_title`, `address_line1`,
`city`, `postal_code`, `mailing_state`. `mailing_state` is separate from
`home_state` on purpose: the latter is the operating state used for dispatch,
not a correspondence address.

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
