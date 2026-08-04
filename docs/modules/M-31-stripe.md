# M-31 — Stripe billing (dispatch fee only)

**Status:** ✅ Complete · **Phase:** 3 · **Date:** 2026-08-04

## The compliance rule (read this first)

**PickLoads invoices ONLY its dispatch fee.** The invoice line item is
`loads.dispatch_fee` — the F-03 snapshot (gross × fee_pct_applied), never the
gross rate. Freight money moves broker → carrier/factoring directly and
**never transits a PickLoads account**. This is stated in `src/lib/stripe.ts`
(the only place a Stripe client can be built), enforced by the invoice action
(single line item, amount = dispatch_fee), and displayed on the admin loads
board so staff internalize it.

## What was built

### `src/lib/stripe.ts`
`isStripeConfigured()` + `tryCreateStripe()` — graceful no-op without
`STRIPE_SECRET_KEY` (same degradation pattern as esign/admin/email): build
and runtime never throw, UI shows an honest "Stripe not connected" state.

### `generateLoadInvoice` server action (`src/app/actions/billing.ts`)
Staff-only, on a **delivered** load with a positive fee:
1. Resolve the carrier's billing email = their portal login email
   (auth.users via the admin auth API — profiles has no email column).
2. Reuse-or-create the Stripe customer (keyed by email, carrier_id in
   metadata).
3. Create invoice: `collection_method=send_invoice`, net-7,
   `metadata.load_id` (the webhook join key), one invoice item for the
   dispatch fee → finalize → `sendInvoice` (**Stripe emails the hosted
   payment link** — no custom payment email to maintain).
4. Journal to `webhook_events` (provider `stripe`, event_type
   `invoice_created`, event_id `invoice_created:<invoice_id>`, payload
   `{load_id, carrier_id, invoice_id, hosted_invoice_url, amount_usd,
   to_email}`) — the audit ledger the payment-history table renders. **No
   schema change and no column misuse**: Stripe stays the billing source of
   truth; the ledger is for idempotency, history and the M-34 notifications
   feed.
5. Load `delivered → invoiced` through the cookie-bound client (RLS +
   M-30 state machine).

### `/api/stripe/webhook`
Signature-verified with `constructEventAsync` + `STRIPE_WEBHOOK_SECRET`;
idempotent via the `webhook_events (provider, event_id)` unique key (S-02,
same contract as the M-22 e-sign webhook). `invoice.paid` → guarded
`invoiced → paid` on the load via `metadata.load_id`, payload trimmed to the
renderable fields. `invoice.payment_failed` → archived + ops alert email.
Any processing failure → `status=failed` + `WebhookFailureEmail` + non-200
so Stripe retries.

### Admin loads board additions
"Invoice $X" (green) button on delivered rows with inline error reporting,
and a **Billing — Stripe payment history** table (last 25 stripe ledger
rows: event, invoice id linked to the hosted invoice, load, amount, status)
with the compliance rule printed above it.

## Security / client-use rules (Q3)
Cookie-bound client for load reads and the status update (staff RLS gates
again). Admin client only where the anon key cannot go: the auth email
lookup and the `webhook_events` insert (service-role-only table by design,
S-02) — plus the webhook route itself, which has no user session. Webhook
raw body is signature-verified before anything is stored; payload fields are
Zod-validated before use.

## Judgment calls
- **Stripe Invoices (hosted invoice page) instead of Payment Links**: an
  invoice carries the itemized fee, its own receipt/dunning emails, and a
  hosted payment page (cards + bank debits per dashboard settings). A
  separate Payment Link object would duplicate that with less accounting
  fidelity.
- Billing email = portal login email. A carrier wanting a different AP email
  is a Stripe-dashboard customer edit; a dedicated billing_email column is a
  future migration if it recurs.
- `invoice.payment_failed` alerts ops but does not touch load status —
  Stripe dunning retries; the load stays `invoiced` (true).
- Ledger-write failure after a successful Stripe send logs loudly but
  doesn't fail the action: the invoice exists in Stripe (source of truth).

## DB changes
None. `webhook_events` used as designed (S-02).

## Endpoints
`POST /api/stripe/webhook` · server action `generateLoadInvoice`.

## Env vars
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (already in `.env.example`;
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` remains unused — no client-side Stripe
surface). Webhook endpoint to register in the Stripe dashboard:
`https://pickloads.com/api/stripe/webhook`, events `invoice.paid`,
`invoice.payment_failed`.

## Verification
typecheck ✓ · lint ✓ · build ✓ (webhook route present, portal excluded from
sitemap/prerender) · unconfigured-env path returns honest errors/503s ✓
