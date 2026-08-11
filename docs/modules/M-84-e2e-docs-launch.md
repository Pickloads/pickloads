# M-84 — E2E flows, documentation and launch updates

**Phase:** C (tracking completion) · **Plan:** `docs/FINAL-IMPLEMENTATION-PLAN.md`
§7 · **Directive:** `docs/DIRECTIVE-tracking.md` §§27, 29, 30, 31
**Migration:** none · **Baseline:** M-83 (`6dc5e34`)

---

## 1. What this module is

The plan's scope line:

> **M-84** — E2E (4 named flows + security flow), documentation (18 named
> docs), runbook (env, migrations, tracking config, map config, notification
> setup, smoke tests, go-live, rollback), §31 acceptance walk with honest
> live-env caveats.

Four deliverables, and one of them turned into a defect hunt.

---

## 2. §27's flows — composed, not just covered

By M-83 every §27 *operation* had a test. What no lane proved was the thing
§27 actually names: that the flows **compose**. Two claims are only makeable
in a file that walks them, and both have failed in real systems:

**The shipper flow is a sequence.** §27 writes it as login → view shipments →
open shipment → view timeline → download POD → submit support message. Each
step consumes the previous step's output. A system can pass six isolated tests
and break at a seam — a list projection that omits the id the detail route
needs; a document the detail page renders but the download gate refuses.
`tests/integration/tracking-flows.test.ts` carries the id, the document and
the thread id forward between `it` blocks, so a broken seam fails.

**The six security refusals must hold simultaneously.** Every existing
isolation test seeds its own world, which is the right way to prove a policy
and the wrong way to prove a system. A shipment that is *at once* delivered,
PODded, publicly trackable, carrier-assigned and driver-tokenised is where a
policy written for one state leaks in another. All six §27 refusals are
asserted against the **same** row, in its final state, after a full lifecycle
walked through the real engine and the real RPCs.

The sharpest assertion in the file: the shipper reaches their own **approved
POD** and is refused the **rate confirmation** — same shipment, same session,
same function call. A gate that checked only the shipment would hand over the
document from which the margin is one subtraction away.

Two smaller things it proves that nothing else did:

- The §15 document-access journal **exists** and does **not** carry the signed
  URL. The storage signer is stubbed to return a URL containing
  `SIGNED-CREDENTIAL-SENTINEL`, which turns an unavoidable adaptation into an
  assertion.
- The public ledger never stores the attempted second factor — swept over the
  whole row rendered as JSON, with the tracking number (which the ledger *is*
  supposed to keep) as the control proving the sweep looks.

`tests/e2e/tracking-flows.spec.ts` adds the browser-observable skeleton: every
route each flow traverses exists in the built app, and each has the **right**
gate (public / session / bearer). Route existence is a build-time fact and
this is the only lane that observes the build.

**Integration: 354 → 369. E2E: 360 → 371.**

---

## 3. §27 traceability, machine-checked

`tests/support/section-27-catalogue.ts` maps every requirement §27 names — 8
unit tests, 11 integration tests, 5 flows totalling 31 steps, 6 responsive
surfaces × 5 viewports — to a specific file and a specific test title.
`tests/unit/section-27-coverage.test.ts` proves the bindings resolve.

Three properties, in increasing order of what they buy:

1. **Shape** — dropping a requirement fails. That is the failure a
   hand-maintained table makes impossible to notice.
2. **Resolution** — a renamed or deleted test fails with the requirement it
   was covering named in the message. Verified adversarially: tampering with
   one title produced exactly one failure, named `Dispatcher flow · Mark
   delivered`.
3. **Non-vacuity of the checker** — the extractor is proved to reject a title
   that does not exist, a file that does not exist, and a title that appears
   in the file only as prose. The last one matters: these suites quote their
   own test names in their header comments, so a substring search would report
   coverage for a deleted test.

`caveat` fields carry the honest differences — where a proof is narrower than
the directive's sentence, the difference is written down. Six entries have
one. An index whose every entry claimed perfect coverage would be the more
comfortable artefact and the less honest one.

---

## 4. §29's eighteen documents

`docs/tracking/` — architecture · status model · event visibility ·
tracking-number rules · public tracking security · shipper portal · carrier
workflow · dispatcher workflow · document permissions · notifications · ETA ·
provider adapters · RLS · migrations · responsive · testing · launch ·
troubleshooting, plus an index.

They are written for the person who has to operate or repair the system, not
the person who built it, and they record the defects that shaped each design
— the DST bug in `operatingDayBounds`, the `invoices.carrier_id NOT NULL` that
would have leaked the margin, the driver-token decoy that hashed `""`, the
permissive-policy OR that emptied the anonymous blog, the six modules of axe
scans that ran with no stylesheet attached. A document that only describes the
happy path teaches nothing.

`tests/unit/section-29-docs.test.ts` asserts each exists, opens with its named
H1, exceeds a length floor (a stub in an index of eighteen reads exactly like
a document until somebody opens it) and is linked from the index. It does not
read the prose — no test can tell you the words are still true — and says so.

`docs/LAUNCH-RUNBOOK.md` gained **§9d**, covering all eight topics §29 names.

---

## 5. §31 acceptance walk

`docs/TRACKING-ACCEPTANCE.md` walks all nineteen criteria: **18 MET**, **1 MET
(live-env)** — criterion 10's bucket privacy is a Supabase configuration fact
a repository cannot assert. Nothing is unmet. Two criteria carry honest
caveats (locale coverage; no screen-reader testing) and seven open items are
listed by name.

---

## 6. Defects found and fixed

### D-1 · §30 "live tracking" — nine live violations, five locales

§30 forbids claiming *"live tracking"* when the system has only manual
updates. M-73 filed it. Ten modules later the claim was still shipping in
**nine** places: `/shippers` (the feature heading, the hero, the page
metadata), the JSON-LD service description, the home-page teaser, the process
diagram node, a services list, the shipper portal's empty state, and an FAQ
answer — each in five languages.

All are now §30's approved wording (*"Milestone tracking"*, *"Milestone
updates"*, *"your dispatcher posts status updates here"*).

`tests/unit/section-30-honest-labels.test.ts` is the standing guard, and
writing it produced two lessons worth keeping:

- **The first version passed while three locales were still violating.** It
  matched "seguimiento en vivo", "отслеживание в реальном времени" and "swiv
  an dirèk" — and missed "rastreo en vivo", "живым отслеживанием" and "swivi
  an dirèk". A guard that matches only the phrasing you thought of reports
  success.
- **`\w` does not match Cyrillic in JavaScript.** The Russian patterns matched
  *nothing at all* until the ranges were made explicit — the most expensive
  kind of passing test. The non-vacuity block, which asserts the patterns
  catch the sentences that actually shipped, is what caught it.

The guard is deliberately narrow: "24/7 live support", "Live dispatch
support", "document uploads aren't live yet" and "once our brokerage division
is live" are honest and are asserted **not** to be flagged. A guard that
banned the word would be switched off within a month, and then it would guard
nothing. §30's own approved label *"Live location available"* is exempted by
**key**, with a separate test pinning that key's English value verbatim so the
exemption cannot be widened by editing the value.

### D-2 · `/track` was blank with scripting disabled

`TrackingLookup` reads `?number=` through `useSearchParams`, so Next.js
renders it on the client even on this statically prerendered route. That is
the right trade for §25 (the cacheable shell holds no shipment), and its
consequence was never stated: with scripting off, the one public tracking
entry point rendered an **empty panel under a heading promising a lookup**.

A blank form under that heading is a false statement made by omission. M-84
adds a server-rendered `<noscript>` block — present in the static HTML whether
or not the bundle runs — that says tracking needs JavaScript and gives the
dispatch number, in all five locales. The e2e test asserts the premise (the
form genuinely is absent from the static HTML), the fallback, and that the
form *is* there with scripting on.

### D-3 · §30's honest labels were untranslated in `ru` and `ht`

All six of §30's approved labels, plus the two supporting ones, carried the
English text in Russian and Haitian Creole. Fixed, and
`section-30-honest-labels.test.ts` now asserts all six are translated in every
authored locale.

### D-4 · A dead dictionary key carrying the forbidden claim

`v4.full_truckload_..._x` is a collision-disambiguated duplicate that
`slugifyV4` can never produce, so it was unreachable — and still carried "live
tracking" in four languages. Corrected rather than left as a landmine.

### D-5 · The integration adapter silently failed every jsonb write

`helpers/psql-supabase.ts` encoded object values as `String(value)`, producing
`[object Object]`, which PostgreSQL rejects for a `jsonb` column. Nothing had
noticed because no integration test had written through one. The §27 shipper
flow's POD download does: `recordAuditEvent` puts the document's `detail`
object into `audit_events.detail`, and §15's requirement is precisely that the
row **exists** and does **not** carry the signed URL. A silently failing insert
would have made that assertion vacuous in the friendliest possible way —
green, and proving nothing.

---

## 7. The finding this module could not fix

**O-1 — the tracking system is untranslated in two of its five locales.**

The §30 sweep turned over a much larger stone:

| Namespace | Strings | `es` | `fr` | `ru` | `ht` |
|---|---|---|---|---|---|
| `shipment.*` | 411 | 2 | 7 | **363** | **363** |
| `v4.*` | 750 | 14 | 27 | **423** | **429** |

Russian and Haitian Creole customers read the public `/track` page, the
shipper portal, the driver page and every notification body in English.

This is a real §24 defect and it is not one a test can fix. Translating 726
strings is a translation project with a review step, not a code change, and
doing it unreviewed in a logistics and legal context ships something worse
than an honest gap.

So M-84 does the two things that *are* available.
`tests/unit/i18n-coverage-ratchet.test.ts` **measures** it — the figure prints
in every unit run — and **ratchets** it: coverage may improve and cannot
regress, so adding a new English-only string fails the build while the gap
waits for a translator. It is recorded in the acceptance document's open items
and here. Nothing pretends it is closed.

---

## 8. Database changes

None. M-84 adds no migration.

---

## 9. API endpoints

None added. `/track`'s server action, the portal actions and the cron routes
are unchanged.

---

## 10. Environment variables

None added. `docs/tracking/launch.md` §1 and runbook §9d.1 now document the
twelve that the tracking system depends on, each with what happens when it is
unset — because "it silently did nothing" is the failure mode an operator
needs to be able to recognise.

---

## 11. Files changed

**Added**

```
tests/integration/tracking-flows.test.ts        §27's shipper + security flows, composed
tests/e2e/tracking-flows.spec.ts                the five flows as routes and gates
tests/support/section-27-catalogue.ts           §27 as data
tests/unit/section-27-coverage.test.ts          the index, verified
tests/unit/section-29-docs.test.ts              the eighteen documents, verified
tests/unit/section-30-honest-labels.test.ts     the honest-label guard
tests/unit/i18n-coverage-ratchet.test.ts        the locale gap, measured and pinned
docs/tracking/README.md + 18 documents          §29
docs/TRACKING-ACCEPTANCE.md                     §31's nineteen criteria
docs/modules/M-84-e2e-docs-launch.md            this file
```

**Modified**

```
src/app/[locale]/(site)/track/page.tsx          the <noscript> fallback (D-2)
src/app/[locale]/(site)/shippers/page.tsx       §30 wording ×4 (D-1)
src/components/sections/ShippersTeaser.tsx      §30 wording (D-1)
src/components/sections/ServicesSplit.tsx       §30 wording (D-1)
src/app/[locale]/portal/shipper/page.tsx        §30 wording (D-1)
src/lib/jsonld.ts                               §30 wording (D-1)
src/content/faq.ts                              a stale "on the roadmap" claim
messages/{en,es,fr,ru,ht}.json                  §30 wording, the noscript string,
                                                the eight §30 labels for ru/ht (D-3)
tests/integration/helpers/psql-supabase.ts      jsonb encoding + audit_events (D-5)
tests/unit/shipment-notifications.test.tsx      ru/ht are now authored (D-3)
docs/LAUNCH-RUNBOOK.md                          §9d, the tracking chapter
```

---

## 12. Gate

```
npm run typecheck   clean
npm run lint        clean
npm run build       388 pages
npm test            1594 unit
npm run test:rls      806 assertions
npm run test:integration  369
npx playwright test   371
```

Totals before M-84: 1488 · 806 · 354 · 360.

---

## 13. Rollback

No migration, so nothing to reverse in the database.

- **The tests and documents** are additive; deleting the new files restores
  the previous state exactly.
- **The `<noscript>` block** is one JSX element plus one message key in five
  catalogues. Removing it returns `/track` to rendering an empty panel with
  scripting off — which is why it should not be removed.
- **The §30 wording** is a content change across six source files and five
  catalogues. Reverting it reintroduces a claim the directive forbids and the
  guard test will fail, loudly, which is the intended coupling.
- **The adapter's jsonb encoding (D-5)** affects the test lane only.

---

## 14. Extension points

- **A new §27 requirement** (if the directive is revised): add it to
  `tests/support/section-27-catalogue.ts` and the shape test will demand a
  binding.
- **A nineteenth document**: add it to `SECTION_29_DOCUMENTS` and to the
  index. Both are checked.
- **A new honest-label rule**: add a pattern to `FORBIDDEN` **and** a real
  sentence to the non-vacuity list. A pattern without a proof that it matches
  something is how the Cyrillic bug survived its first review.
- **Translations**: lower the baselines in `i18n-coverage-ratchet.test.ts` in
  the same commit, and say so in the message. Never raise one.
