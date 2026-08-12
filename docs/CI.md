# Continuous integration

**Workflow:** `.github/workflows/ci.yml` · **Added:** 2026-08-11, as Phase A of
the final website productionphase, on the certified `m84b-certified` baseline.

---

## Why this exists

The project had four green test lanes and nothing that ran them. That is not a
theoretical gap — it is the direct cause of the two worst failures in this
project's history:

- an audit concluded that eleven milestones did not exist, while the code sat
  in an unopened archive in the same folder;
- **371 browser tests existed for weeks and not one had ever executed**,
  because the config pinned a Chromium path that existed on a single container.
  Every responsive and accessibility guarantee was unverified, and nothing
  surfaced that fact.

A test lane nobody runs is documentation. CI is what turns it back into
verification.

## What runs

Three jobs, in parallel, so a red build says _where_ it broke without reading a
log.

| Job          | Lane                                              | Assertions                            |
| ------------ | ------------------------------------------------- | ------------------------------------- |
| **static**   | `typecheck` · `lint` · `test` · `build` · `audit` | 1,785 unit · 434 pages · 0 advisories |
| **database** | `test:rls` · `test:integration`                   | 806 RLS · 369 integration             |
| **browser**  | `build:e2e` · `test:e2e`                          | 546 e2e — 12 breakpoints, WCAG 2.2 AA |

These counts are measured, not aspirational — they were re-run in full on
2026-08-11. They had drifted (1,638 · 388 · 371) because the table was written
once and the suites kept growing; a stale number in a CI document is the same
class of problem as a stale test server.

Triggers: pushes to `main` and `final-website-production`, every pull request,
and manual dispatch. In-flight runs are superseded by newer pushes **except on
`main`**, where every commit keeps its own result.

## Why three jobs rather than one

`static` needs nothing and finishes fastest, so the common failures (a type
error, a lint violation) come back in a couple of minutes rather than behind a
Postgres container and a browser download. `database` and `browser` have
genuinely different infrastructure, and combining them would mean paying for
both to diagnose either.

## Secrets: none, by design

**No repository secret is referenced and none is required.** This is a property
of the test architecture, not a shortcut:

- `npm test` runs secretless with no database — the M-40 doctrine every unit
  suite depends on;
- `test:rls` and `test:integration` build a **throwaway** database from
  `00_shim` → `0001`…`0030` → seed → fixtures inside a service container. They
  never point at a real project, and the container is destroyed with the job;
- `test:e2e` loads `.env.e2e`, which is committed and contains only
  placeholders chosen to exercise the graceful-degradation paths. Every absent
  key (service role, Turnstile, Upstash, Resend, Stripe, Dropbox Sign, Sentry)
  is a contract the suite proves: the guard no-ops, the write is skipped, the
  action reports honestly rather than crashing.

If a future lane genuinely needs a credential, add it as a **repository
secret** and reference it in the workflow. Never inline a value, and never use
a production one — a CI run that can reach production data is a CI run that can
destroy it.

## Environment specifics

**PostgreSQL 16**, matching what every migration and both SQL suites were
written and validated against. The runner's bundled `psql` is not guaranteed to
be 16, and both suites shell out to it, so the client is pinned to the server's
major version explicitly. Auth is by password (`PGPASSWORD=postgres`) because
the official image does not offer trust auth; it guards a database that does
not outlive the job.

**Linux is not the only place these lanes run — and it was the only place they
worked.** Both SQL suites carried Linux assumptions that CI could never catch,
because CI is Linux:

- `PGHOST` defaulted to `/tmp/pgsock`. Windows PostgreSQL has no unix-domain
  sockets at all, so that default cannot connect there under any configuration.
- `20_rls_isolation.sql` silenced chatter with `\o /dev/null`. `\o` is a psql
  meta-command, not a shell redirect, so a native Windows psql resolves it as
  an ordinary file path and aborts the suite before its first assertion.
- The integration lane's `hookTimeout` sat at vitest's 10s default while
  `testTimeout` had been raised to 30s. Every query is a separate `psql`
  process — ~2s each on Windows — so fixtures blew the hook budget, and vitest
  reports a file whose hook failed as **skipped** tests. The lane went quiet
  rather than red.

All three are fixed by detecting the platform rather than assuming one. CI sets
`PGHOST` explicitly and runs on Ubuntu, so none of it changes what CI does —
which is exactly why CI could not have found any of it.

**Chromium via stock `npx playwright install`.** The `browser` job deliberately
does **not** set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` — that override exists
for images that provision their own binary, and leaving it unset here is what
makes this job the standing proof that the default resolution works on an
ordinary runner. The pinned path is exactly what hid 371 failures.

**`build:e2e`, not `build`.** `NEXT_PUBLIC_*` values are inlined at build time.
Building without `.env.e2e` and then testing with it serves a bundle that
disagrees with its own server, which fails in ways that look like application
bugs.

## On failure

The `browser` job uploads `test-results/` and `playwright-report/` for seven
days. The other two jobs need no artifacts: their failures are in the log.

## What CI does not cover

Stated so nobody reads a green badge as more than it is:

- **No live third-party integration is exercised.** Supabase, Stripe, Resend,
  Dropbox Sign, Turnstile, Upstash and Sentry are all absent or placeholder.
  Their graceful-degradation paths are proved; their happy paths are not.
- **No real Sentry event is sent**, so the privacy scrubber is proved against
  hand-built events, not against payloads the SDK itself produces. The runbook
  carries the one manual check that closes this.
- **Colour contrast is checked in a real browser** by the e2e axe scans, but
  the jsdom-based component a11y suites cannot see it. Both run; only the
  former proves contrast.
- **No deployment step.** CI verifies; it does not ship. Adding a deploy job
  should wait until a human has decided what "ready to ship" means for this
  business.
