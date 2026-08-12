# Cowork content review register

> # ⚠ RECONCILED 2026-08-12 — READ THIS FIRST
>
> **The owner ruled on the open items.** Everything below §0.5 was written on
> 2026-08-11, before those decisions and partly against an older repository
> snapshot. Read §0.5 first: it says which findings are now **resolved**, which
> were **never present on this branch**, and which are still genuinely open.
>
> **Do not treat an unresolved-looking status further down this file as a
> current defect without checking §0.5.** Several are neither.

**Purpose:** every piece of customer-facing copy that engineering has flagged
but must not change unilaterally. Content decisions belong to Cowork;
engineering builds the structures that hold them.

**Started:** 2026-08-11 · **Reconciled:** 2026-08-12 ·
**Branch:** `final-website-production`

> **None of these statuses appear on a production page.** They live here. A
> customer never sees "COWORK REVIEW REQUIRED" — they see the current approved
> copy, unchanged, until Cowork rules on it.

**Statuses:** `APPROVED EXISTING COPY` · `COWORK REVIEW REQUIRED` ·
`LEGAL REVIEW REQUIRED` · `EXTERNAL CONFIG REQUIRED`

**Risk categories:** `MARKETING` · `BUSINESS` · `LEGAL` · `COMPLIANCE` · `SEO`

---

## 0.5 · Reconciliation against the current branch — 2026-08-12

Every finding in this register, verified against `final-website-production` at
`4c121f2` and re-classified. **Nothing below was applied on the strength of the
report alone**; each was checked in the actual source first, which is how three
of them turned out not to exist here.

**Full decision text: `OWNER-BUSINESS-DECISIONS.md`.**

### BUSINESS DECISION APPLIED — verified present, changed in this pass

| §             | Finding                                                       | What happened                                                                                                         |
| ------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1b            | "24/7" availability, 12 public surfaces + 5 locale catalogues | → "Dispatch support 7 days a week" + after-hours emergency support (A1)                                               |
| 1a            | "within 15 minutes" callback promise, 3 public surfaces       | → "typically within the hour during business hours" (A2). 15 min survives as an internal KPI only                     |
| 1a            | "first load within 24 hours" (FAQ)                            | → "rolling within 24–48 hours after completed paperwork", plus a dependency qualifier (A3)                            |
| 1a            | "On the road with us in 24 hours." (homepage §how + `/become-a-carrier` hero) | → "On the road within 24–48 hours." + the qualifier, both from `src/lib/copy/onboarding-timing.ts` (A3). **Found on the second sweep, not the first** — see the note below |
| 1a            | "RATE IN 1 HOUR" (`/shippers`)                                | → "FAST, TRANSPARENT QUOTES" (A4)                                                                                     |
| 1a            | "SAME-DAY DOCS" + "documents delivered same day"              | → "DOCUMENTS DELIVERED PROMPTLY" / "delivered promptly" (A4)                                                          |
| 1c            | "5% flat dispatch fee" as a whole-model claim                 | → "Owner-operator dispatch fee", reading the canonical constant (C)                                                   |
| 1c            | "48 · States covered"                                         | → "Contiguous states supported" (C)                                                                                   |
| 1c            | "Avg rate/mile booked*"                                       | Deleted from all five catalogues (C)                                                                                  |
| 2             | Pricing scattered across 6 modules + 5 catalogues             | Canonical `src/lib/pricing.ts`; components read it, prose is test-checked (B)                                         |
| CAREERS       | Positioning                                                   | → "We're building our team.", with "no open roles posted today" retained (D2)                                         |
| NEW AUTHORITY | Operator identity                                             | Page now names **PickLoads Logistics Group LLC**, adds a no-government-agency / no-approval-guarantee disclaimer (D4) |

Also changed, for consistency rather than because the report named them: eight
adjacent unhedged promises — "calls back within one business hour", "a
dispatcher calls you the same day", "reviewed within one business day", "we
reply within one business day" — now carry "typically". Leaving them would have
contradicted the approved sentence on the same site.

#### The A3 miss, recorded on purpose

The first sweep corrected the FAQ answer and stopped there, because the report
named the FAQ. **The same promise was also the homepage section heading and the
`/become-a-carrier` hero title** — "On the road with us in 24 hours." — which
is the largest type the claim appeared in anywhere on the site. For a few hours
the FAQ said "24–48 hours after completed paperwork" while the heading directly
above the same funnel said 24, unconditionally.

Two things follow, and both are now in place:

1. **The claim is single-sourced.** `src/lib/copy/onboarding-timing.ts` holds
   the headline and the qualifier; both surfaces import it, and a test fails if
   either renders the headline without the qualifier. The two surfaces stated
   the promise independently, which is precisely why fixing one missed the other.
2. **The pattern is banned, not the sentence.** The regression check matches any
   bare "in/within 24 hours", not the specific wording that was removed. Checking
   for the old sentence would have passed the moment someone rephrased it.

Worth stating plainly for the next auditor: a finding that names one file is not
a finding about one file. The report was accurate and acting on it literally
still left the louder copy of the claim live.

### NOT PRESENT ON FINAL BRANCH — reported, but does not exist here

These came from an older snapshot. **Each was checked; none needed a change.**

| Reported                                       | Reality on this branch                                                                                                                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Competing **10% Box Truck / Hot Shot** pricing | Does not exist. Content already said 8% everywhere. The only `10%` in the repository is a CSS gradient stop. A non-vacuity control proves the pricing check _would_ catch a 10% fee claim                      |
| **Fake / placeholder testimonials**            | None exist. `getApprovedTestimonials()` returns `[]` by construction, `testimonials_visible` is `false`, and a certified test forbids the prototype author name. Nothing was removed because nothing was there |
| **New Authority operated by Larocque Group**   | Never present. The only occurrence of the name is "Emmanuel Larocque" as a person on the About page, which is accurate. The operator line was added anyway — see D4                                            |
| **Named partners / logos / commissions**       | None exist. The Partners page already offered generic categories and "Terms are agreed case by case"                                                                                                           |

### RESOLVED EARLIER — already fixed before this pass

| §           | Finding                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| 0           | Quote response-time drift between public and portal forms — single constant since 2026-08-11 (wording now superseded by A2) |
| 4 REFERRAL  | Referral reward promise — gated by `referral_program_active = false` since M-69                                             |
| 4 BROKERAGE | Brokerage claims while unlicensed — fail-closed at DB, RLS, server, UI and structured data                                  |

### LEGAL REVIEW REQUIRED — still open, engineering cannot close

Privacy Policy · Terms of Service · Cookie Policy · E-Sign Consent · Dispatch
Service Agreement · New Authority Service Agreement · New Authority disclaimer
review · brokerage pre-launch language review · **Shipper-Broker Agreement**
and **Broker-Carrier Agreement** (no shell exists for either).

**Counsel now has the business inputs** — the three fee tiers, the availability
model, the response-time posture and the New Authority operator. Having the
inputs does not make any document approved. → `LEGAL-DOCUMENTS-REQUIRED.md`

### EXTERNAL CONFIG REQUIRED — still open

GA4 measurement id · Sentry DSN · Google Business Profile (no evidence it
exists) · booking URL · Maps embed key · PWA brand icons · real PickLoads
photography · four counsel-approved packet PDFs · Dropbox Sign template.

**Photography constraint:** generic decorative visuals may remain only where
they do not imply real PickLoads employees, offices, fleet or carrier partners.

### One known grep hit — and the thing it turned out to be hiding

`messages/_key-index.json` still contains 11 entries carrying the old wording
("24/7 Dispatch", "RATE IN 1 HOUR", "within 15 minutes", "most carriers get
their first load within 24 hours").

It is a generated slug→English index that only `scripts/extract-i18n.mjs`
writes and nothing in the application reads. It is stale because regenerating
it means running the extractor, which is fail-closed for good reason (it would
delete 126 keys per locale). **Left as-is deliberately** — an out-of-date dev
artifact beats either running a destructive script or hand-editing a generated
file.

> #### ⚠ CORRECTION — the first version of this entry was wrong
>
> It said the file "is not bundled" and that the production build "contains
> **zero** occurrences of every removed claim." **Both claims were false, and
> the second was stated as a measured result.**
>
> `src/i18n/request.ts` loaded catalogues with
> `` import(`../../messages/${locale}.json`) ``. A template-literal specifier
> makes webpack emit a **context module**: unable to know which locale runtime
> will request, it bundles *every* file matching `messages/*.json`.
> `_key-index.json` went into the server chunks with the rest, and a grep of
> `.next/server` returned the full set of retired claims.
>
> Nothing rendered it — the context module only resolves a key the runtime asks
> for, and `_key-index` is not a locale. **That is what made it dangerous
> rather than harmless.** It was invisible on every page and present in every
> deployment, so "we removed that claim" and "that claim is not in what we
> ship" had stopped being the same statement without anyone noticing.
>
> **Fixed:** `request.ts` now lists the five catalogues explicitly. No context
> module exists, so a future file dropped into `messages/` cannot be swept in
> by existing code. Two tests hold it: one rejects a template-literal import in
> that file, one greps the built server output for retired claims — with a
> non-vacuity control proving the scan reads real chunk content rather than
> passing on an empty tree.
>
> **The lesson is about the evidence, not the bug.** The original entry
> asserted a build scan that would have caught this. Recorded in full because a
> confident, specific, wrong "verified" line is worse than an open question —
> the next reader stops looking.

After the fix, the built output contains **no** retired claim. The two grep
hits that remain are both deliberate and documented: `call within 15 minutes`
in the internal staff lead email (A2), and the hedged market spot ranges such
as `$2.40–$2.90/mi` in `src/content/states.ts` (C).

### TRANSLATION REVIEW REQUIRED — still open, and slightly worse

English is the approved source copy as of this pass. `es` and `fr` were
authored for all 26 new strings — those baselines did not move. **`ru` and `ht`
mirror English**, which raised their ratchet baselines by exactly 28 each.

That is an honest regression in translation coverage, accepted deliberately:
the alternative was leaving a 24/7 claim and a 15-minute guarantee live in five
languages because two of them lack a translator. **These 28 strings are the
priority list for native review** — pricing, availability and legal-adjacent
copy. §3 below has the standing detail.

---

## 0 · The one item engineering resolved, and why

**Quote response time.** The quote surfaces promised a reply _"within one
business hour"_, and the public form and the portal form had already drifted
into two different commitments — `(Mon–Sat)` on the public page,
`(8am–6pm ET)` in the portal. Business supplied replacement wording:

> _"A PickLoads representative will review your request and follow up with you
> promptly."_

Implemented as a single constant, `src/lib/copy/response-promise.ts`, used by
`FreightQuoteForm` (both `/shippers` and `/request-a-quote`) and by
`PortalQuoteForm`. They can no longer diverge, because there is one string.

**Status: `SUPERSEDED 2026-08-12` by owner decision A2.**

The structure was right and survives unchanged — one constant, imported by
every quote surface, incapable of drifting. Only the sentence changed:

> _"We respond fast — typically within the hour during business hours."_

The owner chose to state a time after all, hedged. "Typically" is the entire
decision: it describes what usually happens, where "within one hour" would be
an SLA — which is the thing this section removed in the first place. A test now
asserts the word is present and that "guarantee" is not.

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

| Where                                                          | Current wording                                                                                                                         |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `(auth)/create-account/page.tsx`                               | "A dispatcher calls back within one business hour"                                                                                      |
| `(site)/shippers/page.tsx` (meta description)                  | "Request a quote — answered within one business hour."                                                                                  |
| `portal/carrier/page.tsx`, `portal/carrier/documents/page.tsx` | "Reviewed within one business day"                                                                                                      |
| `portal/shipper/page.tsx`, `portal/shipper/quotes/page.tsx`    | "A dispatcher reviews every request and calls back with a firm rate — usually within one business hour (8am–6pm ET)."                   |
| `components/forms/ContactForm.tsx` ×2                          | "We reply within one business day — usually much faster." / "✓ SENT — We'll reply within one business day…"                             |
| `components/forms/NewAuthorityLeadForm.tsx` ×2                 | "a launch specialist calls you back **within 15 minutes** during business hours"                                                        |
| `components/sections/QuickQuote.tsx` ×2                        | "a dispatcher calls you back **within 15 minutes**" / "✓ RECEIVED — A dispatcher will call you within 15 minutes (Mon–Sat, 7am–9pm ET)" |
| `components/onboarding/CarrierWizard.tsx`                      | "Our team reviews your documents within one business day."                                                                              |
| `components/portal/SupportForms.tsx`                           | "usually within one business hour (8am–6pm ET)"                                                                                         |
| `components/auth/CreateCarrierForm.tsx`                        | "a **same-day call** from a dispatcher"                                                                                                 |
| `content/faq.ts`                                               | "Within one business hour for standard FTL lanes (Mon–Sat)"                                                                             |
| `emails/customer-templates.tsx` ×3                             | same promises, in the transactional emails (en/es/fr)                                                                                   |

**The 15-minute callback is the sharpest.** It appears on the home page's
carrier form and the New Authority form — the two highest-traffic
conversion points — and is the hardest to staff.

### 1b · "24/7" availability · `COWORK REVIEW REQUIRED` · risk: `BUSINESS`

| Where                                                                | Current wording                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `components/layout/Topbar.tsx`                                       | "☎ (908) 404-5373 · 24/7 Dispatch" — **on every page**              |
| `(site)/contact/page.tsx`                                            | "Phone — 24/7 Dispatch Line"                                        |
| `app/[locale]/not-found.tsx`                                         | "call dispatch — a human answers 24/7"                              |
| `components/sections/Hero.tsx`                                       | "…paperwork and 24/7 support"                                       |
| `components/sections/HowAndCompare.tsx`                              | "24/7 live support, weekends included" (in a competitor comparison) |
| `components/sections/Pricing.tsx` ×2                                 | "24/7 driver support" in both plan feature lists                    |
| `components/sections/ServicesSplit.tsx`                              | "DRIVER SUPPORT 24/7"                                               |
| `components/sections/WhyStats.tsx` ×2                                | "24/7 support, including weekends." and a **`24/7` stat tile**      |
| `portal/carrier/support/page.tsx`, `portal/shipper/support/page.tsx` | "Dispatch support: 24/7 · Office Mon–Fri 8am–6pm ET"                |
| `emails/customer-templates.tsx`                                      | "dispatch support answers 24/7" (en/es/fr)                          |

The directive lists "24/7 support" among claims not to introduce without
approved backing. These are pre-existing, so they are reported rather than
removed — but the topbar one ships on **every page of the site**.

### 1c · Other unquantified claims · `COWORK REVIEW REQUIRED` · risk: `MARKETING`

| Where                                   | Current wording                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `content/faq.ts`                        | "most carriers get their first load **within 24 hours**" — closest thing on the site to a guaranteed-loads claim |
| `components/sections/HowAndCompare.tsx` | competitor comparison column ("Voicemail after 5pm") — a claim about third parties                               |

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

| Current wording                                             | Where             | Risk                                                                                                                      |
| ----------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **"RATE IN 1 HOUR"**                                        | process flow node | `BUSINESS` — the same turnaround commitment the quote copy just dropped, still asserted three nodes into the shipper flow |
| **"SAME-DAY DOCS"**                                         | process flow node | `BUSINESS` — a document-delivery commitment                                                                               |
| "Claims & paperwork handled … documents delivered same day" | service card      | `BUSINESS`                                                                                                                |

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

| Entry                                | Issue                                                                                                                                                                                                                                                                                               | Risk         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| "How much does dispatch cost?"       | **States pricing in prose** — "5% for owner-operators, 4.5% for small fleets, 8% for box trucks and hot shots. No setup fees, no monthly minimums." This is the same pricing question §2 raises about the home-page tiers, and it is asserted here as fact **and published as FAQ structured data** | `BUSINESS`   |
| "How fast can you quote a shipment?" | "Within one business hour for standard FTL lanes (Mon–Sat)" — the turnaround promise the quote surfaces just dropped, still live here                                                                                                                                                               | `BUSINESS`   |
| "What do I need to get started?"     | "most carriers get their first load within 24 hours" — the closest thing on the site to a guaranteed-loads claim                                                                                                                                                                                    | `MARKETING`  |
| "Are you a licensed freight broker?" | Answered honestly (authority and bond "in process", numbers to be published when active). **No change needed** — recorded so it is not edited carelessly later                                                                                                                                      | `COMPLIANCE` |

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

`/partners` **built and live.** Five partnership _types_ described; **no
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

Building a referral _page_ while the flag is false would create a surface whose
entire subject is a programme that cannot pay out. The architecture that
matters — the gate — already exists and is honoured on every page. **Engineering
is waiting on approved terms** (eligibility, amount, payout timing), which are
a business and legal decision, not a copy edit.

---

## 5 · External configuration required

| Item                    | Status                     | Blocks                                                     |
| ----------------------- | -------------------------- | ---------------------------------------------------------- |
| Google Business Profile | `EXTERNAL CONFIG REQUIRED` | Google Reviews (§36)                                       |
| Booking provider URL    | `EXTERNAL CONFIG REQUIRED` | Book a Consultation (§34)                                  |
| Google Maps embed key   | `EXTERNAL CONFIG REQUIRED` | contact map                                                |
| Sentry DSN              | `EXTERNAL CONFIG REQUIRED` | error monitoring is inert without it                       |
| GA4 measurement id      | `EXTERNAL CONFIG REQUIRED` | **the analytics taxonomy emits nothing until this is set** |
| Real photography        | `COWORK REVIEW REQUIRED`   | §47 image strategy                                         |

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

**Status: DECIDED 2026-08-11 — Option (b) approved by the business.**

> **DARK THEME — APPROVED / PRODUCTION READY**
> **LIGHT THEME — DEFERRED PENDING APPROVED DESIGN SYSTEM**
> **SYSTEM THEME — NOT APPLICABLE UNTIL LIGHT THEME EXISTS**

This is **DESIGN APPROVAL REQUIRED**, not an engineering defect, and it is
**not a technical blocker**. The reasoning below is kept because it is what the
decision rests on.

The final technical directive asks for Light / Dark / System themes and, in the
same breath, to _"preserve the PickLoads V4 visual identity"_ and _"do not
create a second design system."_ On this codebase those pull against each
other, and engineering should not resolve it alone.

**Why.** V4 is a **dark-first identity**. `body` is asphalt (`#12161a`), the nav
is `rgba(18,22,26,.94)`, the footer is night, and `.light` sections are a
deliberate _alternating device_ within that — not a light theme waiting to be
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

### 7a · What the attempt to declare it in CSS proved

Declaring the decision technically was tried and reverted, and the result is
worth keeping because it constrains how a light theme must eventually be built:

- **`:root { color-scheme: dark }` breaks the site.** It flips the user agent's
  default text colour to white, and V4's `.light` sections set an explicit
  light background while inheriting that default for some text. axe reported
  **serious contrast failures across 239 tests**. The alternating light/dark
  device that makes this design work is exactly what one global declaration
  destroys.

- **So a future light theme cannot be a global switch.** It has to be a
  `data-theme` attribute on `<html>` plus a colour-scheme scoped per surface,
  with the `.light`/dark pairing re-derived by design. That is the extension
  point; it is recorded so nobody reaches for the one-line version again.

The dark identity is therefore declared the way it always has been —
explicitly, on every surface — and the site ships no theme toggle.
