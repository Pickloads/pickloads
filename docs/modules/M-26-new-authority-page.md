# M-26 — New Authority Funnel (/start-your-trucking-company)

**Status:** ✅ Complete · **Phase:** 2 · **Date:** 2026-08-04

## What was built
The dedicated New Authority page (arch route list, audit F-10 mapping),
composed 100% from V4 vocabulary:

1. **PageHero** reusing the section's own dictionary strings ("No MC yet?
   We'll launch you — then dispatch you.") so all 5 locales work day one.
2. **Prominent disclaimer band** right under the hero (`.boards-strip`
   vocabulary, `role="note"`): *"Document filing assistance only — we are not
   a law firm and do not provide legal advice."* The disclaimer appears
   **three times** on the page (band, panel above the form, form footer) —
   legal checklist item.
3. **Home `NewAuthority` section reused verbatim** (program details, "why
   launch with a dispatch company" comparison, zero-to-first-load flow).
4. **Launch checklist** — light `.steps` timeline with honest timing
   (days 1–5 formation → ≈21-day FMCSA vetting → insurance in parallel →
   same-week dispatch handoff). Original copy per F-10's allowance for
   dedicated-page content.
5. **Lead form** (`NewAuthorityLeadForm`, `.bigform`): name, phone
   (required), optional email, home state, planned equipment, launch stage —
   posting through the **extended `submitCarrierLead`** pipeline (rate limit
   → Turnstile → Zod → service-role insert → notification).
6. **Service JSON-LD** describing the program (with the disclaimer in the
   description) + canonical/hreflang via `pageMetadata`.

## Action/schema extension (per spec)
`carrierLeadSchema` + `submitCarrierLead` now accept:
- `lead_type` (`dispatch` | `new_authority`, `.catch("dispatch")` — the
  existing QuickQuote form needs no change),
- optional `full_name` / `email`,
- `stage` — **not a DB column** (schema is final): journaled as a
  `lead_activities` note ("Self-reported stage: …") so the CRM timeline
  opens with context.
New-authority inserts get `source='new_authority_page'` and the automatic
`new-authority` tag (arch "auto-tag") — the M-23 Kanban already filters and
badges them. The internal notification email now shows lead type, name,
email and stage.

## Site integration
- `PUBLIC_ROUTES` → sitemap: 5 locale entries + hreflang alternates
  (verified: 35 references in sitemap.xml).
- Footer "Start Your Trucking Company" links the page (was a home anchor).

## DB changes
None. Writes: `carrier_leads` (+ `lead_activities` stage note).

## Endpoints
None new (extends `submitCarrierLead`).

## Env vars
None new.

## Verification
typecheck ✓ · lint ✓ · build ✓ (147 pages) · runtime smoke: 200 on
`/start-your-trucking-company` + `/es/…` + `/become-a-carrier` + `/login`;
`/portal*` → 307 `/login?next=…`; disclaimer present in HTML; sitemap
contains the route ✓

## Extension points
- "Auto-transition to onboarding on activation" (arch): when a
  new-authority lead's MC activates, staff moves the lead to `agreement` and
  sends them to `/become-a-carrier` — an automated email nudge can hook the
  status-change journal later.
- Checklist tracking per lead (which filings are done) would need a
  Phase 3 table or a `tags` convention — deliberately not shoehorned into
  the frozen schema.
