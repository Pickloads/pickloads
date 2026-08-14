# PickLoads — RLS Security Review

**Measured** against a database built from `supabase/tests/00_shim.sql` + all
31 migrations + `seed.sql` — the same build the 806-assertion suite uses.

## Headline

| Metric                                                      | Value                    |
| ----------------------------------------------------------- | ------------------------ |
| Public-schema tables                                        | **49**                   |
| Tables with RLS enabled                                     | **49 / 49**              |
| Tables with RLS but zero policies                           | **0**                    |
| Policies                                                    | **118**                  |
| `SECURITY DEFINER` functions without a pinned `search_path` | **0**                    |
| Policies with `using(true)` or `with check(true)`           | **2** (both intentional) |
| RLS assertions in the suite                                 | **806**                  |

A table with RLS enabled and no policy is deny-all — safe, but usually a
mistake. There are none. A table without RLS is a hole. There are none.

## The two permissive policies

| Table                         | Policy                                                     | Verdict                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `company_settings`            | `public read settings` — SELECT to `public`, `using(true)` | **Intended.** Key/value business flags that drive public rendering: `brokerage_active`, `mc_number`, `usdot_number`, `bond_status`, `stats`, `load_ticker_mode`. Every value is already published on the site. Contains no credential and no customer data. Writes are a separate ALL policy requiring `current_user_role` — anon writes were probed and **denied**. |
| `shipment_document_audiences` | SELECT to `authenticated`, `using(true)`                   | **Intended.** Static reference matrix (document type → who may see it). Contains no customer data; it _is_ the visibility rule, not data governed by one.                                                                                                                                                                                                            |

## Grant model — why `anon` holds broad table privileges

`anon` has SELECT/INSERT/UPDATE/DELETE on 32 tables. That is Supabase's
default posture and it is deliberately mirrored by the test shim:

> "on a real Supabase project BOTH `anon` and `authenticated` hold table
> privileges … Row Level Security — not missing grants — is what stops the
> anon key. The shim therefore grants anon the same privileges, so an anon
> assertion that passes here proves the POLICY blocks it, not a grant that
> production does not actually have." — `00_shim.sql` (M-61)

This is the correct conservative choice. A shim that under-granted would make
the suite pass for the wrong reason.

## Isolation model

Own-data scoping never trusts a client-supplied identifier. It goes through
`SECURITY DEFINER` helpers, each with `set search_path = public`:

`my_carrier_ids()` · `my_shipper_ids()` · `my_broker_partner_ids()` ·
`is_staff()` · `current_user_role()`

Because they are `SECURITY DEFINER`, an unprivileged role that reaches a
policy it may not use gets `permission denied for function …` — a hard
refusal rather than a filtered read. Both outcomes are safe; the error is
noisier and appears in the probe results.

## Adversarial verification (executed, not asserted)

Reads — rows existing vs. rows anon can see:

| Table                                                                                                                                              | Rows present | anon sees       |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------- |
| `profiles`                                                                                                                                         | 16           | **0**           |
| `carrier_leads`                                                                                                                                    | 1            | **0**           |
| `contact_messages`                                                                                                                                 | 1            | **0**           |
| `audit_events`                                                                                                                                     | 1            | **0**           |
| `subscribers`, `support_messages`, `webhook_events`, `staff_invites`, `notifications`, `email_log`, `user_preferences`, `shipment_tracking_access` | seeded       | **0**           |
| `carriers`, `documents`, `shipments`, `invoices`, `drivers`, `trucks`, `loads`, `freight_quotes`, `broker_partners`                                | seeded       | **hard denial** |
| `posts`                                                                                                                                            | 1 published  | 1 — intended    |

Writes:

| Attempt                                                         | Result        |
| --------------------------------------------------------------- | ------------- |
| `update company_settings set brokerage_active=true`             | DENIED        |
| `insert into company_settings`                                  | DENIED        |
| `update profiles set role='admin'`                              | 0 rows        |
| `insert into profiles`                                          | RLS violation |
| `delete from audit_events`                                      | 0 rows        |
| `insert into carriers / loads / webhook_events / staff_invites` | DENIED        |
| `insert into subscribers / carrier_leads`                       | DENIED        |

The last row is the architecture behaving as documented: **there are no anon
insert policies.** Public-form writes go through server handlers holding the
service-role key, after Zod + Turnstile + rate limit. A public form working in
the browser while `anon` cannot insert is the proof that the gate is in the
server action, not in the client.

## Not covered

- Policy _logic_ review beyond the 806 assertions — this review confirms
  coverage and shape, and spot-checks isolation. It is not a line-by-line
  proof of every one of the 118 policies.
- Storage RLS (`storage.objects`) is reviewed in `UPLOAD-SECURITY-REVIEW.md`.
- Production database configuration (PITR, network restrictions) — owner
  action, see audit §8.
