# M-77 — Shipment Documents + POD Workflow

**Status:** ✅ Complete · **Phase:** B (tracking core) · **Date:** 2026-08-05

Scope: `docs/FINAL-IMPLEMENTATION-PLAN.md` §7, Phase B module table, row M-77 —
*"Shipment documents + POD: private storage, signed URLs ≤300s, **explicit
visibility matrix**, broker value in `doc_visibility`, document-access
history"*, and §4's restored row *"§16 Document visibility MATRIX (which doc
type → which audience) + a broker value in `doc_visibility`"*.
Authority: `docs/DIRECTIVE-tracking.md` §16 (the document list and the three
audience lists), §12 (broker permissions, *"BOL, when authorized"*), §4 (what
the public must never see), §11 (the ninth dashboard tile), §13 (carrier and
driver uploads), §14/§15 (staff filing, review and **document-access
history**), §19 (RLS per audience), §20 (**`pod_uploaded` requires an approved
POD**), §24 (five locales), §25 (bounded, indexed, no N+1), §26
(document-download errors as a tracked signal), §30 (honest labels).

Migration **0024**. 0001–0004 remain frozen.

---

## What was built

| File | Contents |
|---|---|
| `supabase/migrations/0024_shipment_documents.sql` | The private `shipment-docs` bucket · `shipment_document_audiences` (the matrix, as 22 rows) · `shipment_documents` · 3 indexes · 2 triggers · 4 policies · 4 `security definer` functions · **the replacement of `shipment_transition_facts()`** |
| `src/lib/shipments/documents.ts` | **The matrix as data.** `DOCUMENT_AUDIENCES`, `DEFAULT_DOCUMENT_VISIBILITY`, `documentReachesAudience`, the per-role upload allow-lists, the bucket name, the path builder, `CustomerDocumentDto` + `toCustomerDocumentDtos`, §25's page bounds. Plain module — imported by client components. |
| `src/lib/shipments/document-store.ts` | `server-only`. Upload pipeline (size → magic bytes → role allow-list → randomized path → storage → 0024's function), review, bounded list reads, and `getShipmentDocumentUrl` — RLS → matrix re-check → audit → ≤300s signed URL. |
| `src/lib/validation/shipment-documents.ts` | Four Zod schemas, one per uploader role plus review and download. |
| `src/app/actions/shipment-documents.ts` | Eight server actions: 3 uploads (carrier / driver / staff), 1 review, 4 per-audience download wrappers. |
| `src/components/portal/ShipmentDocuments.tsx` | `DocumentList` + `DocumentUploadForm` — the five-locale customer components. |
| `src/components/portal/ShipmentDocumentReview.tsx` | `StaffShipmentDocuments` — the English-only dispatcher surface (upload · review · the §12 broker note). |
| `tests/unit/shipment-documents.test.ts` (90) | The 44-cell matrix walk, the DTO key-set, MIME sniffing, the TTL scan, §25's bounds, §24's five catalogues. |
| `tests/integration/shipment-documents.test.ts` (37) | TS matrix ↔ SQL matrix, §27's *document upload* and *POD upload*, per-audience reads under real RLS. |
| `supabase/tests/{10_fixtures,20_rls_isolation}.sql` (+55) | Eight documents on two shipments, one per matrix outcome; per-audience read proofs. |
| `tests/e2e/shipment-documents.spec.ts` (11) | Gates, the unauthenticated driver surface, axe, four viewports. |

**Changed surfaces:** shipper detail (M-74's honest empty state → the real
list) · carrier detail and the driver link (M-76's placeholder → working
uploads) · dispatcher detail (upload + review + broker-band note) ·
`shipper-tiles.ts` (§11's ninth tile stops being `null`) ·
`staff-detail.ts` (`staffTransitionFacts` now takes the POD fact) ·
`types.ts` (four fields added to `ShipmentDocumentRow`, argued below) ·
`database.types.ts` · `security.test.ts` (the TTL and audit scans extended to
the new file) · the five locale catalogues.

---

## THE VISIBILITY MATRIX

This is the restored requirement. `FINAL-IMPLEMENTATION-PLAN` §4: *"Enum
defined, mapping never stated; no broker value → §12 'BOL when authorized'
unimplementable."* M-70 shipped the vocabulary and deferred the mapping here
by name. Here it is, in full.

Read a cell as: **an APPROVED document of this type, whose row-level
`visibility` has not been narrowed to `staff_only`, is readable by this
audience.** Staff read every document on a shipment they operate — that is
what "staff-only" means as a floor rather than a band.

| Document type | public | shipper | carrier | broker | staff | Authority |
|---|:---:|:---:|:---:|:---:|:---:|---|
| `quote` | — | ✅ | — | — | ✅ | §16 shipper "approved shipment paperwork"; §12/§18 keep it from the carrier |
| `shipper_confirmation` | — | ✅ | — | — | ✅ | §16 shipper; the shipper's commercial correspondence |
| `rate_confirmation` | **—** | **—** | ✅ | **—** | ✅ | §16 "carrier rate confirmation"; **§4 forbids it publicly**; §12 omits it |
| `bol` | — | ✅ | ✅ | ✅ | ✅ | §16 under BOTH lists; **§12 "BOL, when authorized"** |
| `lumper_receipt` | — | ✅ | ✅ | — | ✅ | §16 "approved operational documents" / "approved shipment paperwork" |
| `detention_documentation` | — | ✅ | ✅ | — | ✅ | §16, as above |
| `delivery_receipt` | — | ✅ | ✅ | — | ✅ | §16, as above |
| `pod` | — | ✅ | ✅ | ✅ | ✅ | §16 under both lists; **§12 names POD unqualified** |
| `invoice` | — | ✅ | — | — | ✅ | §16 "shipper invoice"; §12 forbids brokers seeing shipper billing |
| `claim` | — | — | — | — | ✅ | §16 staff-only, "private claim review" |
| `other` | — | ✅ | ✅ | ✅ | ✅ | §16's escape hatch — **defaults to `staff_only`**; widening is an explicit act |

Two rules narrow every cell:

1. **`status <> 'approved'` → nobody but staff.** §16's shipper and carrier
   lists both say "**approved**". A `pending` document has not been checked; a
   `rejected` one has been checked and failed.
2. **`visibility = 'staff_only'` → nobody but staff**, whatever the type
   licenses. A BOL held back pending a correction.

And one rule that cannot be broken: **`visibility` narrows, it never widens.**
0024's `trg_shipment_documents_visibility` refuses any value the matrix does
not license for the type, so `rate_confirmation` filed as `shipper` is a
**PL422 write failure**, not a code review. §4's *"never show carrier rate
confirmations"* is a database property here.

### Where the matrix lives, and why twice

`DOCUMENT_AUDIENCES` in `src/lib/shipments/documents.ts` **and**
`shipment_document_audiences` (22 rows) in migration 0024. Twice, because RLS
cannot import TypeScript and a client component cannot query Postgres.

Drift between them is the worst bug this module could ship — the app showing a
POD the database refuses is annoying; the database handing out a rate
confirmation the app believed was carrier-only is a commercial disclosure.
Neither the unit lane (no database) nor the RLS lane (no TypeScript) can see
it, so `tests/integration/shipment-documents.test.ts` reads the table back and
compares **all 44 customer cells**, then asks the SQL predicate and the TS
predicate the same 55 questions and asserts identical answers.

### The three judgment calls

§16's lists are recommendations over eight named documents; the enum has
eleven. Three cells are decisions rather than transcriptions:

- **`quote` and `shipper_confirmation` → shipper, not carrier.** A carrier
  holding both the shipper's quote and their own rate confirmation has
  computed the margin, which §12 and §18 forbid disclosing. §16's carrier list
  names the *carrier* rate confirmation specifically; this is why it is
  specific.
- **`invoice` → shipper only.** §16 says "shipper invoice". A carrier invoice
  is an `invoices` row under M-31's own policies, not a shipment document.
- **`claim` → staff only, with a workflow.** A claim file mid-review carries
  the other party's account of events; releasing it before settlement
  prejudices the settlement. The settled outcome is re-filed as `other`, which
  the matrix does license — so the workflow exists without widening `claim`.

### `broker`, and why the band had to exist

§12 gives a broker partner *"assigned shipments, status, timeline, POD, BOL
when authorized"* and forbids *"carrier's private packet, carrier insurance
records, shipper billing, PickLoads commission, internal margin"*. Without a
`broker` value there are two options and both are wrong: show brokers the
`shipper` band (which carries the invoice and the quote) or show them nothing
(which makes §12 unimplementable). M-70 added the enum value for exactly this;
M-77 is the module that uses it.

**The authorization is the link.** §12's "when authorized" is
`shipments.broker_partner_id`, and `my_broker_partner_ids()` (0018) already
filters on `broker_partners.active` — so an un-approved or de-activated
partner organization reads nothing, which the RLS suite proves with a live
de-activation and re-activation.

**M-81 owns the broker SURFACE.** It has not run. What M-77 ships is the band
itself: the matrix cells, the RLS policy (exercised today against a real
broker member in both lanes), and `getBrokerDocumentUrlAction`. When M-81
lands it calls that action rather than writing a fifth copy of three lines.
The dispatcher page says so in words, because a dispatcher who assumes an
approved BOL is invisible to a partner org will file it under the wrong type.

### No document is public

§4 forbids the public tracking page four things by name — carrier rate
confirmations, insurance documents, shipper billing details, internal notes —
and §16 closes the question for everything else: *"do not put shipment
documents in public buckets."*

So the `public` column of the matrix is empty, and it is empty three ways: no
seeded row, a CHECK constraint refusing one
(`shipment_document_audiences_never_public`), and `documentTypesForAudience
("public")` returning `[]` under test. `/track` renders no document section at
all.

---

## §20's POD precondition — M-72's deferred requirement, completed

This is the module's headline, and it is the one thing M-72 explicitly
assigned here.

0019 shipped `shipment_transition_facts()` with `approved_pod_document_id` as
a **literal `null`**, and wrote the replacement SQL in the comment above it,
addressed to M-77 by name. 0024 uses that expression **verbatim**:

```sql
'approved_pod_document_id', (
  select d.id from shipment_documents d
  where d.shipment_id = s.id and d.doc_type = 'pod'
    and d.approved_at is not null
  order by d.approved_at desc limit 1
),
```

Not paraphrased, and deliberately **not** "improved" with an extra
`and d.status = 'approved'`: 0024's CHECK
(`(status = 'approved') = (approved_at is not null)`) makes those the same
condition, and restating it would leave a future reader wondering which is
authoritative. Every other key in the function is byte-identical to 0019's;
`closeout_completed_at` is still a literal null because closeout is still a
human assertion M-75's form supplies. **`transitions.ts` and
`apply-transition.ts` are not edited by this module at all** — which was the
promise 0019 made, and this is the proof it was kept.

### The regression to green

M-72 and M-75 each shipped an integration assertion stating that
`pod_uploaded` is refused *"because M-77 owns documents"*. Those assertions
were honest and are now obsolete. The walk they were placeholders for:

| Step | `approved_pod_document_id` | `pod_uploaded` |
|---|---|---|
| no POD at all | `null` | ❌ `precondition_failed` |
| POD uploaded, **pending** | `null` | ❌ — §16's "approved" is load-bearing |
| POD **rejected** | `null` | ❌ |
| an approved **BOL** (wrong type) | `null` | ❌ — a BOL is not a POD |
| POD **approved** | the document id | ✅ **succeeds** |
| POD **un-approved** afterwards | `null` again | ❌ |

The last row is why the CHECK matters: `review_shipment_document()` clears
`approved_by`/`approved_at` on any non-approval, so the fact tracks the
**current** decision rather than "was approved once".

Both older assertions were rewritten rather than deleted — same outcome, honest
reason (*"this shipment has no approved POD"*, *"a REQUEST is not an approved
POD"*), plus an explicit `expect(facts(id).approvedPodDocumentId).toBeNull()`
so the refusal is attributed to the fact and not to the plumbing.

The dispatcher board draws the button at the same moment: the page passes the
newest approved POD from the document list it already read into
`staffTransitionFacts`. That decides what is **offered**; the server action
re-resolves the real fact through the RPC before any write, so an approved POD
that fell off the bounded page costs an un-drawn button, never an accepted
transition with no proof behind it.

---

## Why a second private bucket, not a path inside `carrier-docs`

The plan asked for the decision to be argued.

`carrier-docs` (migration 0004) is authorized **by carrier**: both customer
policies read `(storage.foldername(name))[1]` and compare it to the caller's
`carriers.id`. Every object in that bucket belongs to exactly one carrier, and
that prefix **is** the authorization model — it is what stands between carrier
A and carrier B's W-9, SSN and bank details.

A shipment document has up to four legitimate readers, none of whom owns a
folder, and its readability depends on `doc_type`, `status` and `visibility` —
columns in a table a storage policy would have to join. Filing shipment
documents under `carrier-docs/shipments/…` forces one of two bad outcomes:
loosen 0004's carrier-prefix policies (weakening the highest-PII bucket in the
product to serve a lower-PII use case), or leave objects in a bucket whose
policies cannot express who may read them.

**`shipment-docs`** keeps 0004 frozen, lets the policies be written in the
matrix's own terms, and keeps the retention stories separable — a carrier's
compliance packet and a shipment's paperwork do not expire together.

It is `public: false`, 10 MB, four MIME types, and its **only** storage policy
is staff. Customers never touch `storage.objects`: a download resolves the row
under the caller's session (so 0024's policies decide), audits the access, and
mints the URL with the service role. A customer who somehow obtained a storage
path could not read the object with their own session even if RLS on
`shipment_documents` were misconfigured — two independent gates, not one.

---

## Uploads

### The pipeline, in order, and why that order

1. **size cap** — cheapest rejection, before the bytes are read twice;
2. **doc-type allow-list per ROLE** — before the file is read at all, so a
   carrier trying to file an invoice does not get to spend our memory on it;
3. **MAGIC BYTES** (`sniffMime`, M-21 / audit S-03) — the extension and the
   client-declared `Content-Type` are attacker input and are never consulted.
   A `.pdf` whose bytes begin `<?php` is rejected here, not by the bucket;
4. **randomized path** — `{shipment_id}/{uuid}-{sanitized}`. The prefix is
   enforced by a CHECK; the UUID is what makes the object unguessable to
   anyone who has ever held a signed URL for a different document;
5. **storage upload**, `upsert: false` — a path collision fails rather than
   silently overwriting a filed document;
6. **0024's `add_shipment_document()`** — row **and** `document_uploaded`
   event in one transaction.

Steps 5–6 are the one place a mess is possible (object uploaded, row failed).
It is handled explicitly: the object is removed and the failure reported. The
reverse order is not an option — a row pointing at an object that does not
exist yet is a download error, which §26 names as a tracked signal precisely
so this is visible if it ever happens.

### Who may upload what

| Role | Types | Why |
|---|---|---|
| **driver** (§13 token) | `bol`, `pod` | Exactly the two §13 names. The narrowest surface in the product does not also get the widest upload. |
| **carrier** (§13 portal) | `bol`, `pod`, `lumper_receipt`, `detention_documentation`, `delivery_receipt` | The two, plus the accessorial evidence only they can physically produce. |
| **staff** (§14/§15) | all eleven | Plus the option to hold any of them at `staff_only`. |
| **shipper / broker** | **none** | §16 gives neither party an upload right. Inventing one would put documents on a shipment our own review queue never asked for. |

A carrier can never file a `quote`, `shipper_confirmation`,
`rate_confirmation`, `invoice` or `claim` — those are ours to issue, and a
carrier who could file one could plant a document the shipper then reads as
ours. The rule exists in three places: separate Zod schemas per role (so a
carrier's request is never even *parsed* as valid), `canUpload()` in the store,
and the fact that `add_shipment_document()` is EXECUTE-granted to
`service_role` alone, so there is no hand-rolled insert path.

The **role is never a form field.** Four exported actions, four different
gates (`resolveCarrierShipmentAccess` · `redeemDriverToken` ·
`resolveShipmentAccess`), each handing a fixed `uploaderRole` to the store.

### Every upload emits an event

Through `append_shipment_event`'s table, inside 0024's function so the row and
the event are one transaction. A document with no `document_uploaded` event is
a file nobody can explain; an event with no document is a timeline entry that
lies.

The upload event is **`staff_only`**: an unreviewed document is not a
customer-facing fact, and publishing "your carrier uploaded a POD" before
anyone checked it invites the call this module exists to prevent. The
**approval** is the customer-facing event, published at the widest band the
matrix licenses for the type. A rejection stays `staff_only` — it is a
conversation with the uploader.

Event metadata carries `document_id`, `doc_type`, `file_name` and
`visibility`. **Never the storage path**: metadata is read by the staff
timeline and by M-79's notification payloads, and a path is the argument a
signed URL is minted from.

---

## Document-access history (§15) and signed URLs

Every mint goes through `recordAuditEvent` with
`action: "document.download"` — **the same action string, the same writer and
the same shape** `actions/admin.ts` and `actions/carrier.ts` have used since
M-61 / M-69 P-5. §15's *"view document-access history"* is therefore **one
query** over `audit_events`, not two, and the admin security log renders
shipment documents beside carrier documents with no special case. Uploads and
reviews are journalled too, as `shipment_document.upload` /
`shipment_document.review`.

**The URL itself is never logged, stored or put in a signal.** It is a live
bearer credential for up to `SIGNED_URL_TTL_SECONDS`. §26's never-log list
says so; `redactDetail` would drop it anyway; and a unit test strips comments
from `document-store.ts` and asserts `signed.signedUrl` appears **exactly
once**, in the return value.

TTL is the shared `SIGNED_URL_TTL_SECONDS` (300) from `@/lib/uploads`.
`tests/unit/security.test.ts`'s call-site scan now covers this file, and
`shipment-documents.test.ts` re-asserts it with an explicit **rejection of
numeric literals** plus a non-vacuity check proving the scan can fail.

In the browser the URL goes straight into `window.open` and is **never written
to state, never put in an `href`, never rendered** — so it cannot survive in
the DOM, a devtools snapshot or a screen share. The e2e suite asserts
`/storage/v1/object/sign`, `token=` and `shipment-docs` appear nowhere in the
document, flight payload included.

---

## DB changes

Migration **0024**, additive. 0001–0004 frozen; 0017–0023 untouched **as
files**, with the one deliberate exception argued above (0024 replaces
`shipment_transition_facts()`, which 0019 asked it to).

| Object | Notes |
|---|---|
| bucket `shipment-docs` | private, 10 MB, pdf/jpeg/png/heic |
| `shipment_document_audiences` | 22 rows; CHECKs forbidding `public` and `staff_only` cells; SELECT-only to `authenticated`, nothing to `anon` |
| `shipment_documents` | `ShipmentDocumentRow`'s columns; 4 CHECKs (approved-iff-status, reviewed-when-decided, size sane, path namespaced); `storage_path` unique |
| `idx_shipment_documents_shipment` | `(shipment_id, uploaded_at desc)` — every list read |
| `idx_shipment_documents_approved_pod` | partial, `(shipment_id, approved_at desc) where doc_type='pod' and approved_at is not null` — the §20 fact |
| `idx_shipment_documents_pending` | partial, the review queue and §11's tile |
| `guard_shipment_document_immutable` | `shipment_id`/`doc_type`/`storage_path`/`uploaded_by`/`uploaded_at` frozen after insert → PL409 |
| `guard_shipment_document_visibility` | the matrix, as a write constraint → PL422 |
| `shipment_document_reaches_audience()` | the one predicate, mirrored clause-for-clause in TypeScript |
| `add_shipment_document()` | row + event, idempotent on the storage path; `service_role` only |
| `review_shipment_document()` | the §16 approval step, `FOR UPDATE`, + its event; `service_role` only |
| `count_shipment_documents_awaiting_review()` | §11's ninth tile — **a count and nothing else**, scoped by `my_shipper_ids()` internally; `authenticated` |
| `shipment_transition_facts()` | **replaced** — §20's POD fact is real |
| 4 policies | staff (all) · shipper · carrier · broker (select) |
| privileges | `revoke all … from authenticated, anon` then `grant select to authenticated` — Supabase's default privileges hand new tables full DML, and a table grant is checked in addition to RLS |

### `ShipmentDocumentRow` gained four fields

M-70 defined the row with `approved_by`/`approved_at` and no status. That
cannot express §20 or §16:

- **`status`** (the **0001 `doc_status` enum**, reused — not a second
  three-value vocabulary; M-21's carrier documents and M-58's review queue
  already speak it) — `approved_at is null` cannot tell "not yet reviewed"
  from "reviewed and rejected", so a rejected POD would sit forever looking
  pending;
- **`review_note`** — a POD rejected with no reason is a carrier phone call;
- **`reviewed_by` / `reviewed_at`** — who last decided, including on a
  rejection, for §15's history.

`approved_by`/`approved_at` remain, set **only** on approval by the CHECK —
which is what makes 0019's `approved_at is not null` a faithful reading of the
current review state.

---

## Endpoints

No routes added. Eight server actions in
`src/app/actions/shipment-documents.ts`:

| Action | Gate | Audience |
|---|---|---|
| `carrierUploadDocumentAction` | `resolveCarrierShipmentAccess` (M-76) | — |
| `driverUploadDocumentAction` | public-form guard → `redeemDriverToken` (0023) | — |
| `staffUploadDocumentAction` | `resolveShipmentAccess` (M-75) | — |
| `reviewDocumentAction` | `resolveShipmentAccess` | — |
| `getShipperDocumentUrlAction` | session + `getMyShipperId` | `shipper` |
| `getCarrierDocumentUrlAction` | session | `carrier` |
| `getBrokerDocumentUrlAction` | session | `broker` (M-81 wires the surface) |
| `getStaffDocumentUrlAction` | `resolveStaffActor` | staff (matrix does not apply) |

Four download wrappers rather than one `download(id, audience)`, because an
audience that arrives in the request body is not an audience — it is a field,
and a shipper session could ask for the `carrier` band on a rate confirmation.

The driver upload runs the same order of operations as `driver-updates.ts`:
public-form guard (Upstash + Turnstile) → token shape → 0023's atomic redeem →
body. It carries the same `TurnstileWidget` as every other driver write; an
upload endpoint reachable without the guard would be the cheapest way to fill
our bucket.

## Env vars

**None new.** The bucket is created by the migration; the TTL is a constant;
uploads reuse `SUPABASE_SERVICE_ROLE_KEY`. Without it every write returns a
typed "not configured" refusal and nothing is stored — the same fail-closed
behaviour M-75/M-76 established.

---

## Deployment

1. Apply **0024** (`supabase db push`, or `psql -f`). It creates the bucket row
   in `storage.buckets` itself, so no console step is required on Supabase —
   **but see the runbook**: a self-hosted or CLI-less environment needs the
   bucket created manually with `public = false`.
2. Deploy the app in the **same** window. 0024 alone makes `pod_uploaded`
   reachable while no surface can upload a POD; the app alone calls functions
   that do not exist (and fails closed).
3. Smoke-test per the runbook.

Page count unchanged at **368** — this module adds components and actions to
existing routes, not routes.

### Rollback

Full statement lives in 0024's header. The **order matters**:

1. **Re-run 0019's `shipment_transition_facts()` block first.** It has the
   literal `null`. Doing this before dropping the table is what stops every
   transition failing on a missing relation.
2. Drop the policies, then the functions, then the triggers, then the two
   tables.
3. `delete from storage.buckets where id = 'shipment-docs'` — only if empty.

**Destructive.** It drops every BOL and POD filed against a shipment, and with
them the evidence a delivery happened. `pg_dump -t shipment_documents` first.
The **objects survive** in the bucket; the rows naming them do not, so they
become unreachable rather than deleted — emptying the bucket is a separate,
deliberate act.

It fails **closed** either way: with the table gone,
`shipment_transition_facts()` restored to 0019's literal null again refuses
every `pod_uploaded`, which is M-72's documented behaviour and not a new
failure mode. Shipments, events, assignments, driver tokens and `carrier-docs`
are untouched. Roll back `src/lib/shipments/document*.ts`, the actions, the
two components and the four surface edits in the same deploy.

---

## Tests

| Suite | Count | Was | New in M-77 |
|---|---|---|---|
| `npm test` | **1061** | 966 | +95 |
| `npm run test:rls` | **502** | 447 | +55 |
| `npm run test:integration` | **194** | 157 | +37 |
| `npx playwright test` | **240** | 229 | +11 |

### Unit (90 in `shipment-documents.test.ts`, plus edits elsewhere)

The centrepiece is a **table-driven walk of every document type × every
audience** — 44 customer cells, each a named test carrying the §16 or §12
sentence it comes from. The expectations are transcribed **from the
directive**, not from `documents.ts`: a test that imported the matrix and
compared it to itself would pass for any matrix. Plus: the 11×4 coverage
guard (no gap, no duplicate), the `staff_only`-is-a-floor rule, §4's four
named prohibitions, the non-nesting of bands, the two narrowing clauses over
all four audiences, the DTO key-set with a **non-vacuity check asserting the
same assertion fails against a widened object**, a structural guard forbidding
`...row` / `delete ` / `omit(` / `: any` in `documents.ts`, the four upload
allow-lists, the bucket's privateness read out of the migration text, the
proof that 0024 mentions `carrier-docs` nowhere, path randomisation, magic-byte
sniffing (PDF/JPEG/PNG/HEIC accepted; PHP, HTML, SVG, ZIP, plain text,
truncated headers and a decoy PDF signature at offset 4 all refused), the TTL
constant + call-site scan + its non-vacuity control, §25's clamp, and §24's
five catalogues (identical key sets, non-empty per type, and the four
non-English ones actually differing from English).

### Integration (37) — the lane that proves what no other can

- **TS matrix ↔ SQL matrix**, cell for cell, plus the two predicates asked the
  same 55 questions.
- **§27 · document upload** — row + event atomically, the `staff_only` upload
  band, matrix defaults, the visibility trigger refusing `rate_confirmation`
  as `shipper` and every type as `public`, narrowing accepted, the path-prefix
  CHECK, idempotent replay, the immutability trigger (three columns → PL409,
  and `review_note` still writable), PL404 on a missing shipment.
- **§27 · POD upload → §20** — the six-row table above, in order.
- **§19** — carrier A reads **nothing** of carrier B's documents, with the
  mirror in both directions; shipper A reads BOL/POD/invoice and **not** the
  rate confirmation; shipper B reads nothing of A; the broker band reads
  exactly BOL and POD; a **de-activated** broker org reads nothing and reading
  resumes on re-activation; anon reads nothing; an unapproved document is
  invisible to all three customer bands until approved.
- The DTO filter and the policy asked the same question, with the carrier
  count proving the comparison is not a tautology.

### RLS (+55)

Eight documents on two shipments, **one per matrix outcome**, so every count
is a statement about a band list rather than about an empty table: shipper A
sees exactly 3 of 8, carrier A exactly 3 (including its own rate
confirmation), broker A exactly 2, a carrier **member** the same 3 as the
owner, staff all 8. Plus the matrix table's privileges, the seven schema
refusals asserted as the table **owner** (where only a trigger or CHECK can
refuse), a non-vacuity control proving a legal insert succeeds, the two write
functions unreachable from an **admin** session (42501), the tile function
reachable and correctly scoped, and §20's fact resolved from the fixtures.

### E2E (11) + axe + responsive

Honest about the lane: `next start` on placeholder credentials cannot mint a
session, so three of the four surfaces can only reach the login bounce — which
is asserted, in five locales, for all three. What **is** proved in a real
browser: the unauthenticated driver surface renders §30's expired-link state
and no document list, no signed-URL shape appears anywhere in the document,
document surfaces are absent from the sitemap and disallowed in robots, axe
finds zero WCAG A/AA violations, and there is no horizontal overflow at
**320 / 390 / 768 / 1440**.

The a11y unit suites (`shipper-shipments-a11y`, `carrier-driver-a11y`,
`dispatcher-shipments-a11y`) axe-scan the real components with real document
fixtures, which is where the authenticated surfaces are actually covered.

### Non-vacuity by injection

Each of these was applied, observed to fail the suite, and removed:

| Injected defect | Caught by |
|---|---|
| dropped `status !== "approved"` from `documentReachesAudience` | **6** unit tests |
| widened `rate_confirmation` to `shipper` in the **TS** matrix | **3** unit + **2** integration (the cell-for-cell comparison and the two-predicate agreement) |
| added `('rate_confirmation','shipper')` to the **SQL** matrix seed | the RLS suite (*"reaches the CARRIER and nobody else"*) **and 4** integration tests, including the shipper's real read |
| removed `and d.approved_at is not null` from 0024's POD fact | **4** integration tests — pending, rejected, wrong-type and un-approved all started passing |
| replaced `SIGNED_URL_TTL_SECONDS` with `86400` | **both** TTL call-site scans (`security.test.ts` and `shipment-documents.test.ts`) |
| let `visibility` widen (early `return new` in the trigger) | the RLS suite **and 2** integration refusals — a rate confirmation filed as `shipper` was accepted |
| added `storage_path` to `CustomerDocumentDto` | the key-set equality test **and** the structural guard |

Two of them are also standing tests in their own right: the key-set assertion
is re-run against a deliberately widened object and asserted to **throw**, and
the TTL scan is re-run against a literal and asserted to **match**.

### One defect the gate runs surfaced (not in M-77's code)

M-76's `tests/unit/shipment-driver-token.test.ts` asserts that no token
contains any fragment **≥ 4 characters** of a shipment id, carrier id or
tracking number, over 1000 mints. Four hex characters in a 43-character random
string collide by chance at roughly 2.4e-5 per token per fragment; with ten
such fragments the suite failed about **one run in five**. That is a flaky
gate, not a security signal.

The floor was raised to **6 characters** (~1e-4 over the whole loop) and the
full identifiers were added explicitly, so the property the test means to
assert — *the token is not DERIVED from an identifier* — is unchanged and the
only thing dropped is the coincidence rate. The reasoning is written into the
test. Five consecutive runs green.

### Honest limitations

- The **file itself** is never read back in any lane: no lane has object
  storage. What is proved is that a path is randomized and namespaced, that a
  row cannot be re-pointed at a different object, and that the URL is minted
  with the shared TTL and never logged. Whether Supabase Storage honours a
  300-second expiry is Supabase's contract, not ours to assert.
- **Magic-byte sniffing is proved on synthetic headers.** A polyglot file that
  is a valid PDF *and* a valid HTML document would pass — the mitigation for
  that is the private bucket and the signed-URL `Content-Disposition`, not the
  sniffer, and it is named here rather than implied.
- The **broker surface** does not exist (M-81). The band, the policy and the
  action do, and both database lanes exercise them against a real broker
  member — but no human can click anything as a broker today.
- **Dispatcher scoping stays query-level** (`staff-scope.ts`), as M-71 and
  M-75 both recorded. 0024's staff policy is `is_staff()`, the existing idiom.
  M-83 owns restrictive policies.

---

## Files

**New:** `supabase/migrations/0024_shipment_documents.sql` ·
`src/lib/shipments/documents.ts` · `src/lib/shipments/document-store.ts` ·
`src/lib/validation/shipment-documents.ts` ·
`src/app/actions/shipment-documents.ts` ·
`src/components/portal/ShipmentDocuments.tsx` ·
`src/components/portal/ShipmentDocumentReview.tsx` ·
`tests/unit/shipment-documents.test.ts` ·
`tests/integration/shipment-documents.test.ts` ·
`tests/e2e/shipment-documents.spec.ts` · this doc.

**Changed:** `src/lib/shipments/types.ts` · `src/lib/shipments/staff-detail.ts`
· `src/lib/shipments/shipper-tiles.ts` · `src/lib/shipments/carrier-updates.ts`
· `src/lib/supabase/database.types.ts` ·
`src/components/portal/ShipmentDetailView.tsx` ·
`src/components/portal/CarrierShipmentDetailView.tsx` ·
`src/components/portal/ShipmentStaffDetailView.tsx` ·
`src/components/portal/ShipperTiles.tsx` ·
`src/components/driver/DriverUpdateView.tsx` · the three shipment detail pages
· `messages/{en,es,fr,ht,ru}.json` · `supabase/tests/10_fixtures.sql` ·
`supabase/tests/20_rls_isolation.sql` · `tests/unit/security.test.ts` ·
`tests/unit/stubs/recording-supabase.ts` ·
`tests/integration/helpers/psql-rls-supabase.ts` · four existing test files
whose M-77-deferral assertions became obsolete · `docs/modules/INDEX.md` ·
`docs/LAUNCH-RUNBOOK.md`.

---

## Extension points

- **M-78** (exceptions) can attach `detention_documentation` to an exception
  row; the type and its two-party audience already exist.
- **M-79** (notifications) has a customer-facing hook in the
  `document_approved` event at the shipper band. Its payload must carry the
  document **id**, never the storage path.
- **M-81** (broker portal) calls `getBrokerDocumentUrlAction` and
  `listShipmentDocuments(supabase, id, "broker")`. The policy and the matrix
  are done; only the page is missing.
- **M-83** replaces the query-level dispatcher scope with restrictive
  policies; 0024's staff policy is the same `is_staff()` idiom every other
  table uses and will move with them.
- **M-84b** maps `document_download_error` to a Sentry fingerprint. The signal
  is already raised on every failure path in `document-store.ts`.
- **A new document type** is a migration (a row in
  `shipment_document_audiences`) **plus** a compile error in
  `DOCUMENT_AUDIENCES` and `DEFAULT_DOCUMENT_VISIBILITY` until its audience is
  stated, **plus** a new cell in the unit suite's `MATRIX` table. Three places,
  deliberately — the point is that adding a type without deciding who sees it
  is impossible.
- **Retention** (§9/§15, M-84b's purger) has an obvious hook: `uploaded_at`
  plus a policy per `doc_type`. Nothing here assumes documents live forever;
  nothing here deletes them either.
