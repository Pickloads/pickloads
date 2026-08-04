# M-56 — Shipper Portal Completion

**Status:** ✅ Complete · **Phase:** Upgrade · **Date:** 2026-08-04

## What was built

Navigation: **Overview / Request a Quote / My Quotes / Documents / Billing /
Support / Company Settings / Account Settings** (all customer strings via the
V4 bridge, authored es/fr).

| Surface | What it does |
|---|---|
| `/portal/shipper` (Overview) | Quote tiles (requests / pending review / quoted / booked) from the shared dual-path read; **Shipments & Tracking gated by `company_settings.brokerage_active`** — pre-brokerage it renders the honest "launching soon, you're on the early list" waitlist state (decision D1/D6), post-flip an honest "activates with your first booked shipment" empty state. Quick links + honest unlinked-legacy-account note. |
| `/portal/shipper/quotes/new` | The **full professional quote form** — every directive field: pickup/delivery company + address + city + state + ZIP (city/state/zip required), pickup date, delivery deadline (≥ pickup), commodity, weight, pallets, L/W/H dims, equipment (8 slugs + "not sure"), temp requirements (min/max °F, cross-checked), hazmat, frequency, special instructions (1000 cap), contact + phone. Server-validated Zod (`portal-quote.ts`); insert via service role AFTER session + per-user rate limit + **membership-verified `shipper_id`**, with the VERIFIED session email (audit §6.3 — never form input). Honest not-submitted state without env; ops email per request. |
| `/portal/shipper/quotes` | My Quotes with a **status timeline** per request (Received → In review → Quoted → Booked dots; Closed badged), deadline column, quoted rates. |
| `/portal/shipper/documents` | Honest state: shipment paperwork (rate cons/BOLs/PODs) isn't shipper-linked pre-brokerage — copy switches on `brokerage_active`, support fallback offered. |
| `/portal/shipper/billing` | Decision D6 honest placeholder — nothing is invoiced to shippers; no fake flow. |
| `/portal/shipper/support` (+`/[id]`) | M-55 thread machinery reused (D2), phone card. |
| `/portal/shipper/company` | Self-serve `shippers` row (name/industry/frequency/regions/phone/billing email — nothing regulated), service-role write after membership check. |
| `/portal/shipper/settings` | Shared M-55 account settings (password / language / email prefs). |

## DB changes

`0011_quote_fields.sql` (additive): `freight_quotes.pickup_company`,
`delivery_company`, `delivery_deadline`, `special_instructions`,
`contact_name` — the directive fields 0008 didn't carry. Validated on local
PG16 (column assertions; full 0001–0011 + seed chain green). No RLS changes.

## Shared plumbing

`src/lib/shipper-quotes.ts` extracts the M-32/M-53 dual-path read (membership
RLS with verified-email one-shot claiming / documented legacy email match)
so overview + quotes render from one source; the shipper-facing status map +
stage indices live beside it.

## i18n / tests

~55 supplemental strings (authored es/fr; ru/ht mirror EN) → catalog
**678 × 5**; M-32 shipper leftovers backfilled; slug-collision baseline 9
unchanged (three duplicates resolved by reusing existing-slug keys).
+6 unit tests (`portal-quote.test.ts`) → **102 unit**; 17 e2e green.

## Env / deployment

No new env vars. Apply 0011 with `supabase db push`. Extension: when
brokerage goes live, flip `brokerage_active` — tracking/documents copy
switches without a deploy; shipper billing needs its own module when real
shipper invoices exist.
