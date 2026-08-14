# M-91 — SignWell webhook

**Status:** implemented, not yet configured in production · **Date:** 2026-08-14

---

## 1. Audit result first

**There was no SignWell integration in this codebase before M-91.** The only
occurrences of the string were two lines in
`docs/security/WEBHOOK-SECURITY-STANDARD.md` describing it as a _future_
provider. No route, no library, no env var, no dependency, no migration.

The existing e-signature provider is **Dropbox Sign** (`/api/esign/webhook`,
`src/lib/esign.ts`, `DROPBOX_SIGN_*`). That integration is untouched.

## 2. What this module adds

| Item                        | Value                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| Route                       | `POST /api/signwell/webhook`                                                                   |
| **Production callback URL** | **`https://www.pickloads.com/api/signwell/webhook`**                                           |
| Library                     | `src/lib/signwell.ts` (`server-only`)                                                          |
| Env                         | `SIGNWELL_API_KEY`, `SIGNWELL_WEBHOOK_ID`                                                      |
| Tests                       | `tests/unit/signwell-webhook.test.ts` — 20                                                     |
| Migrations                  | **none** — `webhook_events.provider` is free text; `doc_type` already has `dispatch_agreement` |

The route is not locale-prefixed: `src/middleware.ts` excludes `api` from the
next-intl matcher, so there is no `/en/` variant and none is needed.

## 3. Authenticity

Per <https://developers.signwell.com/reference/event-hash-verification>:

```
HMAC-SHA256( key = webhook id, data = `${event.type}@${event.time}` )
  compared in constant time against event.hash
```

`event.time` is stringified exactly as SignWell's own Python sample does
(`str(params['event']['time'])`), because the payload carries it as a JSON
number.

### The footgun, and how it is closed

SignWell describes the HMAC key as _"Webhook ID sent in the webhook POST
resource or get it from webhook LIST endpoint"_. Implemented literally — take
the id out of the request you are authenticating — an attacker supplies **both
the key and the hash**, and every forged request verifies. The signature would
be decorative.

So `SIGNWELL_WEBHOOK_ID` is treated as a **secret**, read only from the
environment. `verifySignwellEvent()` accepts no key parameter, which makes the
mistake unexpressible, and two tests keep it that way: the route is scanned for
any `webhook_id` read, and every reference to the variable in the library must
be a `process.env` read.

### What the signature does _not_ cover

The payload. It proves "SignWell emitted an event of this type at this second"
and nothing about _which document_. `metadata.carrier_id` is therefore
untrusted, and §5 explains what the route does about it.

## 4. Idempotency — and why not `event.hash`

`event.hash` is the obvious key and the wrong one. It is a pure function of
`(type, time)`, so **two different documents completing in the same second
produce the same hash**; the second would be deduped, answered 200, and never
processed — a carrier's agreement silently never stamped.

That is not hypothetical: it is exactly the defect recorded as **SEC-P2-02**
against the Dropbox Sign route, which does key on `event_hash`. Reusing the
pattern would have reproduced a known open finding in new code.

The key is `${document.id}:${event.type}:${event.time}`, stored in
`webhook_events (provider='signwell', event_id)` behind the existing unique
constraint. Document ids are high-cardinality: true retries collapse, genuine
concurrent completions do not.

## 5. Events handled

| Event                                                                                                                 | Action                                                   |
| --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `document_completed`                                                                                                  | Full processing — §6                                     |
| everything else (`document_signed`, `document_viewed`, `document_declined`, `document_canceled`, `document_error`, …) | Verified, archived to `webhook_events`, **not acted on** |

`document_signed` fires per signer; `document_completed` means every recipient
has signed. Only the latter may stamp an agreement.

## 6. What `document_completed` does

1. `metadata.carrier_id` must parse as a UUID **and** the carrier row must
   exist — a forged event naming an invented carrier stops here.
2. `GET /api/v1/documents/{id}/completed_pdf?audit_page=true&file_format=pdf`
   with `X-Api-Key`. Fatal on failure — SignWell retries. (A 400 shortly after
   completion is normal: the file takes a few seconds to generate.)
3. Bytes are **magic-byte checked** (`sniffMime`) before storage. A remote
   server's `Content-Type` is a claim; the file header is evidence.
4. Stored in the **private** `carrier-docs` bucket at
   `${carrier_id}/${uuid}-${name}` — the same convention every other document
   uses, so it inherits the existing storage RLS.
5. Registered in `documents` as `type='dispatch_agreement'`,
   `status='approved'` (countersigned by the provider, not awaiting review).
6. The NOM-151 completion certificate
   (`GET /api/v1/documents/{id}/nom151_certificate?url_only=true`, then fetch
   `file_url`) is stored as `type='other'`. **Best-effort:** it is not
   available on every SignWell plan, and an unavailable certificate must never
   block carrier activation. Absence is logged, never fatal.
7. `carriers.agreement_signed_at` is stamped **only when currently null**.
8. Carrier notified once (`buildAgreementSignedEmail` + `notifyCustomer`).

Bytes never leave our control: `url_only` is deliberately unused for the PDF,
so portal access is a 300-second signed URL from our own private bucket
(`SIGNED_URL_TTL_SECONDS`), never a SignWell-hosted link whose lifetime and
access control we do not own.

## 7. The carrier activation gate is preserved

`.is("agreement_signed_at", null)` does two jobs: it makes the stamp
idempotent, and it stops a replay re-dating an agreement that is already
signed.

**The webhook never sets `carriers.active`.** Activation remains the separate
staff decision it has always been; this module only records that the agreement
was signed. A route-contract test asserts no `active:` update exists.

## 8. Failure behaviour

| Condition                                         | Response                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `SIGNWELL_API_KEY` or `SIGNWELL_WEBHOOK_ID` unset | `503`, no work                                                     |
| Unparseable body                                  | `400`                                                              |
| Schema mismatch                                   | `400`                                                              |
| Bad/missing signature                             | `401` (no detail — which half failed is not the caller's business) |
| Service credentials unavailable                   | `503`                                                              |
| Duplicate delivery                                | `200`, not reprocessed                                             |
| Processing failure                                | row marked `failed`, ops emailed, `500` so SignWell retries        |
| `GET`                                             | `405` (no handler exists)                                          |

Verified live against a production build:

```
405  GET                              →
400  malformed JSON                   → {"error":"Invalid JSON"}
400  missing fields                   → {"error":"Unexpected payload"}
401  signed with attacker key         → {"error":"Bad signature"}
401  type swapped onto stolen hash    → {"error":"Bad signature"}
401  timestamp altered                → {"error":"Bad signature"}
200-path  valid signature             → passes verification
```

## 9. Deployment

1. Create the webhook in SignWell pointing at
   **`https://www.pickloads.com/api/signwell/webhook`**
2. Copy the **Webhook ID** from the create response (or the List Webhooks
   endpoint) into `SIGNWELL_WEBHOOK_ID` — Production scope only.
3. Set `SIGNWELL_API_KEY` — Production scope only.
4. Redeploy. Until both are set the route returns 503 and does nothing.

Nothing about brokerage changes. `brokerage_active` is untouched.

## 10. Known limitation — no send side

**This module implements the webhook only, which is what was asked for.** There
is no SignWell _sending_ integration: nothing in the codebase creates a
SignWell document, so nothing will call this endpoint until one exists.

`src/lib/esign.ts` still sends via Dropbox Sign, and its webhook still stamps
the same `agreement_signed_at` column. The two coexist safely — both guard on
`.is(null)`, so whichever completes first wins and the other no-ops — but
running both providers in parallel is a business decision nobody has made yet.

Deciding between them is the next step, and it is not a code change this
module should have made on its own.

## 11. Extension points

- **Send side:** mirror `src/lib/esign.ts` with
  `POST /api/v1/document_templates/{id}/documents`, setting
  `metadata.carrier_id` — the webhook already reads it.
- **Retiring Dropbox Sign:** remove `DROPBOX_SIGN_*`, delete
  `/api/esign/webhook` and `src/lib/esign.ts`. SEC-P2-02 disappears with it.
- **Other events:** add a branch beside `COMPLETED_EVENT`. Archive-only is the
  default and should stay the default.
