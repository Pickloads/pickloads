# PickLoads — Authorization Matrix

Server-side only. Nothing in this matrix is enforced by a hidden button, a
disabled input, or a component that declines to render — those are UX. The
enforcement points are RLS policies, `SECURITY DEFINER` scope helpers, column
privileges (migration 0030), and per-action guards in `src/lib/auth.ts` /
`src/lib/staff-scope.ts`.

Legend: **✓** allowed · **—** denied · **own** own org only · **grant** only
where an explicit grant row exists · **svc** service role only (no session
reaches it).

## Core tables

| Table                                                | anon      | carrier   | shipper   | broker    | dispatcher | admin   |
| ---------------------------------------------------- | --------- | --------- | --------- | --------- | ---------- | ------- |
| `profiles`                                           | —         | own       | own       | own       | ✓ read     | ✓       |
| `carriers`                                           | —         | own       | —         | —         | ✓          | ✓       |
| `shippers`                                           | —         | —         | own       | —         | ✓          | ✓       |
| `broker_partners`                                    | —         | —         | —         | own       | ✓          | ✓       |
| `carrier_memberships`                                | —         | own       | —         | —         | ✓ read     | ✓       |
| `shipper_memberships`                                | —         | —         | own       | —         | ✓ read     | ✓       |
| `documents`                                          | —         | own       | —         | —         | ✓          | ✓       |
| `trucks` / `drivers`                                 | —         | own       | —         | —         | ✓          | ✓       |
| `loads`                                              | —         | own       | —         | —         | ✓          | ✓       |
| `invoices`                                           | —         | own       | own       | —         | ✓          | ✓       |
| `freight_quotes`                                     | —         | —         | own       | —         | ✓          | ✓       |
| `shipments`                                          | —         | own       | own       | grant     | scope      | ✓       |
| `shipment_events`                                    | —         | own       | own       | grant     | scope      | ✓       |
| `shipment_documents`                                 | —         | own       | own¹      | grant¹    | scope      | ✓       |
| `shipment_parties`                                   | —         | own       | own       | grant     | scope      | ✓       |
| `shipment_locations`                                 | —         | own²      | own²      | grant²    | scope      | ✓       |
| `broker_shipment_grants`                             | —         | —         | —         | read own  | ✓          | ✓       |
| `company_settings`                                   | **read**  | read      | read      | read      | read       | ✓ write |
| `audit_events`                                       | —         | —         | —         | —         | read       | read    |
| `webhook_events`                                     | —         | —         | —         | —         | —          | svc     |
| `staff_invites`                                      | —         | —         | —         | —         | —          | ✓       |
| `contact_messages` / `carrier_leads` / `subscribers` | —         | —         | —         | —         | ✓          | ✓       |
| `support_threads` / `support_messages`               | —         | own       | own       | —         | ✓          | ✓       |
| `notifications` / `user_preferences`                 | —         | own       | own       | own       | own        | own     |
| `posts`                                              | published | published | published | published | ✓          | ✓       |

¹ Filtered by the `shipment_document_audiences` matrix — a carrier's insurance
certificate is not visible to the shipper on a shared shipment.
² Coordinates are nulled for non-staff on the public/customer DTO (§9).

**`company_settings` public read is intentional** — it is the key/value store
of business flags already published on the site (`brokerage_active`,
`mc_number`, `bond_status`). Writes require `current_user_role`; anon writes
were probed and denied.

## Writes never accepted from a session

`webhook_events` · `email_log` · `shipment_notification_attempts` ·
`account_status_history` · `audit_events` (append-only; no session may DELETE)

These are written by the service role or by `SECURITY DEFINER` functions only.

## Cross-tenant matrix (the IDOR direction)

| Attempt                              | Control                                                                |
| ------------------------------------ | ---------------------------------------------------------------------- |
| Carrier A → Carrier B                | `my_carrier_ids()` — membership-derived, never a request parameter     |
| Shipper A → Shipper B                | `my_shipper_ids()`                                                     |
| Broker A → Broker B                  | `my_broker_partner_ids()`                                              |
| Broker → ungranted shipment          | `broker_shipment_grants`; partner has no write path to the grant table |
| Carrier → shipper margin             | `restricted-fields.ts` + column privileges (0030)                      |
| Shipper → carrier pay                | same                                                                   |
| Carrier/Shipper → dispatcher surface | `is_staff()`                                                           |
| Dispatcher → admin operation         | separate admin policy set + action guards; not a UI condition          |
| Any session → service role           | Not reachable. One module, `server-only`, no generic proxy endpoint    |

## Verified by execution

`tests/*` — 806 RLS assertions, 369 integration tests. Plus the direct
adversarial probe in `RLS-SECURITY-REVIEW.md`: 16 profiles exist, anon sees 0;
every anon write denied including `brokerage_active` and `profiles.role`.

## Known limits of this matrix

It is derived from policy coverage, the scope helpers, and spot-check probes —
**not** from an exhaustive per-policy proof of all 118 policies, and not from
authenticated cross-tenant probes executed in this audit (those rely on the
existing 806-assertion suite, which does cover them). A penetration test
should re-derive this table independently.
