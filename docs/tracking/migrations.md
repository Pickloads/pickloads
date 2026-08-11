# Migrations

## What it is

`supabase/migrations/` is an ordered, forward-only chain. Each file runs once,
in numeric order, and is never edited after it has been applied anywhere. The
tracking system is migrations 0017–0030.

## The rule about 0001–0004

**Frozen.** They built the original schema and were verified to have exactly
one commit each. Nothing may amend them — a change goes in a new migration.
This is checked before every module, and it exists because a migration that is
edited after being applied means two databases with the same version number
and different schemas.

## The chain

### Foundation (pre-tracking)

| # | What it added |
|---|---|
| 0001–0004 | types, tables, RLS, auth journal, storage — **frozen** |
| 0005 | accounts, memberships, `audit_events` |
| 0006 | fleet: drivers, trucks |
| 0007 | support threads and messages, notifications |
| 0008 | billing, quotes, invoices |
| 0009 | RLS for the 0005–0008 tables |
| 0010 | carrier portal surfaces |
| 0011 | quote fields |
| 0012 | staff invites |
| 0013 | **fix** — the permissive-policy OR that emptied the anonymous blog |
| 0014 | tokenised newsletter unsubscribe |
| 0015 | `referral_program_active` switchboard key |
| 0016 | `loads.deadhead_miles` |

### Tracking (0017–0030)

| # | Module | What it added |
|---|---|---|
| 0017 | M-71 | `shipments`, the 18-status enum and 16 more, the tracking-number CHECK/index/immutability trigger, the brokerage gate |
| 0018 | M-71 | RLS for `shipments`, `shipment_parties`, `shipment_assignments` — 15 policies |
| 0019 | M-72 | `shipment_events`, the append-only trigger, `apply_shipment_transition`, `append_shipment_event`, `set_shipment_appointment`, `apply_shipment_correction` |
| 0020 | M-73 | `shipment_tracking_access` and its append-only guard |
| 0021 | M-74 | `invoices.shipment_id` and the shipper/carrier invoice split |
| 0022 | M-75 | `create_shipment`, `assign_shipment_carrier`, `release_shipment_assignment`, `set_shipment_eta` |
| 0023 | M-76 | `shipment_driver_tokens`, its access ledger, issue/revoke/redeem/consent |
| 0024 | M-77 | `shipment_documents`, `shipment_document_audiences`, the visibility matrix and its triggers, the private bucket policies |
| 0025 | M-78 | `shipment_exceptions`, `shipment_eta_history`, the lifecycle guard and the backfill |
| 0026 | M-79 | the five notification tables, harvest/enqueue/claim/settle |
| 0027 | M-80 | `shipment_locations`, `tracking_provider_connections`, retention and the purger |
| 0028 | M-81 | the `broker` role value |
| 0029 | M-81 | `broker_partners`, memberships, grants, invites and 9 policies |
| 0030 | M-83 | 14 **restrictive** dispatcher-scope policies; column-level revoke/grant on `shipments`; `shipment_restricted_fields` |

## Conventions

**One concern per migration.** 0028 exists as its own file for one enum value
because adding an enum value and using it in the same transaction is a
Postgres error. That is the general shape: if a thing must be committed before
it can be referenced, it gets a file.

**Every function is `security definer` with `search_path = public`**, has its
`execute` revoked from `public`, and is granted to `service_role` alone.
`security definer` functions are `execute`-granted to `PUBLIC` by default —
forgetting the revoke hands the whole write path to every browser session.

**Every function carries a `comment on function`** naming the module, the
directive section, what it refuses and who may execute it. The comments are
the API documentation the database itself carries.

**Triggers over conventions.** Append-only, immutability, coordinate
exclusion, visibility narrowing and the brokerage gate are all triggers,
because a convention protects only the callers who know about it.

**Anti-drift exports.** Where a constraint has a TypeScript counterpart, the
TypeScript exports the SQL fragment and the migration uses it verbatim (see
`tracking-numbers.md`). Where a mapping exists in both places, a test compares
them cell for cell (see `document-permissions.md`).

## Applying them

Locally, against a scratch PostgreSQL 16:

```bash
npm run test:rls          # builds the schema, runs the SQL isolation suite
npm run test:integration  # builds it again, runs the TypeScript lane
```

Both scripts drop and rebuild the database from the chain plus
`supabase/seed.sql`, so "it works on my machine" cannot mean "my machine has
drifted".

Against a Supabase project: `supabase db push`, or apply each file in order
through the SQL editor. See `launch.md` for the ordering constraints that
matter in production.

## Rollback

Forward-only means there are no `down` migrations, deliberately: a `down` that
drops a table drops the data in it, and the situation where somebody reaches
for one is exactly the situation where that is unacceptable.

What to do instead is per-migration and written in `launch.md`. Broadly:

- **Additive migrations (new table, new column, new function)** — the
  application is written to tolerate their absence where it can; rolling back
  the *deploy* is usually enough, and the schema can stay.
- **Policy and privilege changes (0030)** — reversible by re-granting, and the
  exact statements are in the launch runbook.
- **Destructive changes** — there are none in the tracking chain. If one is
  ever needed, it gets its own runbook section and a backup step before it.

## The seed

`supabase/seed.sql` inserts eleven `company_settings` keys with `on conflict
do nothing`. The launch-relevant ones ship **off**: `brokerage_active`,
`testimonials_visible`, `packet_downloads_live`, `referral_program_active`.
That is the correct state for a business whose MC authority is pending, and
flipping one is an admin action that needs no deploy.

## Extension points

The next migration is `0031_`. Add it to the table above in the same commit
that adds the file — the table is how the next person finds out what 0031 was
for without reading 900 lines of SQL.
