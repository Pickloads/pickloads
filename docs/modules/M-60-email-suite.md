# M-60 — Customer Email Suite (localized) + Portal Notifications

**Status:** ✅ Complete · **Phase:** Upgrade · **Date:** 2026-08-04

Completes the React Email set per the directive: 15 customer-facing template
builders, locale-aware per recipient, wired into every existing flow with
`email_log` journaling and `notifications` rows for the portal feeds.

## Architecture

- `src/emails/i18n.ts` — `EmailLocale` (en/es/fr/ru/ht), `resolveEmailLocale`
  (unknown → en), `pick()` (es/fr authored; **ru/ht mirror en, ⚠ flagged for
  native review** — M-42 precedent), shared localized footer, `BuiltEmail`
  contract `{subject, template, react}`.
- `src/emails/CustomerEmail.tsx` — shared customer layout (V4 night band +
  amber rule on paper, paragraphs, definition rows, amber CTA, localized
  dispatch-desk footer, `<Html lang>`), same token hexes as `theme.ts`.
- `src/emails/customer-templates.tsx` — the builders. Recipient language:
  `profiles.preferred_language` for known accounts, form locale otherwise.
- `src/lib/notify.ts` — `notifyCustomer()` = notifications row (localized
  title from the email subject) + email + email_log in one best-effort call;
  `getRecipientByProfile` (auth admin API for address — profiles carries no
  email — + preferred_language), `getCarrierOwnerRecipient` (owner membership
  first, `carriers.profile_id` legacy fallback per M-57),
  `getShipperOwnerRecipient`.

## Verify-email note (directive)

Auth emails (confirm signup, password reset, magic link) are **sent by
Supabase Auth**, not the app — there is deliberately no app-side template.
Branding them = customizing the Supabase dashboard templates
(Authentication → Emails); subjects/bodies per locale are documented in
`docs/LAUNCH-RUNBOOK.md` §Supabase email templates (M-62).

## Templates × wiring (all with email_log; ✉=email, 🔔=notifications row)

| Template | Wired into | Fan-out |
|---|---|---|
| `welcome-carrier` / `welcome-shipper` | `/create-account` signups (`account.tsx`) — signup locale | ✉ |
| `onboarding-started-customer` | wizard step 1 (`startOnboarding`) | ✉ |
| `documents-received` (batch) | wizard completion (`completeOnboarding`) — per-file emails during the anonymous wizard would spam | ✉ |
| `documents-received` (per doc) | authenticated portal replacement uploads (`uploadCarrierDocument`, claimed carriers only) | ✉ 🔔 |
| `document-approved` / `document-rejected` | staff review (`reviewDocument`) → carrier owner | ✉ 🔔 |
| `agreement-sent` | wizard e-sign send + portal re-send (`requestAgreementResend`) | ✉ 🔔 (re-send path) |
| `agreement-signed` | Dropbox Sign webhook signed events (fires once — the `agreement_signed_at is null` guard also dedupes the email) | ✉ 🔔 |
| `carrier-approved` | **new** `setCarrierActive` admin action (below) | ✉ 🔔 |
| `quote-received` | portal quote submit (verified session email) + public freight-quote form (form email/locale) | ✉ (portal feed already shows the request) |
| `quote-status-updated` | **new** staff quote desk (below) — only on shipper-visible stage/rate changes; portal shippers get feed+email, public submitters email-only in their form locale | ✉ 🔔 |
| `invoice-issued` | `generateLoadInvoice` (billing profile language; Stripe's own email carries the payment link, ours the context + portal trail) | ✉ 🔔 |
| `payment-received` | Stripe webhook `invoice.paid` (idempotent via the `webhook_events` gate) | ✉ 🔔 |
| `payment-failed` | Stripe webhook `invoice.payment_failed` (ops alert kept) | ✉ 🔔 |
| `support-confirmation` | `createSupportThread` | ✉ |
| `support-reply` | `staffReplyToSupportThread` → thread owner, deep link to the thread | ✉ 🔔 |

## New staff surfaces (the two flows the directive's emails needed)

1. **`/portal/admin/quotes` — freight-quote desk** (staff; nav item added).
   Until now `freight_quotes.status` was DB-only, so "status-updated" had
   nothing to hang off. `updateFreightQuote` (`actions/quotes.ts`): staff
   gate → Zod (`validation/quotes.ts`) → cookie-bound update ("staff update
   quotes" RLS re-checks) → `audit_events` (`quote.status_change`) →
   notification. `QUOTE_STAGE_MAP` (lead_status → shipper stage) is
   unit-pinned against the M-56 timeline (`QUOTE_STATUS`).
2. **Carrier activation** on `/portal/admin/users`: `setCarrierActive`
   (admin-only, service role, `.neq("active", …)` no-op guard,
   `carrier.activate/deactivate` audit) + `CarrierActiveToggle` button.
   Activation sends `carrier-approved`.

## Tests

`tests/unit/emails.test.ts` (+8 → **139 unit**): locale resolution +
fallback, ru/ht mirroring, per-locale subjects, doc-label localization,
review template ids, stage-label usage, USD formatting, stage-map parity.
`vitest.config.ts` gains `esbuild.jsx: "automatic"` (template .tsx imports).
37 e2e green.

## Notes / extension points

- No DB or env changes (uses 0005 `preferred_language`, 0007
  `notifications`, existing `email_log`).
- All fan-out is best-effort AFTER the business write commits — an email or
  feed failure logs loudly, never fails the action.
- New event → add a builder in `customer-templates.tsx` (en/es/fr; ru/ht
  come free via `pick`) and call `notifyCustomer` with the owner-recipient
  helper. Authoring ru/ht later = filling dictionaries only.
