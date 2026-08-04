# M-12 — Interior Pages

**Status:** ✅ Complete (visual check vs V4: pass) · **Phase:** 1 · **Date:** 2026-08-04

## What was built
- `(site)` route group layout — shared chrome (Topbar/SiteNav/Footer/PortalToast/CallFab) extracted from the home page; every public page now composes inside it.
- `PageHero` — the V4 interior-hero pattern as a reusable component.
- **/about** — story, founder card (monogram until the photo shoot — arch §9), mission band, values, CTA. 
- **/shippers** — why-cards, `FreightQuoteForm` (all 12 V4 fields, U-02 label association, U-06 `min` date floor, autocomplete attrs), shipper process flow.
- **/faq** — carrier + shipper accordions rendered from typed arrays (single source for M-15's `FAQPage` JSON-LD), CTA band.
- **/blog** — V4 sample cards behind an explicit launch-checklist exclusion (M-33 swaps in the `posts` query), `NewsletterForm` with double-opt-in success copy (S-05).
- **/contact** — contact cards, **keyless Google Maps iframe embed** (replaces the V4 placeholder per its own production note; no API key needed, CSP already allows the frame), social links inert until profiles exist.
- **/legal/[doc]** — 5 statically-generated shells (privacy, terms, cookies, carrier-agreement, dispatch-agreement) with honest "being finalized with counsel" copy, `noindex` until real content lands. **External dependency: lawyer.**
- **/not-found** — 404 in V4 vocabulary ("This lane doesn't exist.").
- All remaining V4 CSS (about/shippers/faq/blog/contact) ported into `v4.css` with the prototype's exact responsive rules.

## Route table (all static)
`/` `/about` `/blog` `/contact` `/faq` `/shippers` `/legal/{privacy,terms,cookies,carrier-agreement,dispatch-agreement}` + 404

## Deviations / judgment calls
- Contact map: real embed instead of V4's dashed placeholder — the placeholder's own note called for exactly this in production. Displays a blank frame in offline environments only.
- FAQ/blog data lives in typed arrays pending M-15 (JSON-LD) and M-33 (CMS) — single-source by design.

## Verification
typecheck ✓ · lint ✓ · build ✓ (11 routes, all prerendered) · full-page screenshots of all 5 pages vs V4 ✓

## Extension points
M-13 wraps everything in `[locale]/`; M-14 wires the two forms + contact form addition; M-15 adds JSON-LD + sitemap; M-16 fills `/dispatch/[equipment]`.
