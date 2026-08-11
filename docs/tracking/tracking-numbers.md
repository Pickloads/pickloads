# Tracking-number rules

## What it is

`PL-YYYY-######` — the string a customer reads off a confirmation email and
types into `/track`. Fourteen characters, always. `PL-2026-000042` is valid;
`PL-2026-42` is not.

The whole of it lives in `src/lib/shipments/tracking-number.ts`, including the
SQL that constrains it, so the TypeScript and the database cannot drift.

## The rules, and why each exists

**Server-generated, never client-supplied.** A tracking number is minted by
`create_shipment()` or by the generator before it. No form accepts one, and
the create RPC strips the key if a payload carries it.

**Unique.** A unique index, not a uniqueness check in application code. A
collision raises `23505`, which the caller treats as a retry signal rather
than an error to show anybody.

**Random, not sequential.** The six digits come from a CSPRNG with rejection
sampling to avoid modulo bias. Sequential numbers would tell any customer how
many shipments the company has moved and would make `/track` enumerable by
counting rather than by guessing.

**Immutable after creation.** §5 says so, and migration 0018's
`guard_tracking_number_immutable` trigger enforces it for every role including
the table owner. A correction to a tracking number is not an update; it is a
new shipment and a cancelled old one, with the reason recorded. The
integration lane asserts that even an admin correction RPC cannot rewrite it.

**Tolerant on lookup, canonical on store.** `normalizeTrackingNumber` accepts
the shapes a person can plausibly paste — lowercase, extra spaces, en-dashes
substituted by a word processor, the number without its `PL-` prefix — and
returns the canonical uppercase form. What goes into the database is always
canonical; what a customer types can be messy.

**Searchable by staff, and scoped.** `src/lib/shipments/search.ts` finds a
shipment by a full number or by the last digits somebody read out over the
phone. The search is scoped: a dispatcher cannot find a shipment outside their
scope by typing its number, which migration 0030's restrictive policy enforces
at the database rather than in the query builder.

## Anti-drift

The module exports three SQL fragments alongside the TypeScript:

```ts
TRACKING_NUMBER_SQL_PATTERN        // the CHECK constraint's regex
TRACKING_NUMBER_UNIQUE_INDEX       // the index definition
TRACKING_NUMBER_IMMUTABLE_TRIGGER  // the trigger definition
```

Migration 0018 uses those exact strings. If the format changes in TypeScript
without the migration changing, the generator will produce values the CHECK
rejects — and the unit test *"throws rather than minting a number the CHECK
constraint would reject"* fails before anything reaches a database.

## Year component

`YYYY` is the year the shipment was created, in UTC. It is not a guarantee of
anything (a shipment created on 31 December and delivered in January keeps its
original number, because the number is immutable) and it is not used for
partitioning. It exists because operators asked for it: a number's age is
readable without a lookup.

## Where the tests are

- `tests/unit/shipment-tracking-number.test.ts` — format, parse round-trip,
  normalisation, rejection, and the CHECK-agreement test above.
- `tests/integration/dispatcher-operations.test.ts` — duplicate handling
  (`23505`), a malformed number refused at the CHECK, and immutability holding
  through the admin correction path.
- `supabase/tests/20_rls_isolation.sql` — that no browser role can update the
  column.

## Extension points

If a second number series is ever needed (say, a partner-branded prefix), add
it as a **new** column with its own generator and constraints rather than
loosening this one. `tracking_number` is the value printed on paperwork that
already left the building.
