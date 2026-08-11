# Public tracking security

## What it is

`/track` is the one surface where somebody with no account can see shipment
data. Everything in this document exists because that sentence is dangerous.

## Two factors, always

§4: *"do not allow tracking by shipment number alone."* The page takes a
tracking number **and** a second value — the delivery ZIP code or an access
code from the same confirmation email. Both inputs are `required`, but the
attribute is a courtesy; the guarantee is that
`src/lib/shipments/public-lookup.ts` has no code path that returns shipment
data without a successful constant-time comparison of the second value.

The second value is never stored. `shipments.public_access_hash` holds a keyed
HMAC-SHA-256 under `TRACKING_ACCESS_SECRET`, in the form `v1:<64 hex>`.
Without the secret the module refuses to hash and refuses to verify — it fails
closed, not open. A ZIP+4 is accepted by also trying its ZIP5 prefix, because
that is what people read off a label.

## No anonymous table access

There is no RLS policy granting `anon` a `select` on `shipments`, and
migration 0030 revokes the table privilege from `anon` outright. The lookup
runs server-side with the service-role client after the second factor
verifies. This is why `/track` can be a statically prerendered shell: the
cacheable artefact contains no shipment at all, so §25's *"never cache private
shipment data publicly"* is true by construction rather than by configuration.

Individual results have no URL. They are rendered from a POST server action's
return value and carry `noindex, nofollow` while on screen.

## One refusal

An unknown tracking number, a wrong second value, and a shipment whose public
tracking an admin suspended all return the **same frozen value**. Not similar
— identical, asserted byte-for-byte in the integration lane against a real
database. The refusal object is `Object.freeze`d so no caller can narrow it.

A separate `unavailable` code exists for "the system could not answer" (no
service-role key, no secret, a database error, a failed ledger write). It is
not an oracle because it is returned for every input, including inputs that do
not exist.

Timing is levelled too: `MIN_RESPONSE_MS` holds every outcome to a floor, so a
fast miss and a slow hit are indistinguishable to a stopwatch.

## Rate limiting and challenge

Lookups are rate-limited per IP through Upstash (`TRACK_RATE_LIMIT`, a tighter
limit than the shared default) and gated by Cloudflare Turnstile. A
rate-limited attempt is recorded in the ledger with no shipment id, because it
never got far enough to identify one.

Both dependencies degrade honestly: with the environment unset, the limiter is
a no-op and the Turnstile check is skipped in development, and both log that
they are doing so. In production the variables are required — see
`launch.md`.

## The access ledger

Every attempt writes a row to `shipment_tracking_access`: the attempted
tracking number, the true outcome, the IP, the user agent, and the shipment id
when one was granted. The table is append-only, enforced by a trigger, for the
service role as well.

What it never stores, in any form, is the attempted second value. The
integration lane asserts this by sweeping the whole row rendered as JSON for
the ZIP that was submitted — and proves the sweep works by finding the
tracking number, which the ledger *is* supposed to keep.

Staff read the ledger; nobody else can. It is how an operator answers "is
somebody probing us?" without the probe learning anything.

## What a public payload may contain

`PublicTrackingDto` is an explicit allow-list, and three tests guard it:

- a key-set equality test, run against a populated shipment and an empty one;
- a **value** sweep for forbidden sentinels, which catches a leak a key-set
  test structurally cannot (a financial figure smuggled into a message field);
- an anti-vacuity control that fails the same assertions against a naive row
  passthrough, proving the tests can fail.

Nothing financial, no internal note, no private contact detail, no carrier
identity beyond what §4 allows, no internal shipment id, no shipper
organization id.

## Suspension and rotation

An admin can switch `public_tracking_enabled` off, and the correct code then
fails with the standard refusal. Rotating `public_access_hash` revokes the
code a customer holds. Both are proved in
`tests/integration/tracking-flows.test.ts` under §27's *"revoked tracking code
fails"*.

## The public support message

§8 allows a visitor on `/track` to send a message without an account. That
path is Turnstile-gated, rate-limited, length-capped in schema and in Zod, and
rendered escape-first. It creates no account and reveals nothing about whether
the tracking number in the message exists.

## Environment

| Variable | Effect if unset |
|---|---|
| `TRACKING_ACCESS_SECRET` | the lookup returns `unavailable` for every input |
| `SUPABASE_SERVICE_ROLE_KEY` | same |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | limiter disabled (dev only) |
| `TURNSTILE_SECRET_KEY` | challenge skipped (dev only) |

## Where the tests are

- `tests/unit/shipment-public-lookup.test.ts`, `shipment-public-dto-routes.
  test.ts`, `shipment-access-code.test.ts`
- `tests/integration/public-tracking.test.ts` — happy path, three refusals
  proved identical, the rate-limit trip and the ledger
- `tests/integration/tracking-security.test.ts` — §19 proofs 4 and 5 at route
  level, including the value sweep
- `tests/e2e/track.spec.ts`, `tests/e2e/tracking-flows.spec.ts`
