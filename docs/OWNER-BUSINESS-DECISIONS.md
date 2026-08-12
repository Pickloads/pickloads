# Owner pre-launch business decisions

**Decided 2026-08-12 by the owner, PickLoads Logistics Group LLC.**
**Applied to `final-website-production` in this pass.**

This is the business source of truth for public copy. Where it disagrees with
an older document, an older commit message or an earlier Cowork snapshot, this
wins. Counsel should read this alongside `LEGAL-DOCUMENTS-REQUIRED.md` — several
items below are inputs to agreements that do not exist yet.

The recurring theme is worth stating once: nearly every claim removed here was
_approved copy at the time it was written_. None was a mistake. They were
commitments made before there was an operation to keep them, and the decision
was to stop selling what cannot yet be guaranteed rather than to build toward
promises already published.

---

## A1 · Dispatch availability

|              |                                                                                     |
| ------------ | ----------------------------------------------------------------------------------- |
| **Removed**  | "24/7 Dispatch", "24/7 driver support", "a human answers 24/7", "24/7 live support" |
| **Approved** | Dispatch support **7 days a week**, plus **after-hours emergency support**          |
| **Rule**     | Never imply a dispatcher is continuously staffed 24 hours a day                     |

The business-hours desk information already on the site (Mon–Fri 8am–6pm ET,
Sat 9am–2pm ET) is preserved. Seven-day support and a staffed weekday desk are
not contradictory; "24/7" and a staffed weekday desk were.

**12 public surfaces changed**, including the topbar on every page.

## A2 · Response time

|              |                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------- |
| **Removed**  | "a dispatcher calls you back within 15 minutes", "15min · Callback promise"                   |
| **Approved** | "We respond fast — typically within the hour during business hours."                          |
| **Rule**     | Not a guarantee. "Typically" is load-bearing and must not become "guaranteed within one hour" |

**15 minutes survives as an internal operational KPI only** — on the staff lead
notification email and the admin dashboard, both behind auth. An instruction to
an employee is not a commitment to a customer, and that distinction is enforced
by a named exemption in `tests/unit/owner-business-decisions.test.ts` rather
than by a loosened pattern.

The single sentence lives in `src/lib/copy/response-promise.ts`. Every quote
surface imports it; none restates it.

## A3 · First load

|              |                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| **Removed**  | "most carriers get their first load within 24 hours" · **"On the road with us in 24 hours."**          |
| **Approved** | "On the road within 24–48 hours." / "Most carriers are rolling within 24–48 hours after completed paperwork." |
| **Added**    | "Timing depends on completed onboarding, documentation, equipment, location and market availability." |

Contextual language, not a guarantee. PickLoads does not control load
availability, broker acceptance, market rates or shipper decisions, and the
qualifier says so without turning marketing copy into a disclaimer.

**Three surfaces, and the third was nearly missed.** The FAQ answer was the one
the report named. The same promise was also the homepage onboarding heading and
the `/become-a-carrier` hero title — the largest type the claim appeared in
anywhere on the site — and correcting the FAQ left both live.

`src/lib/copy/onboarding-timing.ts` now owns the headline and the qualifier.
Both surfaces import it, and a test fails if either renders the headline without
the qualifier: the headline alone is the claim this decision removed, only with
a wider number. The regression check bans the *pattern* — any bare "in/within 24
hours" — rather than the sentence that was removed, because checking for the old
wording would pass the moment somebody rephrased it.

## A4 · Shipper / brokerage flow

| Removed                        | Approved                       |
| ------------------------------ | ------------------------------ |
| "RATE IN 1 HOUR"               | "FAST, TRANSPARENT QUOTES"     |
| "SAME-DAY DOCS"                | "DOCUMENTS DELIVERED PROMPTLY" |
| "documents delivered same day" | "documents delivered promptly" |

No numeric brokerage turnaround promise replaces them. **`brokerage_active`
remains false**, so all brokerage copy stays compatible with pre-launch status.

## B · Public dispatch pricing

| Tier                         | Rate     |
| ---------------------------- | -------- |
| Owner-Operator               | **5%**   |
| Small Fleet — 2 to 10 trucks | **4.5%** |
| Box Truck / Hot Shot         | **8%**   |

Pricing remains public. **`src/lib/pricing.ts` is the canonical definition.**
Rendered components read it; prose is checked against it by test, because a
translated sentence cannot import a constant.

**The reported competing 10% Box Truck tier does not exist on this branch** and
appears never to have — the only `10%` in the repository is a CSS gradient
stop. A non-vacuity control proves the check _would_ catch a 10% fee claim, so
"not present" is a measured result rather than an absence of looking.

## C · Public statistics

| Claim                     | Decision                                                                                                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "5% flat fee"             | Approved **only** where it describes the Owner-Operator tier. The homepage tile now reads "Owner-operator dispatch fee" — the number was always right, "flat dispatch fee" was the untrue part when two of three tiers are not 5% |
| "$2.90 average rate/mile" | **Removed.** No replacement number invented                                                                                                                                                                                       |
| "Avg rate/mile booked*"   | **Removed** from all five locale catalogues (it was an orphan label, rendered nowhere)                                                                                                                                            |
| "You approve every rate." | Approved — now the fourth homepage stat                                                                                                                                                                                           |
| "48 states"               | Retained as **"Contiguous states supported"**                                                                                                                                                                                     |

"48 · States covered" read as coverage already proven. The approved meaning is
that PickLoads is _prepared to support_ eligible operations across the 48
contiguous states — not that it has customers, completed loads, offices or a
proven carrier network in all of them.

**Retained deliberately:** market spot-rate ranges in `src/content/states.ts`
such as "$2.40–$2.90/mi", which carry an explicit "Estimates, not promises"
qualifier. Decision C removed a PickLoads _performance statistic_; it did not
ban discussing market rates. A grep for "2.90" will find these — this line
exists so the next auditor knows it was a judgment, not an oversight.

## D1 · Referral program

`referral_program_active` **remains false**. No public reward amount or payout
promise. Gated until eligibility, reward amount, qualification, active-carrier
period, payout timing, exclusions and terms are approved.

## D2 · Careers

Approved positioning: **"We're building our team."**

No fabricated vacancies, no claim of active hiring, no CV/resume upload, no
recruiting database. General interest is accepted through the existing contact
architecture. The page states plainly that no roles are posted today — a growth
statement without it reads as active hiring, which would be a fabricated
vacancy by implication.

## D3 · Partners

Approved: **"Partner with PickLoads"**, inviting inquiries in factoring,
insurance, technology and logistics services. No named partners, logos,
discounts, commissions, affiliate relationships or endorsements. Terms are
agreed case by case. **Already compliant before this pass; verified, unchanged.**

## D4 · New Authority Program

**Operated by PICKLOADS LOGISTICS GROUP LLC.** Not Larocque Group.

The page now names the operator explicitly and states that PickLoads is not
FMCSA, USDOT or any government agency and cannot guarantee approval of any
application. The existing "document filing assistance only — not a law firm"
disclaimers are retained.

**"Larocque Group" was never present on this branch.** The only occurrence of
the name is "Emmanuel Larocque" as a named person on the About page, which is
the owner and is accurate. Naming the operating entity was still worth doing:
this is the one service where a customer could reasonably wonder whether they
are dealing with a filing agency, a law firm or a government portal.

## E · Testimonials and social proof

**No testimonial content exists on this branch and none was added.**
`getApprovedTestimonials()` returns `[]` by construction, `testimonials_visible`
is `false`, and the section renders nothing in either state. No invented
reviews, star ratings or review counts. Restore after genuine customer reviews
are collected.

Google Business Profile remains **EXTERNAL CONFIG REQUIRED** — no evidence of
creation exists in the repository.

---

---

## What the copy pass alone would have missed

Removing a claim from a component is not the same as removing it from the
artifact that gets deployed, and this pass found one place where the two had
come apart.

`src/i18n/request.ts` loaded locale catalogues through a template-literal
dynamic import, which makes webpack bundle **every** `.json` in `messages/` —
including `_key-index.json`, a generated slug→English map no application code
reads. The full pre-decision wording ("24/7 Dispatch", "RATE IN 1 HOUR", the
15-minute callback, the 24-hour first load) shipped inside the server bundle.

Nothing rendered it, and that is precisely what made it worth fixing rather
than filing: unreachable code carrying retired claims is invisible to page
review and visible to anyone who greps the deployment.

The catalogues are now imported explicitly, so no context module exists. Two
tests hold the line — one rejects a template-literal import in that file, one
scans the built server output for retired claims, with a non-vacuity control
proving the scan reads real bundle content.

Full detail, including the correction to the entry that originally asserted the
opposite: `COWORK-CONTENT-REVIEW.md`.

---

## Standing constraints, unchanged

- **`brokerage_active = false`, fail-closed.** DB trigger, RLS, server gate, UI
  gate and structured-data gate all intact and untouched.
- **No MC number, BMC-84 status or licensed-broker claim** is published. MC and
  USDOT render as "pending".
- **No legal document is manufactured.** Business inputs being known does not
  make a document approved.
- **No production deployment.**
- **`scripts/extract-i18n.mjs` was not run.** Its fail-closed guard is intact;
  locale changes in this pass were surgical, key by key.

## Translation status

English is the approved source copy as of this pass.

`es` and `fr` were authored for all 26 new strings. `ru` and `ht` mirror
English pending native review — the standing doctrine since M-42 — which raised
the ru/ht ratchet baselines by exactly 28 each.

That trade was deliberate and it is not a good one, only the better one: the
alternative was leaving "24/7 Dispatch" and a 15-minute callback guarantee live
in five languages because two of them lack a translator. Both states are
defects; only one is a claim the business cannot stand behind.

**These 28 strings are the priority list for native review** — they are
pricing, availability and legal-adjacent copy.
