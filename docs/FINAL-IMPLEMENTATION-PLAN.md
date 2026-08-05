# PickLoads — Final Implementation Plan

**Scope:** Tracking Directive (`docs/DIRECTIVE-tracking.md`, §1–31) + Business Website Directive (`docs/DIRECTIVE-business-website.md`, §32 A–V)
**Baseline:** commit `341819f` — M-00…M-62 complete, 337 pages, 168 unit + 165 RLS + 145 e2e green
**Status:** PLAN ONLY. No code written. Supersedes `docs/EXTENSION-AUDIT.md` where they differ.
**Date:** 2026-08-05

---

## 0. How this plan was produced

`docs/EXTENSION-AUDIT.md` (commit `c016320`) was reviewed adversarially against both specifications — every numbered section 1–31 of the tracking directive and every lettered item A–V of the website directive — by two independent passes tasked with finding omissions, weakenings and factual errors rather than confirming the work. Their findings were then verified directly against the codebase.

**Verdict: the audit was directionally correct but incomplete.** Its architectural analysis holds (§1 below). Its coverage did not: one entire mandated test tier was diagnosed as missing and then silently dropped, an observability requirement rested on a false premise, seven requirements were downgraded without saying so, and six claims about existing code were wrong — four of them describing safety mechanisms that do not actually exist.

This plan restores every omission, states every deferral explicitly as a decision, and adds a prerequisite module for the live defects the review uncovered.

---

## 1. The architectural decision (confirmed)

**Create a new `shipments` table. Do not extend `loads`.** The audit's reasoning survives review and is verified against the schema:

`loads` is carrier-centric dispatch work — `carrier_id NOT NULL` (0001), a `compute_load_fee` BEFORE-INSERT trigger reading `carriers.dispatch_fee_pct`, a `loads_fee_pct_applied_present` CHECK, and a 6-value enum ending in billing states. The directive's shipment is shipper-centric brokerage work whose first four statuses (`quote_requested` → `carrier_search`) have **no carrier at all**.

Extending `loads` would require dropping a NOT NULL, rewriting the F-03 fee trigger that three modules depend on, and adding 12 enum values that break every exhaustive `Record<LoadStatus, …>` in the codebase. A new table is purely additive, touches zero existing rows, and — decisively — makes the pre-MC legal boundary **structural** rather than a column value: dispatch loads and brokerage shipments cannot be confused by a query mistake.

`loads` remains the system of record for dispatch. `shipments` becomes the system of record for brokerage. A nullable `shipments.load_id` links them when a brokered shipment is covered by a dispatched truck.

---

## 2. Corrections to the audit (verified against code)

These are stated so the plan is not built on false premises.

| # | Audit claimed | Verified reality | Consequence for the plan |
|---|---|---|---|
| C-1 | `audit_events` has a "single writer `src/lib/audit.ts`" | **False.** 4 action files write directly (`staff.ts` ×5, `carrier-portal.ts` ×2, `account.tsx` ×2, `quotes.ts` ×1) | The no-secrets/IP-capture contract is **not** centrally enforced. M-69 fixes before M-72 builds on it |
| C-2 | `document.download` is audited | **False on the carrier path.** Only `actions/admin.ts` audits; `actions/carrier.ts` mints signed URLs with no event | §15 "document-access history" baseline overstated; M-69 closes |
| C-3 | `packet_downloads_live` gates the carrier packet | **Dead config.** Only a *comment* in `Packet.tsx:9`; the 4 links are hardcoded `href="#"` | A Downloads Center built on this premise ships a non-gating gate. M-69 wires it |
| C-4 | `testimonials_visible` gates testimonials | **Dead config.** Zero reads in `src/` | §32 B's "keep it behind the existing flag" requires wiring the flag for the first time |
| C-5 | Sentry is existing infrastructure to reuse | **DSN in `.env.example` only**; logging is `console` | §26 has no foundation. Observability becomes real scope, not reuse |
| C-6 | Shipper portal has "8 of 8 directive routes bar 2" | 6 of 8 | Minor; corrected in module scoping |
| C-7 | `email_log` has "no per-attempt provider response" | Overstated — `provider_message_id`/`status`/`error` exist since 0001 | The real gap is idempotency + retry, not provider response |

**Confirmed true and material:** the newsletter has no unsubscribe route while `NewsletterConfirmationEmail.tsx:94` promises "unsubscribe anytime" (CAN-SPAM exposure); `formatRpm` divides by loaded miles only while labelled "RPM" (the skill defines true RPM over deadhead + loaded, and no `deadhead_miles` column exists); `bol_path`/`pod_path`/`rate_con_path` exist on `loads` with **zero writers** in `src/`.

---

## 3. Live production defects found during review (fix first)

These are in the shipped product today, independent of both directives. Three carry legal or trust exposure.

| ID | Defect | Exposure | Fix |
|---|---|---|---|
| **P-1** | Newsletter has no unsubscribe route; the confirmation email promises one | **CAN-SPAM violation on the first marketing send** | Tokenized `/newsletter/unsubscribe` route + one-click List-Unsubscribe header |
| **P-2** | `CtaBand.tsx:12` promises "Refer a carrier who signs up → earn a referral bonus" — rendered on home, every blog post, 8 equipment pages, 7 state pages, ×5 locales | **Live unfulfillable promise.** No referral program exists | Decision **D-1**: remove the line, or build §32 J now |
| **P-3** | `Footer.tsx:54` labels `/shippers` "Freight Brokerage" sitewide while `brokerage_active = false` | Same honest-states standard the audit enforces elsewhere | Gate the label on `brokerage_active`, or relabel to "For Shippers" |
| **P-4** | 4 action files bypass the `audit_events` writer | Audit trail integrity not centrally enforceable | Route all writes through `src/lib/audit.ts`; lint rule forbidding direct inserts |
| **P-5** | Carrier document downloads mint signed URLs unaudited | §15 document-access history is a partial truth | Add the audit event to `actions/carrier.ts` |
| **P-6** | `packet_downloads_live` and `testimonials_visible` are dead config | Two switchboard keys the runbook tells you to flip do nothing | Wire both to their components |
| **P-7** | `formatRpm` mislabels loaded-mile rate as RPM | Operationally misleading on the dispatcher board | Rename to "Loaded RPM"; add `deadhead_miles` when true RPM is wanted |

→ **Module M-69 — Production Integrity Pack.** Small, cheap, ships before any new feature. Nothing in M-70+ depends on defective foundations.

---

## 4. Restored requirements (omitted or weakened in the audit)

Every item below was in a specification and missing or downgraded in the audit. Each is now assigned to a module.

### Tracking directive

| Spec | Requirement | Audit status | Restored to |
|---|---|---|---|
| §27 | **Integration test tier** — 11 named tests (create shipment, assign carrier, create event, update status, public lookup, portal lookup, carrier update, doc upload, POD upload, notification generation, exception lifecycle) | Diagnosed absent, then dropped entirely | **M-83b** (new) |
| §26 | Observability — 9 tracked signals; "never log" list | No module owned it; premise false (C-5) | **M-84b** (new) |
| §19 | RLS proof: *dispatcher permissions are limited* | 6 of 7 proofs scoped; the one the architecture can't currently pass was dropped | **M-83** + honest note that dispatcher scoping is app-level (`staff-scope.ts`), so the proof is a query-level test until restrictive policies land |
| §25 | "never cache private shipment data publicly"; event-timeline pagination; summary-vs-history split; no N+1; background notification processing | 6 of 11 unaddressed | **M-74/M-79/M-82** |
| §24 + §17 | Workflow for operator-typed free text (`public_message`, `delay_reason_public`, exception descriptions) on a 5-locale page | Never defined | **M-73** — decision **D-6** |
| §16 | Document visibility **matrix** (which doc type → which audience) + a broker value in `doc_visibility` | Enum defined, mapping never stated; no broker value → §12 "BOL when authorized" unimplementable | **M-77** |
| §5 | Tracking number **immutable after creation**; admin correction flow; searchable by admin/dispatcher | A SQL comment only | **M-71** (update-blocking trigger) + **M-75** (search) |
| §8 | Public support-message button on `/track` | Only authenticated threads scoped | **M-73** — needs rate limit + Turnstile + abuse plan |
| §9 | Mode B per-shipment `tracking_url`; Mode C vehicle speed + raw provider metadata; **location-history retention executor** | Fields partially modelled; retention was a policy with no purger | **M-80** + retention cron in **M-84** |
| §6 | Appointment-rescheduled history | Appointments modelled as plain columns | **M-72** (event-sourced) |
| §14 | Dispatcher "record call / record email" | Absent from M-75 | **M-75** |
| §20 | Preconditions for `picked_up`/`delivered`/`completed`; the impossible-transition list | Never enumerated | **M-72** |
| §22 | 12 breakpoints (audit reused the existing 7) | Unstated downgrade | **M-82** |
| §29 | 18 named documents + runbook map/notification/smoke-test/go-live entries | Not itemised | **M-84** |
| §30 | Six honest labels + "not AI-powered" rule — and these are ×5 i18n strings | Never quoted | **M-73** |
| §31 | 19 acceptance criteria | Deferred to M-84 by design — acceptable, but the plan must state plainly that several are unmeetable until `brokerage_active` | **M-84** |

### Business website directive

| Spec | Requirement | Audit status | Restored to |
|---|---|---|---|
| A | **Request a Quote page** (A names 15 pages; the audit's missing list named 6 and omitted this one — the quote exists as a home anchor and a portal form, not a page) | Missed | **M-85** |
| C | The **seven named dimensions** (performance score, communication, professionalism, on-time, document quality, POD speed, reliability) | Audit said "the 9 named metrics" without enumerating, then instructed M-88 to implement the *skill's five dispatch metrics* verbatim — **zero overlap** | **M-88** — decision **D-4** |
| C | "Never expose internal carrier ratings publicly" | One clause, no RLS/DTO/test (contrast §10.2's rigour for margins) | **M-88** — DTO allow-list + key-set test, same pattern as financial fields |
| S | Audit-log categories: **portal actions**, shipment changes (of the six named) | One unenumerated clause | **M-97** |
| G | Blog "categories" claimed as built — `posts.category` is a bare text column, rendered only; no index, filter or route | Overstated | **M-91** |
| T | FAQ as the 7th searchable entity — it's a static TS array, unreachable by `tsvector`/`pg_trgm` | Unaddressed | **M-98** |
| B | Rating field absent from the build list | Missed | **M-87** |
| V | "Offline shell must never expose stale or sensitive shipment data" | Named but not designed | **M-99** |

---

## 5. Regression risks (must not break what exists)

The website directive's FINAL REQUIREMENT forbids removing or duplicating existing modules. Four collisions were found:

- **R-1 — Support Center vs M-55/M-56.** `support_threads.profile_id` is `NOT NULL references profiles(id)` (0007:12), so a **guest ticket cannot exist**. §32 D's ticket history for non-authenticated users forces either an ALTER on shipped 0007 or a parallel table — the duplication the spec forbids. → Decision **D-5**. Also `contact_messages` has **no read surface at all** (insert-only); the audit listed it as existing foundation.
- **R-2 — Knowledge Base vs Blog.** `kb_articles` was proposed as a new table with a new editor without asking whether it's `posts` + a `kind` discriminator — precisely the test the audit applied rigorously to loads-vs-shipments and skipped here. → Decision **D-7**.
- **R-3 — Downloads Center vs Carrier Packet.** Built on `packet_downloads_live`, which is dead config (C-3). Must wire the flag first (M-69) or the new centre inherits a fake gate.
- **R-4 — Global search vs admin surfaces.** No real collision: admin uses enum/status dropdowns, the only `ilike` in the repo is `shipper-quotes.ts:64`. The audit overstated existing search. Low risk; noted so M-98 isn't scoped as a migration of something that isn't there.

**Non-risks, verified:** the tracking work is additive (new tables, new routes); `loads` and its three modules are untouched; existing RLS policies are not modified (new policies on new tables only); migrations 0001–0004 remain frozen; the 145 e2e and 165 RLS assertions continue to run unchanged.

---

## 6. Decisions requiring your approval

Nine, each with a recommended default. Seven were surfaced or reframed by the review.

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D-1** | The live referral promise (P-2) | (a) Remove the line now, build §32 J later · (b) Build the referral program now · (c) Leave it | **(a)** — remove now. It is a promise you cannot honour today, on 20+ pages × 5 locales |
| **D-2** | `shipments` vs extending `loads` | new table / extend | **New table** (§1) |
| **D-3** | **Dark/light mode (§32 U)** | (a) Defer, deliver a semantic-token layer now and the light palette when approved · (b) Full theme now · (c) Drop | **(a)** — but stated honestly: this is *blocked on an approved light palette that does not exist*, not "solved" by a `prefers-color-scheme` pass. The separable cheap half (semantic tokens) is where most of the XL sits and can land now; the palette is a design decision only you can make |
| **D-4** | Carrier-review metrics (§32 C) — the spec's **seven** dimensions vs the skill's **five** dispatch metrics; zero overlap | (a) Spec's seven, skill's five as a separate scorecard view · (b) Merge into one set · (c) Skill's five only | **(a)** — they measure different things: the spec rates *behaviour*, the skill measures *economics*. Both are useful; conflating them loses information |
| **D-5** | Guest support tickets (R-1) | (a) New `guest_tickets` table + `contact_messages` read surface · (b) ALTER 0007 to nullable + `guest_email` | **(a)** — 0007 is shipped and its RLS assumes a profile. Additive is safer |
| **D-6** | Operator free text on the 5-locale `/track` page (§24) | (a) Show untranslated with an honest "written by dispatch in English" label · (b) Curated phrase library, translated ×5, plus free text for staff only | **(b)** for statuses/delays; **(a)** as the fallback for genuinely novel situations. Never machine-translate silently — the spec forbids it |
| **D-7** | Knowledge Base storage (R-2) | (a) `posts` + `kind` discriminator · (b) separate `kb_articles` | **(a)** — reuses the M-33 editor, search and RLS; a KB article *is* a post with a different taxonomy |
| **D-8** | Careers résumé upload (§32 H) | (a) Build with the same magic-byte/private-bucket/retention rigour as carrier docs · (b) Defer, link to email | **(a)** — the audit deferred it while shipping every other risky item dark, which is inconsistent. It is the same upload pattern already proven in M-21 |
| **D-9** | Russian locale (§32 O lists only 4 public languages) | keep 5 / drop to 4 | **Keep 5.** `ru.json` is the largest dictionary and the tracking directive names 5 |

---

## 7. Module plan

### Phase A — Integrity (prerequisite, ~3 days)

**M-69 — Production Integrity Pack.** P-1…P-7. New: tokenized unsubscribe route + List-Unsubscribe header; audit-writer enforcement + lint rule; carrier download auditing; wiring `packet_downloads_live` and `testimonials_visible`; brokerage-label gating; RPM relabel. Migration: none (or 0014 for `deadhead_miles` if true RPM is approved). Gate: existing 478 assertions stay green.

### Phase B — Tracking core (M-70 → M-79)

| Module | Scope | Migrations |
|---|---|---|
| **M-70** | Shipment domain foundation: types, DTO serializers with financial-field allow-lists, tracking-number generator (`PL-YYYY-######`, server-side, unique, immutable), status/visibility enums | — |
| **M-71** | `shipments` + `shipment_parties` + `shipment_assignments`; RLS for shipper/carrier/broker/dispatcher/admin; immutability trigger on `tracking_number`; indexes per §25 | 0015–0016 |
| **M-72** | Status-transition engine (server-side, preconditions per §20, impossible-transition list) + `shipment_events` (all 18 fields incl. `idempotency_key`, `external_event_id`, `metadata`) + event-sourced appointments; corrections as additional audit events, never deletes | 0017 |
| **M-73** | Public `/track`: two-factor lookup (number + ZIP/access code), server-route only (no anon table SELECT), rate limiting, enumeration protection, access logging, strict public DTO, honest labels (§30) ×5 locales, accessible text-equivalent timeline, public support-message button with Turnstile | 0018 (`shipment_tracking_access`) |
| **M-74** | Shipper `/portal/shipper/shipments` + `[shipmentId]`: server-side pagination, all §11 filters, detail with timeline/ETA/map slot/documents/**invoice status/contacts/update history**, summary-vs-history query split | — |
| **M-75** | Dispatcher operations: create shipment, quote→shipment conversion, assignments, appointments, status/ETA updates, public update vs internal note, **record call / record email**, exception logging, POD request, notification resend, update history; operational board (8 columns) with server-side queries; admin+dispatcher tracking-number search | — |
| **M-76** | Carrier update experience (portal, permission-scoped transitions only) + `/driver/update/[token]`: shipment-scoped, short-lived, revocable, rate-limited, audit-logged, non-enumerable, consent-aware | 0019 |
| **M-77** | Shipment documents + POD: private storage, signed URLs ≤300s, **explicit visibility matrix**, broker value in `doc_visibility`, document-access history | 0020 |
| **M-78** | ETA architecture (8 fields incl. `eta_confidence`, public/internal delay reasons), ETA-change events, previous-value history; exceptions (13 types, 10 fields, open/resolve lifecycle) | 0021 |
| **M-79** | Notifications: 11 customer events, idempotency keys, dedupe, retry with backoff, preference respect, ×5 localisation, tracking link, no sensitive data; **background processing architecture** (queue table + worker route), delivery logging | 0022 |

### Phase C — Tracking completion (M-80 → M-84b)

| Module | Scope |
|---|---|
| **M-80** | Map + provider adapter interface (Motive/Samsara/Geotab/Verizon shapes, no fake connection), `tracking_provider_connections`, 4 privacy visibility levels, per-shipment tracking links, lazy-loaded map, accessible alternative |
| **M-81** | Broker-partner access: admin-invited only, org-scoped, explicit allow/deny permission lists per §12 |
| **M-82** | Responsive + a11y: **12 breakpoints**, mobile priority order (status → ETA → route → timeline → support → docs → map), semantic timeline with text equivalent, aria-live, reduced motion, no hover-only |
| **M-83** | RLS + security: **all 7** proofs (incl. dispatcher scoping), enumeration audit, public-DTO key-set tests, financial-write rejection, token expiry/revocation |
| **M-83b** | **Integration test lane** — the 11 named §27 tests against local PG16 (restores the dropped tier) |
| **M-84** | E2E (4 named flows + security flow), documentation (18 named docs), runbook (env, migrations, tracking config, map config, notification setup, smoke tests, go-live, rollback), §31 acceptance walk with honest live-env caveats |
| **M-84b** | **Observability** — Sentry wiring (not reuse: it does not exist), the 9 tracked signals, the "never log" enforcement, retention purger cron |

### Phase D — Business website (M-85 → M-101)

Compliance and trust first, acquisition second, infrastructure last.

`M-85` corporate pages incl. **Request a Quote page** (brokerage-gated where required) · `M-86` newsletter completion (segmentation, export, analytics — unsubscribe already in M-69) · `M-87` testimonials with approval workflow, ratings, featured, carousel, wired to `testimonials_visible` · `M-88` internal carrier reviews (**seven spec dimensions** + skill scorecard view per D-4, never public, DTO-protected) · `M-89` Support Center + live-chat **adapter** + guest tickets (D-5) · `M-90` Knowledge Base (D-7) · `M-91` blog completion (real categories, authors, featured image, tags, related, search, pagination) · `M-92` Downloads Center with versioning (on the now-real gate) · `M-93` Careers + résumé upload (D-8) · `M-94` Partner Program · `M-95` Referral Program (or removal per D-1) · `M-96` quote attachments + login centre · `M-97` audit-log expansion (all six categories incl. login events, which need an auth hook — not S-sized) · `M-98` global search (7 entities; FAQ needs migration to a table) · `M-99` PWA (manifest, icons, splash, update notifications, offline shell that **excludes** shipment data) · `M-100` Google Reviews + Maps + Calendly adapters · `M-101` theme semantic-token layer (D-3).

---

## 8. Honest scope statement

Combined, this exceeds the entire M-50…M-62 cycle. Tracking is ~17 modules, ~9 migrations, ~14 routes and a **new public attack surface**; the website is ~17 modules and ~10 tables. Realistically **three build cycles**, not one:

1. **Cycle 1 — M-69 + M-70…M-79.** Integrity fixes plus tracking core. Ends with shippers tracking real shipments and dispatchers operating them, all gated dark until `brokerage_active`.
2. **Cycle 2 — M-80…M-84b + M-85…M-92.** Tracking completion (map, security, tests, observability) plus the trust-and-acquisition website sections.
3. **Cycle 3 — M-93…M-101.** Careers, referral, search, PWA, adapters, theme layer.

Several §31 acceptance criteria are **unmeetable at delivery** by design: they require `brokerage_active = true`, which requires your MC authority and BMC-84 bond. That is a business milestone, not an engineering one, and the plan ships everything ready-and-dark behind it.

---

## 9. Where the uploaded skill shapes the code

`pickloads-carrier-management` is operational expertise, not a repo change. Six concrete bindings:

1. **M-88 carrier scorecard** — the skill's five dispatch metrics (gross/truck/week, true RPM, deadhead %, booked-vs-offered, broker payment incidents) become the economics view alongside the spec's seven behavioural dimensions (D-4).
2. **M-69 P-7 / true RPM** — the skill defines RPM over deadhead + loaded miles. Today's `formatRpm` uses loaded only. This is why the relabel matters.
3. **M-81 broker vetting** — the skill's broker checklist (authority, bond, days-to-pay, MC age <12 months + urgency = fraud pattern) is the field list for broker-partner onboarding.
4. **M-88 new-authority tiering** — Tier 1/2/3 risk bands replace a blanket new-authority exclusion, which matters because PickLoads' own programme graduates brand-new carriers.
5. **M-79 notification rules** — the skill's escalation triggers (broker >45 days past due; insurance lapse → suspend within 1 hour; unreachable carrier in transit → 4 hours) map directly onto exception severities and notification timing.
6. **M-78 exceptions** — the skill's detention/layover norms (2h free, $40–75/hr, layover $150–350) inform exception types and the fields dispatchers need to capture.

If you want it installed as a reusable skill in your account rather than just informing this plan, it can be repackaged as a `.skill` file on request.

---

## 10. What I need from you to start

Approve or amend the nine decisions in §6. **D-1** (the live referral promise) and **D-3** (theme scope) are the two that change what ships; the rest have safe defaults I can proceed on. On approval, M-69 starts immediately — it is small, it is entirely fixes to live defects, and nothing else should be built on top of the foundations it repairs.
