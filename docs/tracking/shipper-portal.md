# Shipper tracking portal

## What it is

`/portal/shipper/shipments` and `/portal/shipper/shipments/[shipmentId]` — the
authenticated view a customer uses to see their own freight. §11 of the
directive specifies it; M-74 built it.

## Who sees what

Access is by **membership, not ownership**. A shipper user belongs to a
`shippers` organization through `shipper_memberships`, and
`my_shipper_ids()` resolves the set from `auth.uid()`. Every policy on
`shipments`, `shipment_events`, `invoices`, `shipment_documents` and
`shipment_exceptions` consults it. A user with no organization sees nothing —
and is told "not found" rather than "forbidden", because the two answers are
different amounts of information.

A shipper reads the `public` and `shipper` timeline bands. Never `carrier`,
never `broker`, never `staff_only`.

## The list

Server-side pagination, server-side filtering, server-side counting. Nothing
is fetched and then narrowed in the browser.

§11 names nine filters and all nine are implemented in
`src/lib/shipments/shipper-list.ts`:

tracking number · PO / reference (searching both columns) · pickup date window
· origin · destination · status · equipment · delayed · delivered

They compose: applying all nine at once produces one query with one answer. A
hostile filter value is a **value** and not a new operand — the integration
lane asserts that an injection attempt narrows the result set to nothing
rather than widening it.

Page size has a ceiling a caller cannot raise (`MAX_PAGE_SIZE`), and the
projection (`SHIPMENT_LIST_COLUMNS`) names its columns. The three financial
columns are not among them, and are not merely filtered out afterwards —
migration 0030 revokes the column privilege, so a widened projection fails
with `42501` instead of leaking.

## The detail

Ten blocks, per §11: header summary, progress timeline, shipment summary,
contacts, documents, invoice status, ETA, exceptions, map slot, and update
history.

The read is split deliberately (§25):

- `getShipmentSummary` — one row, no event query. This is what the page needs
  to render its header, and it does not pay for history it may not show.
- `getShipmentTimelinePage` — one page of events plus a single lookahead row,
  which answers "is there more?" without a second query.
- `getShipmentInvoices`, `getShipmentContacts` — separate, bounded, and each
  scoped by its own policy.

There is no N+1: a list page issues one query for rows, one for the count, and
one for the tiles' aggregates — the tiles count without loading a row.

Contacts apply the visibility rule on `shipment_parties`, so a shipper sees
the parties they are entitled to and not the carrier's dispatcher's mobile.

Invoice status comes from `invoices` under migration 0021's policy. A shipper
sees the invoice raised **to them**; the carrier's invoice is a different row
they cannot read. That separation exists because an early design had
`invoices.carrier_id NOT NULL`, which would have exposed the shipper's
`amount_cents` to the hauling carrier and given away the margin by
subtraction. The column is nullable with a CHECK instead.

## Documents

The shipper sees the document types §16's matrix maps to the `shipper`
audience, and only after a staff member has approved them. Download is a
server action that mints a signed URL valid for at most 300 seconds, after
re-checking the matrix in TypeScript on top of the RLS decision, and journals
the access. See `document-permissions.md`.

## The map slot

Rendered only when the shipment's location visibility allows it, and always
with a text-equivalent list of the same facts beside it. §30's honest labels
apply: *"Last updated by dispatch"*, *"Location temporarily unavailable"*,
*"ETA provided by dispatcher"*. The page does not say "live tracking".

## Support

`/portal/shipper/support` is the authenticated thread surface (M-55). A
customer-authored message is written under the `own support threads insert`
and `own support messages insert` policies, which force `is_staff = false` at
the policy level — a forged staff flag cannot render as PickLoads. Rate limits
apply per user.

## Isolation, proved

`tests/integration/shipper-shipments.test.ts` asserts the whole boundary
against real rows under real sessions, and — the part that matters — proves it
is the **policy** doing the work by re-issuing the same queries with the
application-level `shipper_id` predicate removed. The database still returns
nothing to the wrong tenant, and the same unscoped query as an admin returns
everything, so the zero is scope rather than an empty table.

## Environment

None specific to this surface beyond the Supabase connection. Documents need
`SUPABASE_SERVICE_ROLE_KEY` for URL signing.

## Extension points

- **A tenth filter**: add it to `ShipmentListFilters`, to `parseShipmentFilters`
  and to `applyShipmentFilters`. The composition test will exercise it.
- **A new detail block**: read it in its own bounded query rather than joining
  it into the summary. The summary's job is to be cheap.
