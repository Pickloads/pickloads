# Final website — implementation plan

**Baseline:** `m84b-certified` (`2315386`) · **Branch:**
`final-website-production` · **Companion:** `docs/FINAL-WEBSITE-GAP-AUDIT.md`

---

## 1 · Strategy

**Reuse first, build second, never duplicate.** The certified platform already
provides the design vocabulary, the i18n architecture, the form doctrine, the
document store, the audit trail and the test lanes. Every page below is
assembled from those, not beside them.

**Three rules that decide every judgement call in this phase:**

1. **The certified lanes stay green.** 1,638 / 806 / 369 / 371 / 388 is the
   floor. Any decrease is explained or reverted; CI enforces it on every push.
2. **Nothing ships ahead of the fact it asserts.** A page that needs approved
   legal text, a real Google profile, a booking URL or brokerage authority ships
   with an honest state, not a plausible one.
3. **No new colours, no new type scale, no page-local styling.** The design
   system is extended in one place or not at all.

## 2 · Page inventory

| Page | Action | Source of truth |
|---|---|---|
| Home | polish — add the §11 dual-path split; confirm hero copy | V4 HTML |
| Dispatch Services | **new** conversion page above the equipment/state pages | §12 |
| Freight Brokerage (`/shippers`) | polish to §14; keep the gate | §14 |
| New Authority | polish only — disclaimer is correct | §16 |
| Become a Carrier | polish — add documents/expectations | §17 |
| Request a Quote | **new** public page | §15 / M-85 |
| Track | integrate visually; **do not touch behaviour** | §19 |
| About | polish to §21 | §21 |
| Contact | polish — add §33 categories | §33 |
| FAQ | polish; table migration deferred | §27 |
| Knowledge Base | **new** | M-90 |
| Downloads Center | **new**, on `packet_downloads_live` | M-92 |
| Support Center | **new** public/guest surface | M-89 |
| Blog | real categories, authors, related | M-91 |
| Careers | **new**, honest empty state | M-93 |
| Partner Program | **new** | M-94 |
| Referral Program | **new**, on `referral_program_active` | M-95 |
| Login Center | **new** — see the §7 recommendation in the audit | §38 |
| Legal shells | leave as they are until counsel delivers | 🔒 |

## 3 · Component strategy

**Reused unchanged:** `Hero`, `ServicesSplit`, `EquipmentGrid`, `Pricing`,
`Compliance`, `NewAuthority`, `CtaBand`, `WhyStats`, `Industries`,
`HowAndCompare`, `Packet`, `ShippersTeaser`, `TestimonialsSection`,
`QuickQuote`, `PageHero`, the tracking components, the portal shell.

**New, and deliberately generic** so seven new pages do not become seven new
styling dialects: `AudienceSplit`, `ProcessSteps`, `ResourceGrid`,
`DocumentCard`, `EmptyStateCard`, `ContactCategoryPicker`, `LoginDoor`,
`FaqAccordion` (extracted from the existing `/faq`).

**Design-system work:** audit and document the existing tokens, then extend —
container widths, button hierarchy, card variants, badge set, and the five
mandated states (loading / empty / success / error / mobile) as shared
primitives rather than per-page markup.

## 4 · Phases

Each phase ends with the full gate (`typecheck · lint · unit · rls ·
integration · e2e · build`) and one clean commit. CI runs the same gate.

| Phase | Scope | Ships |
|---|---|---|
| **A** ✅ | CI + branch + baseline preservation | **Done** — `e3b6d98` |
| **B** | Design system audit + global nav + footer (§8, §48, §59) | Nav/footer used by every later phase |
| **C** | Homepage — dual-path split, hero, section order (§9–§11) | The main entry |
| **D** | Dispatch Services page + New Authority polish + Become a Carrier (§12, §13, §16, §17) | Carrier funnel |
| **E** | Freight Brokerage polish + **Request a Quote** page (§14, §15) | Shipper funnel |
| **F** | Track integration + Support Center + Knowledge Base + Downloads (§19, §26, §27, §28) | Resources |
| **G** | About + Careers + Partners + Referral + Blog categories (§21–§24, §29–§32) | Company |
| **H** | Login Center + portal transition polish (§38, §39) | Auth entry |
| **I** | SEO + analytics taxonomy + PWA + performance (§44–§46, §52, §53, §42) | Platform |
| **J** | Full responsive / accessibility / security QA (§49, §50, §54, §61–§63) | Certification |
| **K** | Production readiness audit (§64, §65) | Launch pack |

## 5 · Testing strategy

- **Every new page** gets a route test in the e2e suite and joins the responsive
  spec's route list, so all 12 breakpoints cover it automatically.
- **Every new form** gets: server-side Zod validation, rate limiting, spam
  protection, and unit tests for the validation schema — the M-14 doctrine,
  not a new one.
- **Every gated surface** gets a test for *both* states. A gate tested only in
  its closed state is a gate that opens wrong.
- **Security lanes re-run after every phase**, not only at the end. An RLS
  regression introduced in Phase C should fail in Phase C.
- **No assertion is weakened to make a page pass.**

## 6 · Legal and external dependencies

| Dependency | Blocks | Owner |
|---|---|---|
| Privacy / Terms / Cookie text | production launch of any page | counsel |
| Dispatch + Carrier agreement text & Dropbox template | carrier funnel completion | counsel |
| Broker-Carrier + Shipper-Broker agreements | brokerage activation | counsel |
| MC authority + BMC-84 bond | `brokerage_active = true` | business |
| Google Business Profile | Google Reviews (§36) | business |
| Booking provider URL | Book a Consultation (§34) | business |
| Approved pricing | Dispatch pricing (§13) | business |
| Real imagery | §47 image strategy | business |

**None blocks engineering from proceeding.** Each has a defined honest state.

## 7 · Git strategy

One repository, one branch (`final-website-production`), one commit per
validated phase, message explaining *why* not merely *what*. `m84b-certified`
is never moved. No milestone proliferation: this phase is documented as **FINAL
WEBSITE PRODUCTION**, not M-85+.

## 8 · Launch sequence

1. Phases B → K complete, CI green.
2. Counsel delivers legal text; shells replaced; `noindex` lifted.
3. Production environment audit (§64) — every variable classified.
4. Staging deploy; live-integration verification; the Sentry privacy check.
5. Dispatch business goes live.
6. **Separately, later:** MC authority + bond land → business owner flips
   `brokerage_active` → brokerage goes live. Not an engineering step.

## 9 · Honest scale statement

Phases B–K are **eleven new destinations and four platform features** — the
substance of `FINAL-IMPLEMENTATION-PLAN` Phase D (M-85 → M-101). That plan
estimates a full build cycle for this work, comparable to M-50…M-62.

This document does not pretend otherwise, and the phase table above is a
sequence to work through, not a checklist to tick in one sitting. Phase A is
complete and verified. Phase B begins on approval.
