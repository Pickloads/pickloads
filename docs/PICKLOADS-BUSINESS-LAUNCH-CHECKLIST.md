# PickLoads business launch checklist

**Updated 2026-08-12**, after the owner's pre-launch business decisions were
applied to `final-website-production`.

Two tracks, deliberately separate. **Dispatch can launch without brokerage.**
Treating them as one programme is what makes the whole thing look blocked when
only half of it is — and it is the half that needs a federal licence.

Status vocabulary, used exactly:

|                              |                                                           |
| ---------------------------- | --------------------------------------------------------- |
| **READY**                    | Done and verified by something that fails when it breaks  |
| **NEEDS LEGAL**              | Waiting on counsel. Engineering cannot close it           |
| **NEEDS CONFIG**             | Waiting on an external account, key or asset              |
| **NEEDS BRAND ASSET**        | Waiting on artwork or photography                         |
| **NEEDS TRANSLATION REVIEW** | English approved; a native speaker has not reviewed ru/ht |
| **BLOCKED**                  | Cannot proceed until a named external event occurs        |

---

# Track 1 · Dispatch launch

The product is built. What remains is almost entirely _not code_.

## READY

| Item                                                          | Evidence                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| Public website — 434 pages, 5 locales                         | Production build clean                                   |
| Carrier onboarding — 4 steps, documents, portal               | Integration lane                                         |
| Carrier / shipper / broker portals                            | RLS 806 assertions                                       |
| Public tracking, driver token flow                            | Integration + RLS                                        |
| Dispatch pricing published — 5% / 4.5% / 8%                   | Single-sourced in `src/lib/pricing.ts`, enforced by test |
| Availability claims truthful (7 days + after-hours emergency) | Owner decision A1, enforced by test                      |
| Response-time claim hedged, not guaranteed                    | Owner decision A2, enforced by test                      |
| First-load timing contextual, not promised                    | Owner decision A3, single-sourced in `src/lib/copy/onboarding-timing.ts` and enforced by test |
| No fabricated testimonials, partners, vacancies or statistics | Owner decisions C/D2/D3/E, enforced by test              |
| New Authority operator named; disclaimers intact              | Owner decision D4, enforced by test                      |
| Referral programme gated off                                  | `referral_program_active = false`                        |
| Security posture — RLS, CSP, headers, rate limits, Turnstile  | RLS suite + integration + `npm audit` 0                  |
| Accessibility WCAG 2.2 AA                                     | axe, in a real browser, 12 breakpoints                   |
| Analytics taxonomy — closed, no PII, inert without a GA4 id   | Unit tests                                               |

## NEEDS LEGAL — the critical path

**Nothing here can be closed by engineering, and this is the longest lead time
on the entire launch. Start it first.**

| Document                             | Status                                                       |
| ------------------------------------ | ------------------------------------------------------------ |
| Dispatch Service Agreement           | **COUNSEL REQUIRED** — business inputs now known (see below) |
| Privacy Policy                       | COUNSEL REQUIRED                                             |
| Terms of Service                     | COUNSEL REQUIRED                                             |
| Cookie Policy                        | COUNSEL REQUIRED                                             |
| E-Sign Consent                       | COUNSEL REQUIRED                                             |
| New Authority Service Agreement      | COUNSEL REQUIRED                                             |
| New Authority disclaimer review      | COUNSEL REQUIRED                                             |
| Brokerage pre-launch language review | COUNSEL REQUIRED                                             |

**Inputs counsel now has that they did not before:**

- Dispatch fee tiers: **Owner-Operator 5% · Small Fleet (2–10) 4.5% · Box Truck
  / Hot Shot 8%**, charged on load gross, month-to-month, no charge on declined
  loads.
- Availability: dispatch support 7 days a week, after-hours emergency support.
  **No 24/7 staffed commitment.**
- Response time: "typically within the hour during business hours" — expressly
  **not** an SLA.
- New Authority operator: **PickLoads Logistics Group LLC**, document filing
  assistance only, no approval guarantee.

**Knowing the business inputs does not make a document approved.** These stay
COUNSEL REQUIRED until counsel returns approved text.

Until then `packet_downloads_live` stays `false` — and it must be flipped only
when the four packet PDFs are _approved_, not merely present.

## NEEDS CONFIG

| Item                                                                                 | Note                                          |
| ------------------------------------------------------------------------------------ | --------------------------------------------- |
| Supabase production project                                                          | URL, anon key, service-role key               |
| `NEXT_PUBLIC_SITE_URL`                                                               | Production domain                             |
| Resend — `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_INTERNAL_TO`                         | Transactional email                           |
| Cloudflare Turnstile keys                                                            | Absent → spam guard no-ops                    |
| Upstash Redis                                                                        | Absent → rate limiter disabled                |
| Stripe — secret + webhook secret                                                     | Dispatch-fee invoicing                        |
| `TRACKING_ACCESS_SECRET`, `DRIVER_TOKEN_SECRET`, `PII_ENCRYPTION_KEY`, `CRON_SECRET` | Generate fresh; never reuse a dev value       |
| GA4 measurement id                                                                   | Absent → the analytics taxonomy emits nothing |
| Sentry DSN                                                                           | Absent → monitoring inert                     |
| Dropbox Sign template                                                                | Blocked behind the approved agreement         |
| Google Business Profile                                                              | No evidence it exists                         |
| Booking URL, Maps embed key                                                          | Optional surfaces                             |

## NEEDS BRAND ASSET

| Item                       | Consequence if missing                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| PWA icons                  | Installable, but no tile artwork                                                                                            |
| Real PickLoads photography | Generic decorative visuals remain. **They must not be presented as PickLoads employees, office, fleet or carrier partners** |

## NEEDS TRANSLATION REVIEW

English is approved. `es` and `fr` are authored. **`ru` and `ht` mirror English**
for the 30 strings changed in this pass and for a large pre-existing backlog.

Two of the 30 are the A3 onboarding headline and its qualifier, and they are a
regression rather than a gap: the retired "On the road with us in 24 hours."
_had_ authored ru and ht values, so those two languages have traded a fluent
false promise for an accurate English one. The right trade, and still a debt.

Priority for a native reviewer, in order: **pricing · availability · FAQ ·
New Authority · legal-adjacent copy.**

## Remaining actions, in dependency order

1. **Engage counsel** — longest lead time, blocks launch. Hand over
   `OWNER-BUSINESS-DECISIONS.md` and `LEGAL-DOCUMENTS-REQUIRED.md`.
2. Create the production Supabase project and configure required secrets.
3. Configure Turnstile, Upstash, Resend, Stripe, GA4, Sentry.
4. Supply PWA icons and real photography.
5. Push to a remote so CI executes for the first time.
6. Deploy to staging; verify live integrations; run the Sentry privacy check in
   `LAUNCH-RUNBOOK.md`; capture real Core Web Vitals.
7. Native review of `ru` / `ht` for the priority categories.
8. Counsel returns approved documents → publish legal pages → upload the four
   approved packet PDFs → flip `packet_downloads_live`.
9. **Dispatch launches.**

---

# Track 2 · Brokerage launch — BLOCKED

**`brokerage_active` remains `false` and fail-closed.** This is not a
configuration oversight; it is the correct state until every item below is
real and verified.

The platform is built and gated. The gate holds at the database
(`trg_shipments_brokerage_gate` refuses to create a shipment), in RLS, in the
server actions, in the UI, and in the structured data — the `/shippers` page
withholds its `Service` JSON-LD node while the gate is shut, because a
machine-readable assertion that PickLoads brokers freight is harder to walk
back than a sentence.

## Blocking requirements — none of which are engineering

| Requirement                                                   | Status                                 |
| ------------------------------------------------------------- | -------------------------------------- |
| FMCSA broker authority (MC)                                   | **NOT OBTAINED**                       |
| BMC-84 surety bond ($75,000) or applicable financial security | **NOT OBTAINED**                       |
| Broker authority active and verifiable on FMCSA records       | **NOT OBTAINED**                       |
| Approved **Shipper-Broker Agreement**                         | **NO SHELL EXISTS** — counsel required |
| Approved **Broker-Carrier Agreement**                         | **NO SHELL EXISTS** — counsel required |
| Brokerage insurance / compliance requirements as applicable   | Not assessed                           |
| Contingent cargo / broker liability coverage as applicable    | Not assessed                           |
| Final legal review of all brokerage-facing copy               | COUNSEL REQUIRED                       |
| Process agent (BOC-3) for broker authority                    | Not confirmed                          |

## Activation rule

`brokerage_active` may be flipped to `true` **only** after:

1. Broker authority is granted and verifiable, **and**
2. The bond or financial security is filed and active, **and**
3. Both agreements exist in counsel-approved form, **and**
4. Brokerage-facing copy has passed legal review.

Flipping it is a **business owner decision**, not an engineering task. Nothing
in the codebase should be changed to make the page "look complete" before then.

**"Launching Soon" remains the correct public posture.** Do not publish an MC
number, a BMC-84 status or a licensed-broker claim without verified evidence.

---

## How the two tracks relate

Dispatch does not depend on brokerage. Every blocking item in Track 2 is a
federal licence, a bond or a contract — none is code, and none gets faster by
writing more of it.

The honest summary: **the website is essentially finished and the company is
not yet licensed to do half of what the website is built to do.** Track 1 can
launch as soon as counsel and configuration are done. Track 2 waits on the
FMCSA.
