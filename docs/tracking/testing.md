# Testing

## What it is

Four lanes, each proving something the others structurally cannot, plus an
index that binds §27's named requirements to the assertions that honour them.

## The lanes

| Command | What it runs | What it can prove |
|---|---|---|
| `npm test` | vitest, `tests/unit/**` | pure logic, serializers, graphs, mocked clients |
| `npm run test:rls` | psql, `supabase/tests/*.sql` | that a **session** cannot cross a boundary |
| `npm run test:integration` | vitest against real PostgreSQL 16 | that the real `src/` functions produce SQL the real schema accepts and the real policies scope |
| `npx playwright test` | Chromium against a production build | routes exist, gates are right, geometry is right |

Current counts: **1550 unit · 806 RLS · 369 integration · 371 e2e**, and a
production build of 388 pages.

### Why four and not two

The unit lane mocks the client, so it can prove a query is bounded and scoped
and nothing about whether the column exists. The RLS lane is pure SQL and
imports no TypeScript, so it can prove a policy and nothing about the query
builder that will meet it. The integration lane is the only place the two
halves have to agree — and several defects have been caught exactly there. The
e2e lane is the only one that observes the *build*.

### The integration lane's honest limits

It has PostgreSQL 16 built from the migration chain, and no PostgREST and no
GoTrue. Two small adapters bridge the gap and both refuse to guess:

- `helpers/psql-supabase.ts` — the **service-role** client shape. Runs as the
  owner, because that is what it is modelling.
- `helpers/psql-rls-supabase.ts` — the **cookie-bound session** client. Every
  statement runs inside a transaction as `authenticated` with
  `request.jwt.claim.sub` set, which is what `auth.uid()` reads. Read-only by
  construction.

Both implement exactly the query shapes the modules use and **throw** on
anything else, so a future query shape cannot silently take an untested path.
Supabase Auth itself is in no lane; the browser half of "login" is the login
bounce asserted by Playwright.

## Non-vacuity is a discipline, not a hope

The rule this suite is built on: **a safety test must be shown capable of
failing**, and the way to show it is to inject the defect it should catch.

Three forms recur:

- **Injection controls.** Several isolation tests re-issue their query with
  the application-level tenant predicate removed and assert the database still
  refuses — separating "the app filtered it" from "the policy refused it",
  which produce the same green and very different guarantees. The control for
  the control is the same unscoped query as an admin, which returns everything.
- **Sentinel sweeps.** Instead of asserting a key is absent, populate every
  staff-only field with a recognisable value and sweep the serialized payload
  for it. This catches a leak a key-set test structurally cannot — a figure
  smuggled into a message field. Then assert the **staff** payload *does*
  carry the sentinels, so the customer's zero is redaction rather than an
  empty row.
- **Anti-vacuity controls.** `tests/unit/shipment-dto.test.ts` runs its own
  assertions against a naive spread-based serializer and asserts they fail.

## The §27 coverage index

`tests/support/section-27-catalogue.ts` maps every requirement §27 names —
8 unit tests, 11 integration tests, 5 flows totalling 31 steps, 6 responsive
surfaces × 5 viewports — to a specific file and a specific test title.
`tests/unit/section-27-coverage.test.ts` proves each binding still resolves.

Three properties make it worth having:

1. **Shape.** Dropping a requirement fails, which is the failure a
   hand-maintained table makes impossible to notice.
2. **Resolution.** A renamed or deleted test fails with the requirement it was
   covering named in the message.
3. **Non-vacuity of the checker itself.** The extractor is proved to reject a
   title that does not exist, a file that does not exist, and a title that
   appears in the file only as prose — the last one matters because these
   suites quote their own test names in their header comments, and a substring
   search would report coverage for a deleted test.

`caveat` fields carry the honest differences: where the covering proof is
narrower than the directive's sentence, the difference is written down rather
than smoothed over.

## The composed flow tests

`tests/integration/tracking-flows.test.ts` exists because the parts being
tested is not the same as the flows working. It walks §27's shipper flow as a
**sequence** — each step consuming the previous step's output — and asserts
all six security refusals **simultaneously against one shipment** in its final
state, after a full lifecycle. Isolated tests seed their own world, which is
the right way to prove a policy and the wrong way to prove a system.

## The module gate

Nothing is "done" until all of these pass:

```
npm run typecheck && npm run lint && npm run build
npm test && npm run test:rls && npm run test:integration && npx playwright test
```

plus a review of RLS, responsive behaviour and accessibility, updated
documentation, a file list, a migration list, an environment-variable list,
rollback instructions, and a clean commit.

## Running the database lanes locally

```bash
initdb -D /tmp/pgdata
pg_ctl -D /tmp/pgdata -l /tmp/pg16.log \
  -o "-k /tmp/pgsock -p 5433 -c listen_addresses=" start
npm run test:rls
npm run test:integration
```

Both scripts drop and rebuild the database from the migration chain plus the
seed, then load `tests/integration/00_harness.sql` (which provides
`itest.sqlstate_of` for exact SQLSTATE assertions and the brokerage-gate
helpers).

## Extension points

When adding a module: add its tests to the lane that can actually prove the
claim, add an injection control or a sentinel sweep for anything
security-relevant, and — if it touches a §27 requirement — update the
catalogue in the same commit. The coverage test will tell you if you didn't.
