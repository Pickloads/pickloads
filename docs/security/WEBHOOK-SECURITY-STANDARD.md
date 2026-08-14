# PickLoads — Webhook Security Standard

Mandatory for every inbound webhook, present and future. A webhook endpoint is
an unauthenticated, internet-reachable, state-changing POST. It gets the same
scrutiny as `/login`.

## The seven rules

1. **Verify before parsing intent.** Signature check on the _raw_ body, before
   any business logic. Never `JSON.parse` and act, then verify.
2. **Constant-time comparison.** `timingSafeEqual` with a length check, never
   `===`.
3. **Fail closed.** No secret configured → `503`, do nothing. Bad signature →
   `401`. Never a soft "process anyway".
4. **Idempotency on a provider event identifier**, enforced by a database
   unique constraint — not an in-memory set, not a timestamp window. The
   `webhook_events (provider, event_id)` key is the pattern.
5. **The idempotency key must not be derivable from a low-cardinality tuple.**
   See the Dropbox Sign finding below — this rule exists because that one bit.
6. **Bind the payload to the signature, or bind it yourself.** If the provider
   signs only metadata, re-derive the affected entity from your own records
   rather than trusting the payload's identifiers.
7. **Alert on processing failure.** Store `status='failed'` + the error, email
   ops, and return non-2xx so the provider retries.

## Current implementations

### Stripe — `POST /api/stripe/webhook` ✅

Meets all seven. `constructEventAsync` verifies signature and timestamp
against the raw body; `(stripe, event.id)` gives real idempotency on a
high-cardinality provider id; duplicates return 200 without reprocessing;
failures archive, alert, and return 500 so Stripe retries with backoff.

### Dropbox Sign — `POST /api/esign/webhook` ⚠️ SEC-P2-02

Meets 1–4 and 7. **Violates 5 and 6.**

`event_hash = HMAC-SHA256(event_time + event_type)`. That is the provider's
documented scheme, and it means:

- the signature **does not cover the payload** — a replay with a different
  `metadata.carrier_id` still verifies;
- `event_id` is set to `event_hash`, so the idempotency key is a pure function
  of `(second, event_type)`.

Two consequences:

- Forged-payload replay is blocked **only as a side effect** — the unique
  constraint rejects the reused hash. The signature is not what stops it.
- Two legitimate `signature_request_signed` events **in the same second**
  collide. The second returns `200` and is never processed:
  `agreement_signed_at` is silently never stamped for that carrier.

**Required remediation** (staged, against the provider's replay tool):

- key idempotency on `signature_request_id + event_type`;
- keep `event_hash` purely as the authenticity check;
- add rule 6 — verify `metadata.carrier_id` matches the carrier the signature
  request was created for (`src/lib/esign.ts` sets it, so it is re-derivable).

### SignWell — `POST /api/signwell/webhook` ✅ (M-91)

Meets all seven, and closes rules 5 and 6 rather than inheriting the Dropbox
Sign shape.

- **Rule 1/2/3.** HMAC-SHA256 over `${event.type}@${event.time}` compared with
  `timingSafeEqual`, before any business logic. 503 unconfigured, 401 bad
  signature, 400 malformed, 405 on GET.
- **The key is a secret.** SignWell documents it as "the Webhook ID sent in the
  webhook POST resource". Taken literally that is a total bypass — the caller
  supplies key and hash together. It is read only from `SIGNWELL_WEBHOOK_ID`;
  `verifySignwellEvent()` accepts no key parameter, so the mistake cannot be
  written.
- **Rule 5.** Idempotency is `${document.id}:${event.type}:${event.time}`, not
  `event.hash`. SignWell's hash has the same `(type, time)` derivation that
  makes SEC-P2-02 possible, so keying on it would have reproduced a known
  open finding in new code.
- **Rule 6.** The signature does not cover the payload, so
  `metadata.carrier_id` is a claim. The route requires the carrier row to
  exist, stamps only when `agreement_signed_at IS NULL`, and fetches the PDF
  from SignWell by document id — a document that is not in our account 404s.

Artefacts land in the private `carrier-docs` bucket after a magic-byte check,
reachable only through 300-second signed URLs. Full detail in
`docs/modules/M-91-signwell-webhook.md`.

## Future — Stripe (expanded)

Not fully connected. Before it goes live:

**Stripe.** Secret key server-only; webhook signature verification;
idempotency keys on outbound calls; **amounts computed server-side only** —
never accept a client-supplied amount; event deduplication; restricted keys
where feasible. Invoices continue to carry the dispatch fee only, never
freight money.

**SignWell's inbound webhook is now implemented (M-91, above).** What remains
unbuilt is the SEND side — nothing creates a SignWell document yet, so the
endpoint receives nothing. When that lands it needs: a template-id allow-list,
`metadata.carrier_id` set at creation (the webhook already reads it), and
authorisation that the requesting carrier owns the document. The answer to the
question this section used to pose — does SignWell's signature cover the
payload? — is **no**, and rules 5 and 6 were applied accordingly.

Do not implement from this document alone — it states the security
floor, not the integration design.
