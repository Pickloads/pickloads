# Document permissions

## What it is

Which document type reaches which audience, and how a file gets from a phone
camera to a customer's download without ever sitting in a public bucket.

## The matrix

§16 asks for a visibility **matrix**, and until M-77 the repo had an enum with
no mapping. The mapping now exists twice — once as
`DOCUMENT_AUDIENCES` in `src/lib/shipments/documents.ts` and once as the
`shipment_document_audiences` table — and a test compares them cell for cell
across all fifty-five combinations. Two representations that agreed by
convention would drift; two that are asserted equal cannot.

The audiences are `shipper`, `carrier` and `broker`. Two values are
deliberately **absent** from the matrix:

- **`public`** — no document reaches an anonymous visitor. Inserting a
  `public` cell raises `23514`. There is no public document surface at all.
- **`staff_only`** — it is the floor, not an audience. Every document is
  readable by staff; the matrix decides who *else*.

Highlights of the mapping: a **rate confirmation** reaches the carrier and
nobody else — filing one as `shipper` is refused by the database, because the
carrier's rate is one subtraction away from the margin. A **BOL** reaches
shipper, carrier and (per §12) an authorised broker. A **POD** reaches all
three. Insurance certificates, claims and internal paperwork stay staff-only.
An unrecognised type defaults to `staff_only`, and narrowing any type to
`staff_only` is always legal — narrowing is never a security decision.

## Lifecycle

```
upload → pending → (staff review) → approved | rejected | expired
```

`add_shipment_document()` writes the row **and** its §7 event in one call, at
`pending` status, which reaches nobody. It refuses an object path outside the
shipment's own storage prefix, and it is idempotent: a retried upload does not
produce a second row. Once filed, a document is immutable in what it *is* —
type, path, name and size cannot change; only the review decision can.

`review_shipment_document()` records the decision. Approval publishes a
customer-visible event; rejection does not, because "your paperwork was
rejected" is a conversation, not a notification. A CHECK keeps
`approved_at is not null` exactly equivalent to `status = 'approved'`, so the
two can never disagree.

## Storage

Files live in a **private** Supabase Storage bucket. Migration 0024 grants no
customer policy on `storage.objects` for that bucket at all: the row decides
who may read, and the object is served by us.

A download mints a signed URL with `SIGNED_URL_TTL_SECONDS` of 300 (§16's
ceiling) through three gates, in this order:

1. **RLS** — the row is read on the *caller's* client. A document they may not
   see comes back `null`, indistinguishable from one that does not exist. This
   is also the enumeration answer.
2. **The matrix again**, re-checked in TypeScript. It cannot widen gate 1; it
   can only catch a policy written too loosely. Staff (`audience === null`)
   skip it.
3. **The audit write**, performed *before* the URL is returned — so a mint
   that is not recorded is a mint the caller never receives.

The journal entry carries the shipment id, the document type, the audience and
the TTL. It never carries `signedUrl`, which would be a live credential
sitting in a table operators read for up to five minutes. That absence is
asserted, not assumed: the integration lane substitutes a signer that returns
a URL containing a sentinel and then sweeps the ledger row for it.

## POD and the `pod_uploaded` precondition

§20 says a shipment cannot reach `pod_uploaded` without a POD, and the honest
version of that turned out to have four failure modes, each of which now has a
test:

- no POD at all → refused;
- an **unapproved** POD → still refused (the matrix's "approved" is
  load-bearing);
- a **rejected** POD → refused;
- an approved document of the **wrong type** (a BOL) → refused.

Un-approving the POD makes the status unreachable again. The precondition
lookup is served by a partial index, and the integration lane asserts the plan
uses it.

## Who audits what

Every download, by every audience including staff, writes an `audit_events`
row with `action = 'document.download'` through `recordAuditEvent` — the
single writer (M-61). Before that consolidation, three sensitive actions had
no journal entry at all and four files wrote the ledger directly; a lint rule
now keeps the writer single.

The `getStaffDocumentUrlAction` path had **no shipment scope check** until
M-83 found it: a dispatcher could mint a URL for a document on a shipment
outside their scope. The scope check is now in the action and the restrictive
policy backs it up.

## Where the tests are

- `tests/unit/shipment-documents.test.ts` — the matrix, the audience predicate
  and the DTO filter
- `tests/integration/shipment-documents.test.ts` — the matrix in SQL vs
  TypeScript, upload, review, the four POD precondition cases, per-audience
  reads through the real policies, and the bounded/indexed reads
- `tests/integration/tracking-flows.test.ts` — a shipper reaching their own
  POD and being refused the rate confirmation on the *same* shipment
- `tests/e2e/shipment-documents.spec.ts`

## Extension points

A new document type needs an enum value **and** a row in
`shipment_document_audiences`. The matrix test fails on any type with no
audience decision, which is the point: "we'll decide later" is how a rate
confirmation ends up in a shipper's download list.
