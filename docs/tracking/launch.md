# Launch procedure

## What it is

The tracking-specific chapter of going live. The full operational runbook is
`docs/LAUNCH-RUNBOOK.md` (Supabase, Vercel, DNS, Resend, Turnstile, Upstash,
Dropbox Sign, Stripe, cron, GA4); this document is the part that is about
shipments, and §11 of the runbook cross-references it.

Read `migrations.md` first if you have not applied 0017–0030 anywhere yet.

## 1 · Environment variables

Everything below is new or newly load-bearing for tracking. Each row says what
happens when it is **unset**, because the system is built to degrade honestly
rather than to crash — and because "it silently did nothing" is the failure
mode you want to be able to recognise.

| Variable | Where | Unset → |
|---|---|---|
| `TRACKING_ACCESS_SECRET` | server | `/track` returns `unavailable` for **every** input. Not an oracle, but tracking is off |
| `DRIVER_TOKEN_SECRET` | server | driver links cannot be minted or verified; the page shows the dispatch number |
| `SUPABASE_SERVICE_ROLE_KEY` | server **only** | every write path and the public lookup are unavailable |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | client | no session, no portal |
| `CRON_SECRET` | server | `/api/cron/*` return 503 — no notifications, no retention purge |
| `RESEND_API_KEY` | server | emails logged, not sent |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | server | rate limiters disabled (**dev only** — required in production) |
| `TURNSTILE_SECRET_KEY` / `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | both | challenge skipped (**dev only**) |
| `NEXT_PUBLIC_SITE_URL` | both | tracking and unsubscribe links have no absolute base |
| `NEXT_PUBLIC_MAP_PROVIDER` | client | the map slot renders its text equivalent |
| `NEXT_PUBLIC_MAP_TILE_URL`, `MAP_API_KEY` | as named | same |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | both | structured signals are logged to stdout only (see M-84b) |

Generate the two tracking secrets with real entropy and store them nowhere but
the platform's secret store:

```bash
openssl rand -base64 48   # TRACKING_ACCESS_SECRET
openssl rand -base64 48   # DRIVER_TOKEN_SECRET
```

**Rotating `TRACKING_ACCESS_SECRET` invalidates every access code already
issued.** Existing customers' ZIP-based lookups keep working (the ZIP is
re-hashed on each attempt against the stored hash — which was written under
the old key, so it does **not**). Treat rotation as a customer-visible event:
re-issue access codes, or accept that in-flight shipments must be tracked
through the portal until they close. There is no migration that re-hashes,
because the plaintext was never stored — which is the point.

**Never** expose the service-role key to the browser. It is server-only, it is
not `NEXT_PUBLIC_`, and no client component imports a module that reads it.

## 2 · Database migrations

Apply 0017 → 0030 in order. They are additive; none drops or rewrites a
pre-tracking table.

```bash
supabase db push            # or apply each file in order in the SQL editor
psql "$DATABASE_URL" -f supabase/seed.sql   # idempotent: on conflict do nothing
```

Ordering constraints that actually bite:

- **0028 must commit before 0029.** Postgres cannot use a new enum value in
  the same transaction that adds it; that is the only reason 0028 is its own
  file.
- **0030 revokes `select` on `shipments` from `authenticated` and `anon`**,
  then grants 49 named columns back. If a deploy of application code that
  selects a 50th column lands *before* 0030, that query starts failing with
  `42501`. Apply 0030 and deploy together, or apply it first.
- The seed's eleven `company_settings` keys must exist before the first page
  load, or gated surfaces fail closed (which is correct, and looks like an
  outage).

Verify:

```sql
select count(*) from pg_policies where schemaname = 'public';       -- ≥ 100
select count(*) from pg_policies where permissive = 'RESTRICTIVE';  -- 14
select has_column_privilege('authenticated', 'shipments', 'margin', 'select');
-- must be false
```

## 3 · Public tracking configuration

1. Set `TRACKING_ACCESS_SECRET`. Nothing else works without it.
2. Decide the second factor per shipment. The default is the **delivery ZIP**,
   hashed at create time. An explicit access code is the alternative for
   shipments whose ZIP is widely known (a distribution centre).
3. Confirm `public_tracking_enabled` defaults to `true` and that suspending a
   shipment works: switch it off, look the shipment up with the correct code,
   and confirm the refusal is the same one an unknown number gets.
4. Confirm the rate limit is live: five rapid lookups from one IP should trip
   it, and `shipment_tracking_access` should hold a `rate_limited` row with a
   **null** shipment id.
5. Confirm Turnstile renders and that a missing token is rejected once
   `TURNSTILE_SECRET_KEY` is set.
6. Read one row of `shipment_tracking_access` and confirm the attempted second
   value appears **nowhere** in it.

## 4 · Map configuration

Runbook §9b has the full version. In short: with no provider configured the
surface renders the text equivalent, which is a supported state and not a
degraded one. When configuring a provider, confirm the map is bounded (never
wider than its container, never taller than 320px, never more than 60% of a
phone screen) and that the text equivalent still carries the same facts.

Set `location_retention_days` deliberately. 90 is the default and the argued
one: long enough for a billing dispute, short enough that a breach does not
surrender a year of movements.

## 5 · Notification setup

1. `RESEND_API_KEY`, and the sending domain verified (SPF/DKIM) — runbook §4.
2. `CRON_SECRET`, and both cron entries present in `vercel.json`:
   `/api/cron/daily` at `0 11 * * *` and `/api/cron/notifications` every five
   minutes.
3. Trigger the worker manually once and read the response body. It reports
   what it harvested, claimed and settled.
4. Send one real email per template family and confirm an `email_log` row.
5. Confirm the unsubscribe link resolves and that the message carries a
   `List-Unsubscribe` header.
6. Confirm `/api/cron/daily`'s `locationRetention.retentionDays` matches the
   switchboard value. If it still reads 90 after you changed it, the value did
   not parse.

## 6 · Smoke tests (production, after the first deploy)

Run these in order. Each is a minute, and each has caught something.

1. **`/track` renders** and asks for two factors. With scripting disabled the
   `<noscript>` block shows the dispatch number.
2. **An unknown number is refused** with the generic message, and
   `shipment_tracking_access` gains a row with the true outcome.
3. **Create a shipment** as a dispatcher (this requires `brokerage_active` —
   see §7). Confirm it has a `PL-YYYY-######` number and a `shipment_created`
   event.
4. **Assign a carrier.** Confirm the assignment row, the `carrier_id` and the
   event.
5. **Walk it to `delivered`** through the portal. Confirm each status wrote an
   event and that the shipper portal shows the timeline.
6. **Look it up publicly** with the delivery ZIP. Confirm the payload shows
   status and milestones and **no** money.
7. **Issue a driver link**, open it, confirm it works, revoke it, confirm the
   same URL now refuses — and that the refusal looks identical to an unknown
   token.
8. **Upload a POD**, approve it, confirm `pod_uploaded` becomes reachable and
   that the shipper can download it. Check `audit_events` for the
   `document.download` row and confirm it contains no signed URL.
9. **Confirm a second shipper account cannot see any of it** — list, detail,
   timeline and document all empty.
10. **Complete the shipment** and confirm the notification queue produced the
    expected rows and the worker sent them.

## 7 · Go-live checks

- [ ] All twelve environment variables above set in production **and**
      staging, with different secret values.
- [ ] Migrations 0017–0030 applied; the three verification queries in §2
      return the expected values.
- [ ] Seed applied; all eleven `company_settings` keys present.
- [ ] `brokerage_active` reviewed **with counsel**. While it is `false`, the
      create form is an honest card, the create action refuses with a readable
      reason, and 0017's trigger refuses the insert underneath both — and
      shipments already in flight stay fully operable.
- [ ] `location_retention_days` set deliberately.
- [ ] Both cron entries firing; check the response bodies, not just the 200.
- [ ] Rate limiting **live** (Upstash configured, not the dev no-op).
- [ ] Turnstile **live**.
- [ ] `npm run test:rls` against the staging database.
- [ ] `npm run test:integration` on the release commit.
- [ ] `npx playwright test` against the production build.
- [ ] The ten smoke tests above, on production, with a real shipment that is
      then cancelled — not left in the data as a fake.
- [ ] §30 review: no page claims "live tracking" while updates are manual, no
      page claims AI, no fabricated shipment is displayed anywhere.

## 8 · Rollback

There are no `down` migrations, deliberately — a `down` that drops a table
drops the data in it, and the moment somebody reaches for one is exactly the
moment that is unacceptable.

**By blast radius, smallest first:**

| Symptom | Action |
|---|---|
| Public tracking is leaking or misbehaving | Unset `TRACKING_ACCESS_SECRET`. Every lookup returns `unavailable`; nothing else is affected. Reversible in seconds |
| Driver links are compromised | Rotate `DRIVER_TOKEN_SECRET`. Every outstanding link dies immediately; re-issue from the board |
| Notifications are sending wrongly | Remove `/api/cron/notifications` from `vercel.json` and redeploy. The queue keeps accumulating; nothing is lost |
| Retention is deleting too aggressively | Raise `location_retention_days` in Settings. **This does not resurrect deleted rows** — the stamp is written at insert. Restore from backup if the loss matters |
| A code deploy is bad | Roll back the Vercel deployment. The schema can stay: 0017–0030 are additive and the previous build tolerates their presence |
| 0030's column privileges break a query | `grant select (<column>) on public.shipments to authenticated;` for the specific column, then fix the query. Do **not** re-grant the table |
| 0030's restrictive policies over-scope a dispatcher | `alter policy` on the specific policy, or `drop policy` it. The permissive policies underneath are unchanged, so dropping one restores the pre-M-83 behaviour for that table |
| The brokerage gate must close urgently | Set `brokerage_active` to `false` in Settings. No deploy. New shipments are refused; in-flight freight keeps running |

Take a backup before anything that is not in the table above.

## 9 · The day the MC activates

Runbook's one-pager covers it. The tracking-relevant step is the last one:
flip `brokerage_active` to `true` **only** when the bond is effective and the
broker processes exist. Until then every honest label on the site says
"launching soon", and that is a claim you can defend.
