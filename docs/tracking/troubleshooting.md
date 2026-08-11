# Troubleshooting

Symptom first, because that is what you have. Each entry says how to confirm
the diagnosis before changing anything.

---

## "Tracking is unavailable right now" on `/track`, for every number

**Cause.** `TRACKING_ACCESS_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` is unset.
The lookup returns `unavailable` — deliberately distinct from `refused`,
because it is true for every input including numbers that do not exist, and so
is not an oracle.

**Confirm.** Look for the structured signal `public_tracking_failure` with
`code: "not_configured"` in the server log.

**Fix.** Set the variable and redeploy. Note that rotating the secret
invalidates every access code already issued — see `launch.md` §1.

---

## A customer's correct ZIP is refused

Work down this list; the first three are far more common than the fourth.

1. **`public_tracking_enabled` is false** on that shipment. An admin suspended
   it (§15). The refusal is intentionally identical to an unknown number.
2. **The hash was written under a different secret.** If
   `TRACKING_ACCESS_SECRET` was rotated, every pre-rotation code is dead. The
   plaintext was never stored, so there is nothing to re-hash from.
3. **ZIP+4 vs ZIP5.** Both are accepted; a *different* ZIP is not. Confirm the
   delivery ZIP on the shipment matches the one on the customer's paperwork.
4. **The shipment does not exist**, e.g. it was created before `brokerage_
   active` was enabled and the insert was refused.

**Confirm.** `select outcome, accessed_at from shipment_tracking_access where
tracking_number_attempted = 'PL-…' order by accessed_at desc limit 10;` — the
ledger records the *true* outcome even though the customer saw the generic
one.

---

## The customer is rate-limited and should not be

**Confirm.** A `rate_limited` row in the ledger with a **null** shipment id
(the attempt never got far enough to identify one).

**Cause.** The limit is per IP. A corporate NAT puts a whole office behind one
address.

**Fix.** Look the shipment up from the desk and read it out, or send the
customer a portal invitation. Do not raise the global limit for one caller.

---

## A driver link does not work

Every failure renders the same page by design, so diagnose from the ledger,
never from the page:

```sql
select outcome, accessed_at, ip
  from shipment_driver_token_access
 where shipment_id = '…' order by accessed_at desc limit 20;
```

| Ledger says | Meaning |
|---|---|
| `expired` | past `expires_at` — issue a new one |
| `revoked` | somebody revoked it; revocation is one-way |
| `unknown` | the token does not exist — usually a truncated copy-paste |
| `carrier_mismatch` | the shipment was reassigned or the carrier released. This is intended: the old driver loses access immediately |
| `rate_limited` | too many presentations from that IP inside the window |

If **nothing** is in the ledger, the request never reached the redeem path —
check `DRIVER_TOKEN_SECRET` and look for the `driver_token_not_configured`
signal.

---

## A status change is refused

The refusal code says which of three gates stopped it, and the order matters:

| Code | Meaning |
|---|---|
| `actor_not_permitted` | this role may never assert this status. Not a paperwork problem — a carrier cannot `complete` |
| `illegal_edge` | the graph does not declare this transition from the current status |
| `same_status` | nothing to record |
| `precondition_failed` | the edge is legal and a fact is missing (see below) |
| `PL409` (from the RPC) | somebody else changed the shipment since the page rendered. Reload |

**`pod_uploaded` refused** is nearly always one of four things: no POD, an
unapproved POD, a *rejected* POD, or an approved document of the wrong type (a
BOL is not a POD). Un-approving a POD makes the status unreachable again.

**`completed` refused** additionally needs the human closeout assertion.

**`cancelled` refused** needs a reason. There is no way to cancel without one.

---

## "Shipments are not being created"

**Confirm.** `select value from company_settings where key = 'brokerage_active';`

If it is `false`, 0017's trigger refuses every insert with `P0001` and the
create form renders an honest card instead. This is the correct launch state.
It **fails closed** if the key is missing entirely — a missing switchboard is
not permission to trade.

Shipments already in flight are unaffected: status, ETA, notes, assignments
and documents all keep working. That is deliberate, and tested.

---

## A shipper sees an empty list but has freight

1. **Membership, not ownership.** `select * from shipper_memberships where
   profile_id = '…';` — a user with no membership has no shipments. This is
   the most common cause by a wide margin.
2. **Filters.** The nine §11 filters compose; a stale date window from a
   previous visit narrows to nothing.
3. **Wrong organization.** A user can belong to one shipper and be looking for
   another's freight.

---

## A query fails with `42501: permission denied for table shipments`

Expected for `anon` and for any browser role selecting a column outside the
49 that migration 0030 grants — including `margin`, `carrier_pay` and
`gross_shipper_amount`. It is the privilege layer working.

**If it is a legitimate new column**, grant that one column:

```sql
grant select (new_column) on public.shipments to authenticated;
```

Do **not** re-grant the table. Add the column to `SHIPMENT_LIST_COLUMNS` /
`SHIPMENT_DETAIL_COLUMNS` and to the DTO allow-list in the same change, or the
key-set tests will fail — which is the intended coupling.

---

## Staff cannot see a financial figure they should

Financial columns are not readable from the row by anybody in a browser
session. They come back through `shipment_restricted_fields(shipment_id)`,
which returns **no row** when the caller is out of audience — not a row of
nulls, because that would be an existence oracle.

An out-of-scope dispatcher gets nothing. Check `dispatcher_may_see(shipment_
id)` for that session; scope is assigned carriers plus their own shipments.

---

## Notifications are not going out

In order:

1. **Is the cron firing?** Check `vercel.json` and the deployment's cron log.
2. **`CRON_SECRET` set?** Without it the route returns 503 and does nothing.
3. **Read the worker's response body**, not just the status code. It reports
   harvested, claimed and settled counts.
4. **Is the row in the queue at all?** If not, the harvest did not consider it
   news — check the rule's dedupe scope, and remember that an ETA update is
   notified for *delivery* only, a POD on *approval* only, and a delay only
   when the exception has a customer description.
5. **Is it suppressed?** A preference off or an address-level unsubscribe
   suppresses at the source, terminally. The in-app feed row is still written.
6. **Is it dead?** Attempts exhausted. The attempt ledger says why each failed.

---

## Emails contain raw keys like `phrase:delay.traffic`

A regression of a real M-79 defect. Operator phrases must be resolved through
the catalogue in `src/lib/shipments/phrases.ts` before they reach a template.
Never render a phrase key directly, and never machine-translate operator free
text (§24).

---

## The map shows nothing

Not necessarily a fault. With no provider configured the surface renders its
**text equivalent** — the same facts as a list. That is a supported state.

If a provider *is* configured and there is still nothing:

- Check the shipment's `location_visibility`. `hidden` and `milestone_only`
  disclose nothing to any customer, by design.
- Check `tracking_mode`. If the last link was revoked, the shipment correctly
  returned to `milestone` tracking.
- Check `shipment_locations` for the shipment. Every adapter in the repo
  currently refuses every fetch — there is no telematics contract — so
  positions come from manual updates only. **Do not add a fallback that
  invents one** (§30).

---

## Location history is disappearing

`purge_expired_shipment_locations()` runs nightly and is working as specified.
`location_retention_days` controls the window; the expiry stamp is written at
**insert**, so *shortening* the window still expires old rows and *lengthening*
it does not resurrect rows already promised a shorter life.

An unparseable setting resolves to 90 — never to "keep forever". Check
`locationRetention.retentionDays` in `/api/cron/daily`'s response: if it reads
90 after you changed it, the value did not parse.

---

## A timeline event is wrong

There is no edit. `shipment_events` is append-only for every role including
the table owner.

Use the admin correction path: it appends a **new** event carrying `from`,
`to` and a mandatory reason, leaving the original byte-identical. A correction
with a stale expected status raises `PL409` — reload and retry.

The tracking number still cannot be changed, by anybody, ever.

---

## Where to look when nothing above fits

- `shipment_events` — everything that happened, in order, with its band.
- `audit_events` — every staff action and every document download.
- `shipment_tracking_access` — every public lookup and its true outcome.
- `shipment_driver_token_access` — every driver-link presentation.
- the structured `[shipment]` signals in the server log — see M-84b's
  observability document for the vocabulary.

Between them, the honest answer to "what actually happened" is nearly always
recoverable without guessing.
