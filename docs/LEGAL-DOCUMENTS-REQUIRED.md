# Legal documents — status register

**Owner:** founder + counsel · **Engineering owner:** none (this is not an
engineering deliverable) · **Last verified:** 2026-08-12, after the owner's
pre-launch business decisions.

> **2026-08-12 — counsel is no longer blocked on business inputs.** The owner
> has fixed the dispatch fee tiers, the availability model, the response-time
> posture and the New Authority operating entity. See §2.4 and §2.9, and
> `OWNER-BUSINESS-DECISIONS.md` in full.
>
> **Not one document's status changed as a result.** Knowing what an agreement
> must say is not the same as having a lawyer say it. Everything below that was
> COUNSEL REVIEW REQUIRED still is.

> **This register exists so that nobody — engineer, founder or auditor — can
> mistake a placeholder for an executed agreement.** No document in the
> `COUNSEL REVIEW REQUIRED` state below may be presented to a customer,
> carrier or broker partner as operative. The application enforces the part it
> can (shells render their status, agreements refuse to send when unconfigured,
> legal pages are `noindex`); the rest is a business control and lives here.

**No AI-drafted legal text has been written into this repository, and none may
be.** Every shell states its own status in plain language instead of carrying
placeholder prose that could be mistaken for a draft. That is deliberate: an
invented Privacy Policy is worse than a missing one, because a missing one is
obviously missing.

---

## 1 · Summary

|                                                    | Count                                            |
| -------------------------------------------------- | ------------------------------------------------ |
| Documents identified                               | **10**                                           |
| Final approved content present                     | **0**                                            |
| Launch blockers (dispatch)                         | **5**                                            |
| Launch blockers (brokerage, additional)            | **2**                                            |
| Non-blocking but required before the surface ships | **3**                                            |
| Signing workflows implemented                      | **2** (carrier e-sign, broker account agreement) |
| Signing workflows with an approved template loaded | **0**                                            |

**Nothing here is blocked on engineering.** Every surface that consumes these
documents is built, tested and waiting for content.

---

## 2 · The register

### 2.1 · Privacy Policy

- **Purpose** — discloses what personal data the platform collects and why.
  Not optional: onboarding already collects EINs, W-9s, insurance certificates
  and driver contact details, and `/track` records tracking-lookup attempts.
- **Current status** — 📄 **COUNSEL REVIEW REQUIRED.** Shell only, at
  `/legal/privacy`, rendering an honest status line.
- **Where used** — footer on every page; cookie-consent banner
  (`ConsentAnalytics.tsx`) links to it before GA4 may fire; sitemap.
- **Launch blocker?** — 🔴 **YES, hard.** The site collects regulated personal
  and financial data today.
- **Counsel review required?** — Yes. Must cover: Supabase (US) as processor,
  Resend, Stripe, Dropbox Sign, Cloudflare Turnstile, Upstash, Vercel, GA4;
  document retention; the §9 location-retention window (default 90 days,
  configurable — see `docs/modules/M-80-map-providers.md`); tracking-access
  logging under §19.
- **Final approved content present?** — No.
- **Signing workflow** — n/a (published, not signed).

### 2.2 · Terms of Service

- **Purpose** — the contract governing use of the website and portals.
- **Current status** — 📄 **COUNSEL REVIEW REQUIRED.** Shell at `/legal/terms`.
- **Where used** — footer; referenced at account creation.
- **Launch blocker?** — 🔴 **YES.** Accounts are being created and freight
  quotes accepted.
- **Counsel review required?** — Yes. Must address the dispatch/brokerage
  distinction explicitly — PickLoads is an agent in one and a broker in the
  other, and conflating them in the ToS conflates the liability.
- **Final approved content present?** — No.
- **Signing workflow** — click-acceptance at signup. **Not yet implemented**;
  it should not be implemented until the text exists, or the first accepting
  user accepts a placeholder.

### 2.3 · Cookie Policy

- **Purpose** — what is set, by whom, for how long.
- **Current status** — 📄 **COUNSEL REVIEW REQUIRED.** Shell at `/legal/cookies`.
- **Where used** — footer; the consent banner links to it.
- **Launch blocker?** — 🔴 **YES**, in the narrow sense that the consent banner
  points at a page with no policy on it. GA4 is already consent-gated in code.
- **Counsel review required?** — Yes.
- **Final approved content present?** — No.

### 2.4 · Dispatch Service Agreement (carrier ← → PickLoads, dispatch pillar)

- **Purpose** — the operative agreement for the **dispatch** business: scope of
  the agency relationship, the dispatch fee, term and termination.
- **Current status** — 📄 **COUNSEL REVIEW REQUIRED.** Shell at
  `/legal/dispatch-agreement`. The **signing workflow is fully built**.
- **Business inputs — supplied by the owner 2026-08-12.** Counsel was
  previously blocked on not knowing what the agreement had to say. It now has:

  | Input                         | Value                                                                        |
  | ----------------------------- | ---------------------------------------------------------------------------- |
  | Owner-Operator fee            | **5% of load gross**                                                         |
  | Small Fleet (2–10 trucks) fee | **4.5% of load gross**                                                       |
  | Box Truck / Hot Shot fee      | **8% of load gross**                                                         |
  | Basis                         | Percentage of gross per load, snapshotted at booking                         |
  | Term                          | Month to month, cancel any time                                              |
  | Declined loads                | No charge                                                                    |
  | Forced dispatch               | None — the carrier approves every load                                       |
  | Setup / monthly minimum       | None                                                                         |
  | Support commitment            | Dispatch support 7 days a week + after-hours emergency. **Not** 24/7 staffed |
  | Response-time posture         | "Typically within the hour during business hours" — expressly **not** an SLA |

  Rates are single-sourced in `src/lib/pricing.ts`; the published site cannot
  disagree with this table without failing a test.

  **This does not advance the document's status.** Knowing what a contract
  should say is not the same as having a lawyer say it. It remains COUNSEL
  REVIEW REQUIRED, and the fee schedule in the executed agreement is counsel's
  and the owner's to finalise — the table above is what the _website_ currently
  publishes, which counsel needs in order to keep the two consistent.

- **Where used** — `/legal/dispatch-agreement`; the carrier onboarding wizard
  and `/portal/carrier/agreements` send it for signature.
- **Launch blocker?** — 🔴 **YES.** This is the document the dispatch business
  is transacted on.
- **Counsel review required?** — Yes, and it must be **uploaded to Dropbox Sign
  as a template**; the app references it only by `DROPBOX_SIGN_TEMPLATE_ID`.
- **Final approved content present?** — No.
- **Signing workflow** — ✅ implemented (Dropbox Sign), ⚠️ **no template
  loaded**. Without `DROPBOX_SIGN_API_KEY` + `DROPBOX_SIGN_TEMPLATE_ID`,
  `sendAgreementSignatureRequest` returns `esign_not_configured` and the UI
  says so. **It cannot accidentally send a placeholder** — there is nothing to
  send. Executed copies return as signed-URL downloads; the webhook records
  `signed_at`.

### 2.5 · Carrier Agreement

- **Purpose** — listed separately from the Dispatch Agreement in the site's own
  legal shells. **Counsel must decide whether these are one document or two**;
  the codebase currently exposes both slugs.
- **Current status** — 📄 **COUNSEL REVIEW REQUIRED.** Shell at
  `/legal/carrier-agreement`.
- **Launch blocker?** — 🔴 **YES** if it is a distinct instrument; otherwise
  the slug should be retired and redirected rather than left as a live page
  implying a document that does not exist.
- **Final approved content present?** — No.

### 2.6 · Broker-Carrier Agreement _(brokerage pillar)_

- **Purpose** — the operative agreement between PickLoads as **licensed broker**
  and each hauling carrier. Distinct from the dispatch agreement in kind, not
  degree: different authority, different liability, different insurance.
- **Current status** — ❌ **NOT DRAFTED, NO SHELL.** No page, no slug.
- **Where used** — nowhere yet. Required before any shipment is tendered to a
  carrier under brokerage authority.
- **Launch blocker?** — 🔴 **YES for brokerage**, not for dispatch. Gated
  behind the same `brokerage_active` flag as the rest of the pillar.
- **Counsel review required?** — Yes.
- **Signing workflow** — none. Would reuse the Dropbox Sign path with a second
  template id.

### 2.7 · Shipper-Broker Agreement _(brokerage pillar)_

- **Purpose** — the operative agreement between PickLoads and each shipper
  whose freight it brokers: rates, credit terms, liability, claims.
- **Current status** — ❌ **NOT DRAFTED, NO SHELL.**
- **Launch blocker?** — 🔴 **YES for brokerage.**
- **Counsel review required?** — Yes.
- **Signing workflow** — none.

### 2.8 · Broker-partner access agreement _(M-81)_

- **Purpose** — governs a **broker partner organisation's** standing access to
  another party's shipment data. The data model is real: `broker_account_
agreements` records one organisation's bounded access to one shipper's
  freight, with a start, an optional end, and revocation that closes every
  shipment under it at once.
- **Current status** — ⚠️ **MODEL BUILT, TEXT MISSING.** The table, RLS, grants
  and audit trail exist and are proved by the RLS suite; the paper the row
  represents does not.
- **Where used** — `/portal/admin/brokers`, `/portal/broker/*`.
- **Launch blocker?** — 🔴 **YES for broker-partner access specifically.** A row
  asserting a signed agreement that does not exist is worse than no row.
- **Counsel review required?** — Yes. Must state what the partner may see —
  §12 already forbids margin, commission and unrelated shipments, and the DTO
  enforces it, but the enforcement should follow the contract rather than
  precede it.
- **Final approved content present?** — No.

### 2.9 · New Authority Program disclaimers

- **Purpose** — keep the startup-assistance offering clearly **outside** the
  practice of law.
- **Current status** — ✅ **PRESENT AND CORRECT, pending counsel sign-off on
  wording.** Rendered on `/start-your-trucking-company` and the equipment
  dispatch pages: _"Document filing assistance only — we are not a law firm and
  do not provide legal advice."_
- **Launch blocker?** — 🟠 **No**, but counsel should confirm the wording is
  sufficient in every state the programme is marketed in.
- **Final approved content present?** — Wording exists and is honest; not
  formally reviewed.
- **Owner decision D4, 2026-08-12 — the operating entity is now stated.** The
  programme is operated by **PickLoads Logistics Group LLC**, and the page says
  so. Two sentences were added to the prominent disclaimer band:

  > "The New Authority Program is operated by PickLoads Logistics Group LLC."
  >
  > "We are not FMCSA, USDOT or any government agency, and we cannot guarantee
  > approval of any application."

  **Why this was worth adding even though nothing was wrong.** This is the one
  service where a customer could reasonably be confused about _who they are
  dealing with_ — filing agencies, law firms and the FMCSA's own portal all
  occupy the same space, and several of the paid ones are deliberately vague
  about which they are. The disclaimer already said what PickLoads is not; it
  did not say who PickLoads is, or that approval is the government's decision.

  **For counsel:** confirm the entity name, the assistance-only framing and the
  no-approval-guarantee language are sufficient, and whether any state in which
  the programme is marketed requires additional disclosure for
  business-formation assistance.

### 2.10 · Website disclaimers + document authorisation language

- **Purpose** — (a) rate estimates and transit times are estimates, not offers;
  (b) the authority a user grants when uploading W-9s, insurance certificates
  and signing on another party's behalf.
- **Current status** — ⚠️ **PARTIAL.** The honest-states discipline covers most
  of (a) — MC/USDOT render as pending, no fabricated statistics, ETAs are
  labelled with their source and never called AI-powered or live. (b) has **no
  explicit authorisation language** at the upload step.
- **Launch blocker?** — 🟠 **P1.** Not a hard blocker for dispatch, but the
  upload step should carry an authorisation line before it is used at scale.
- **Counsel review required?** — Yes for (b).

---

## 2b · A packet-gate finding (2026-08-11, Downloads Center)

`PACKET_DOC_PATH` (M-69, `src/components/sections/Packet.tsx`) maps four public
paths under `/packet/`, and **one of them is the Dispatch Agreement**:

```
"Dispatch Agreement":      "/packet/dispatch-agreement.pdf"
"W-9 Form":                "/packet/w-9.pdf"
"Insurance Requirements":  "/packet/insurance-requirements.pdf"
```

Flipping `company_settings.packet_downloads_live` publishes all four as public
downloads. **The Dispatch Agreement is §2.4 of this register — COUNSEL REVIEW
REQUIRED, no approved content.** Flipping the flag before counsel delivers
would put a placeholder agreement on a public URL as a finished document.

The risk is contained today and the containment is deliberate: the flag is
seeded `false`, `public/packet/` is empty, the runbook records that the four
approved PDFs must be uploaded _first_, and the Downloads Center offers no
packet download in either flag state. A unit test asserts the seeded default is
still false; an e2e test asserts `/packet/` never appears in the public HTML.

**Action for whoever flips that flag:** confirm against this register that all
four documents have approved content — not merely that four files exist.

## 3 · What the code already prevents

Stated because the register would otherwise read as if nothing is guarded:

- **No placeholder can be executed as a contract.** The e-sign path refuses to
  send without an uploaded template — there is literally no document to
  transmit, so the failure mode is "nothing happens and the UI says so", not
  "a blank agreement gets signed".
- **Legal pages are `noindex`** until real content lands, so a shell cannot be
  surfaced by search as if it were the policy.
- **No invented legal prose** exists anywhere in the repository.
- **Brokerage is fail-closed** at the database: `trg_shipments_brokerage_gate`
  refuses to create a shipment while `company_settings.brokerage_active` is
  false, so the two documents whose absence matters most (2.6, 2.7) cannot be
  needed before they exist.
- **Consent gating** already prevents GA4 firing before the cookie banner is
  answered.

## 4 · Recommended order

Counsel time is the longest lead item on the entire launch path — longer than
any remaining engineering.

1. **Privacy Policy, Terms of Service, Cookie Policy** — required by the data
   the site collects _today_, regardless of which pillar launches first.
2. **Dispatch Service Agreement** (+ resolve whether Carrier Agreement is a
   separate instrument), then upload it to Dropbox Sign as a template and set
   `DROPBOX_SIGN_TEMPLATE_ID`.
3. **Document authorisation language** for uploads.
4. **Broker-Carrier and Shipper-Broker Agreements** — on the brokerage
   critical path, alongside the MC authority and BMC-84 bond, not before.
5. **Broker-partner access agreement** — before the first partner is invited.

---

_Engineering has no further work here. Every consuming surface is built and
tested; each is waiting on approved text._
