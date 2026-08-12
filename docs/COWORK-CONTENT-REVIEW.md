# Cowork content review register

**Purpose:** every piece of customer-facing copy that engineering has flagged
but must not change unilaterally. Content decisions belong to Cowork;
engineering builds the structures that hold them.

**Started:** 2026-08-11 · **Branch:** `final-website-production`

> **None of these statuses appear on a production page.** They live here. A
> customer never sees "COWORK REVIEW REQUIRED" — they see the current approved
> copy, unchanged, until Cowork rules on it.

**Statuses:** `APPROVED EXISTING COPY` · `COWORK REVIEW REQUIRED` ·
`LEGAL REVIEW REQUIRED` · `EXTERNAL CONFIG REQUIRED`

**Risk categories:** `MARKETING` · `BUSINESS` · `LEGAL` · `COMPLIANCE` · `SEO`

---

## 0 · The one item engineering resolved, and why

**Quote response time.** The quote surfaces promised a reply *"within one
business hour"*, and the public form and the portal form had already drifted
into two different commitments — `(Mon–Sat)` on the public page,
`(8am–6pm ET)` in the portal. Business supplied replacement wording:

> *"A PickLoads representative will review your request and follow up with you
> promptly."*

Implemented as a single constant, `src/lib/copy/response-promise.ts`, used by
`FreightQuoteForm` (both `/shippers` and `/request-a-quote`) and by
`PortalQuoteForm`. They can no longer diverge, because there is one string.

**Status: `APPROVED EXISTING COPY` (business-supplied).**

---

## 1 · Response-time and availability claims elsewhere — 40 across 25 files

The static scan written for the quote fix found the same class of claim across
the rest of the site. **All of it predates this phase and is approved copy**;
engineering has changed none of it. Each needs a yes/no from Cowork on whether
the business can stand behind it.

**Why it matters:** a stated turnaround or "24/7" is an operational commitment,
not a slogan. It is honest only with staffed hours, an owned queue and a way to
know when it was missed.

### 1a · Turnaround promises · `COWORK REVIEW REQUIRED` · risk: `BUSINESS`

| Where | Current wording |
|---|---|
| `(auth)/create-account/page.tsx` | "A dispatcher calls back within one business hour" |
| `(site)/shippers/page.tsx` (meta description) | "Request a quote — answered within one business hour." |
| `portal/carrier/page.tsx`, `portal/carrier/documents/page.tsx` | "Reviewed within one business day" |
| `portal/shipper/page.tsx`, `portal/shipper/quotes/page.tsx` | "A dispatcher reviews every request and calls back with a firm rate — usually within one business hour (8am–6pm ET)." |
| `components/forms/ContactForm.tsx` ×2 | "We reply within one business day — usually much faster." / "✓ SENT — We'll reply within one business day…" |
| `components/forms/NewAuthorityLeadForm.tsx` ×2 | "a launch specialist calls you back **within 15 minutes** during business hours" |
| `components/sections/QuickQuote.tsx` ×2 | "a dispatcher calls you back **within 15 minutes**" / "✓ RECEIVED — A dispatcher will call you within 15 minutes (Mon–Sat, 7am–9pm ET)" |
| `components/onboarding/CarrierWizard.tsx` | "Our team reviews your documents within one business day." |
| `components/portal/SupportForms.tsx` | "usually within one business hour (8am–6pm ET)" |
| `components/auth/CreateCarrierForm.tsx` | "a **same-day call** from a dispatcher" |
| `content/faq.ts` | "Within one business hour for standard FTL lanes (Mon–Sat)" |
| `emails/customer-templates.tsx` ×3 | same promises, in the transactional emails (en/es/fr) |

**The 15-minute callback is the sharpest.** It appears on the home page's
carrier form and the New Authority form — the two highest-traffic
conversion points — and is the hardest to staff.

### 1b · "24/7" availability · `COWORK REVIEW REQUIRED` · risk: `BUSINESS`

| Where | Current wording |
|---|---|
| `components/layout/Topbar.tsx` | "☎ (908) 404-5373 · 24/7 Dispatch" — **on every page** |
| `(site)/contact/page.tsx` | "Phone — 24/7 Dispatch Line" |
| `app/[locale]/not-found.tsx` | "call dispatch — a human answers 24/7" |
| `components/sections/Hero.tsx` | "…paperwork and 24/7 support" |
| `components/sections/HowAndCompare.tsx` | "24/7 live support, weekends included" (in a competitor comparison) |
| `components/sections/Pricing.tsx` ×2 | "24/7 driver support" in both plan feature lists |
| `components/sections/ServicesSplit.tsx` | "DRIVER SUPPORT 24/7" |
| `components/sections/WhyStats.tsx` ×2 | "24/7 support, including weekends." and a **`24/7` stat tile** |
| `portal/carrier/support/page.tsx`, `portal/shipper/support/page.tsx` | "Dispatch support: 24/7 · Office Mon–Fri 8am–6pm ET" |
| `emails/customer-templates.tsx` | "dispatch support answers 24/7" (en/es/fr) |

The directive lists "24/7 support" among claims not to introduce without
approved backing. These are pre-existing, so they are reported rather than
removed — but the topbar one ships on **every page of the site**.

### 1c · Other unquantified claims · `COWORK REVIEW REQUIRED` · risk: `MARKETING`

| Where | Current wording |
|---|---|
| `content/faq.ts` | "most carriers get their first load **within 24 hours**" — closest thing on the site to a guaranteed-loads claim |
| `components/sections/HowAndCompare.tsx` | competitor comparison column ("Voicemail after 5pm") — a claim about third parties |

---

## 2 · Pricing · `COWORK REVIEW REQUIRED` · risk: `BUSINESS` / `LEGAL`

`components/sections/Pricing.tsx` renders plan tiers on the home page.
Engineering has not touched them and will not invent, change or remove a
number. Cowork must confirm the tiers, the fee basis and the feature lists are
approved for publication — the directive is explicit that pricing must not be
fabricated and that unapproved pricing should present a contact state instead.

**The Dispatch Services page ships with no pricing section at all** pending
that ruling. The layout accommodates one without restructuring.

---

## 3 · Translation coverage · `COWORK REVIEW REQUIRED` · risk: `COMPLIANCE`

`ru` and `ht` mirror English for **426** and **432** v4 strings respectively,
and for most of the `shipment.*` namespace. Russian and Haitian Creole
customers read much of the platform in English. `es` and `fr` are essentially
complete.

This is measured and ratcheted (`tests/unit/i18n-coverage-ratchet.test.ts`), so
it cannot silently worsen. The three strings added by the approved response
wording raised the ru/ht baselines by exactly 3, recorded in that file.

Translating this is a review project, not a code change — doing it unreviewed
in a logistics and legal context ships something worse than an honest gap.

---

## 4 · Page-by-page register

### HOME · `COWORK REVIEW REQUIRED` · `MARKETING`
Hero headline and sub, the `WhyStats` stat tiles, `Pricing` tiers, the
`HowAndCompare` competitor table, and the audience-split wording. Structure is
final; wording is Cowork's. **`TestimonialsSection` correctly renders nothing**
while `testimonials_visible` is false — no fake praise.

### DISPATCH · `COWORK REVIEW REQUIRED` · `MARKETING`
`/dispatch-services` (new). Every heading and body paragraph is assembled from
**already-approved V4 dictionary strings** — nothing invented. Awaiting final
positioning copy. No pricing block, no earnings claim, no guarantee of loads,
RPM, gross or broker acceptance.

### BROKERAGE · `COWORK REVIEW REQUIRED` + `LEGAL` · `COMPLIANCE`
`/shippers`. Now gate-aware: the "Launching Soon" state renders while
`brokerage_active` is false, and the `Service` structured-data node is
withheld entirely until the gate opens. Final wording pending.

Two items on this page need a Cowork ruling — both are timing claims inside
the process flow that the §1a scan did not match because of their phrasing:

| Current wording | Where | Risk |
|---|---|---|
| **"RATE IN 1 HOUR"** | process flow node | `BUSINESS` — the same turnaround commitment the quote copy just dropped, still asserted three nodes into the shipper flow |
| **"SAME-DAY DOCS"** | process flow node | `BUSINESS` — a document-delivery commitment |
| "Claims & paperwork handled … documents delivered same day" | service card | `BUSINESS` |

Engineering has not changed them: they are approved copy and the instruction
is to leave availability/response claims for Cowork. They are listed here
because the quote surfaces no longer promise a time and these do.

### NEW AUTHORITY · `LEGAL REVIEW REQUIRED` · `LEGAL`
The disclaimer now has automated protection: 6 e2e tests assert the
not-a-law-firm wording is present (including on es/fr) and that the page makes
none of six forbidden regulatory guarantees — FMCSA/authority approval, an
activation or issuance date, insurance approval, government affiliation, legal
advice, or a 100% approval claim. Each with a non-vacuity control.

"Not a law firm / document filing assistance only" disclaimer is present and
correct. Counsel should confirm the wording is sufficient in every state where
the programme is marketed. The 15-minute callback promise is in §1a.

### CARRIER · `COWORK REVIEW REQUIRED` · `MARKETING`
`/become-a-carrier`. Onboarding steps and document expectations are factual.
"Same-day call" claim in §1a.

### ABOUT · `COWORK REVIEW REQUIRED` · `MARKETING`
Mission and vision copy. **No fabricated history, headcount, fleet size,
customer count or awards** — verified absent.

### FAQ / KNOWLEDGE BASE · `COWORK REVIEW REQUIRED` · `MARKETING` / `BUSINESS`
`content/faq.ts` is now the single source for BOTH `/faq` and
`/knowledge-base` — one edit updates both surfaces. Engineering authored no
answer text; the Knowledge Base is a categorisation, and a unit test asserts
every rendered answer is byte-identical to its FAQ source.

Open items:

| Entry | Issue | Risk |
|---|---|---|
| "How much does dispatch cost?" | **States pricing in prose** — "5% for owner-operators, 4.5% for small fleets, 8% for box trucks and hot shots. No setup fees, no monthly minimums." This is the same pricing question §2 raises about the home-page tiers, and it is asserted here as fact **and published as FAQ structured data** | `BUSINESS` |
| "How fast can you quote a shipment?" | "Within one business hour for standard FTL lanes (Mon–Sat)" — the turnaround promise the quote surfaces just dropped, still live here | `BUSINESS` |
| "What do I need to get started?" | "most carriers get their first load within 24 hours" — the closest thing on the site to a guaranteed-loads claim | `MARKETING` |
| "Are you a licensed freight broker?" | Answered honestly (authority and bond "in process", numbers to be published when active). **No change needed** — recorded so it is not edited carelessly later | `COMPLIANCE` |

**Three categories are declared and empty** — Documents, Accounts, Support.
They render an honest "nothing here yet" state with the support number. Cowork
supplying answers for them is the fastest way to make the Knowledge Base
substantial.

### CONTACT · `COWORK REVIEW REQUIRED` · `BUSINESS`
Contact categories not yet split per §33. "24/7 Dispatch Line" in §1b.

### FOOTER · `APPROVED EXISTING COPY`
One address, one phone, one mailbox, MC/USDOT rendering as **pending**. Nothing
invented. Legal column links the shells, which are `noindex` until counsel
delivers text.

### CAREERS · `COWORK REVIEW REQUIRED` · `MARKETING`
`/careers` **built and live.** Honest state: "No open roles right now" — no
invented vacancy, and no "we're always hiring" implying a pipeline that does
not exist. No `JobPosting` structured data, because it describes a vacancy and
there is none. Enquiries reuse `ContactForm`.

**Cowork owns:** the employer positioning and whether any role should be
listed. **If a real vacancy is approved,** it needs more than copy — a job
model, and a decision on CV storage, which is personal data with its own
retention and privacy position. Flag it as a project, not a content edit.

### PARTNERS · `COWORK REVIEW REQUIRED` · `BUSINESS`
`/partners` **built and live.** Five partnership *types* described; **no
partner named, no logo, no commission, discount, affiliate term or payout**.
A published commission is an offer, and none has been agreed. The page says
terms are agreed case by case.

**Cowork/business owns:** whether any partner may be named, and any commercial
terms. Engineering will not add a number here.

### REFERRAL PROGRAM · `COWORK REVIEW REQUIRED` + `LEGAL` · `BUSINESS`
**Not built, and deliberately so.** `company_settings.referral_program_active`
is **false**, and M-69/P-2 already gates the one referral line that exists
(in `CtaBand`) behind it — the promise stops today and returns with one
setting flip.

Building a referral *page* while the flag is false would create a surface whose
entire subject is a programme that cannot pay out. The architecture that
matters — the gate — already exists and is honoured on every page. **Engineering
is waiting on approved terms** (eligibility, amount, payout timing), which are
a business and legal decision, not a copy edit.

---

## 5 · External configuration required

| Item | Status | Blocks |
|---|---|---|
| Google Business Profile | `EXTERNAL CONFIG REQUIRED` | Google Reviews (§36) |
| Booking provider URL | `EXTERNAL CONFIG REQUIRED` | Book a Consultation (§34) |
| Google Maps embed key | `EXTERNAL CONFIG REQUIRED` | contact map |
| Sentry DSN | `EXTERNAL CONFIG REQUIRED` | error monitoring is inert without it |
| GA4 measurement id | `EXTERNAL CONFIG REQUIRED` | **the analytics taxonomy emits nothing until this is set** |
| Real photography | `COWORK REVIEW REQUIRED` | §47 image strategy |

---

## 6 · How to hand copy back

Every flagged string is a V4 dictionary entry: give engineering the English
sentence and, where available, the es/fr translations. Implementation is one
`SUPPLEMENTAL` entry plus a catalogue update.

> ⚠️ **Do not run `node scripts/extract-i18n.mjs` to regenerate catalogues.**
> It was tried during this work and **deleted 743 lines** — the entire
> `shipment.location.*` and `shipment.document.*` namespaces that M-77 and
> M-80 added, because the script cannot reproduce strings authored outside the
> V4 prototype. Add keys surgically to `messages/*.json` instead. Reconciling
> the extractor with the catalogues is its own task and is filed as P1.

---

## 7 · Light/Dark theme — a DESIGN decision, not an engineering one

**Status: `COWORK REVIEW REQUIRED` (design) · risk: `MARKETING` / `COMPLIANCE`**

The final technical directive asks for Light / Dark / System themes and, in the
same breath, to *"preserve the PickLoads V4 visual identity"* and *"do not
create a second design system."* On this codebase those pull against each
other, and engineering should not resolve it alone.

**Why.** V4 is a **dark-first identity**. `body` is asphalt (`#12161a`), the nav
is `rgba(18,22,26,.94)`, the footer is night, and `.light` sections are a
deliberate *alternating device* within that — not a light theme waiting to be
switched on. Roughly 120 colour declarations in `v4.css` are keyed to that
arrangement, and each `.light` block exists to contrast with the dark blocks
around it.

A genuine "Light theme" therefore means **inverting the default surfaces on 433
pages** and re-deriving every light/dark section pairing. That is a new visual
system for the same brand — which is the thing the same paragraph forbids.

**What engineering can build without a design decision:** the infrastructure —
a `data-theme` attribute, a no-flash inline script, `prefers-color-scheme`
detection, persisted preference, and a toggle. That is perhaps half a day and
carries no risk.

**What it cannot do honestly:** invent the light palette. Choosing what the
hero, the nav, the load ticker and the boards strip look like on a light
background is design work, and guessing it would ship a second identity that
nobody approved and that the certified WCAG AA baseline has never been run
against.

**Recommendation.** Either (a) Cowork/design supplies an approved light palette
and engineering implements it against the existing token layer, or (b) the site
declares itself dark-only via `color-scheme: dark` — which is honest, is what
the design actually is today, and still respects a user's system preference by
telling the browser the truth rather than fighting it.

**Nothing has been implemented either way.** The theme phase is stopped pending
this decision.
