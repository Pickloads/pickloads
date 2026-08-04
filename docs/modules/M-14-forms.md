# M-14 — Forms & Flows 1–2 (live lead capture)

**Status:** ✅ Complete · **Phase:** 1 · **Date:** 2026-08-04

## What was built
All four public forms are live end-to-end (audit F-05/F-08/F-12, decisions
Q3/Q4/Q6): quick carrier lead, shipper freight quote, contact message,
newsletter with double opt-in. Every submission runs the same server pipeline —
**rate limit → Turnstile siteverify → Zod → service-role insert → Resend
notification → email_log journal** — and every step degrades gracefully when
its secret is unset, so secretless dev/preview builds stay fully walkable.

## How (map)
- **Validation** — `src/lib/validation/{shared,carrier-lead,freight-quote,contact-message,subscriber}.ts`.
  Zod v4. Notables: weight `"42,000"` → number (cap 80k lbs), U-06 pickup-date
  floor re-checked server-side, locale `.catch("en")`, ZIP regex, optional
  fields normalize `""` → `null` (matches nullable columns).
- **Turnstile** — `src/lib/turnstile.ts`: server-side siteverify, **fails
  closed** on network/parse errors, skips with a warning when
  `TURNSTILE_SECRET_KEY` unset. Widget: `src/components/forms/TurnstileWidget.tsx`
  (`@marsidev/react-turnstile`) renders only when `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
  is set; it auto-injects the `cf-turnstile-response` hidden input.
- **Rate limiting** — `src/lib/rate-limit.ts`: `@upstash/ratelimit` sliding
  window **5 req / 10 min per IP per form** (prefix `rl:<form>`); no-op when
  Upstash env unset; **fails open** on Redis outage (Turnstile still gates —
  lead capture availability wins, S-03 note).
- **Email** — `src/lib/email/send.ts`: Resend wrapper; log-only when
  `RESEND_API_KEY` unset; always journals to `email_log` via
  `tryCreateAdminClient()` (additive helper in `src/lib/supabase/admin.ts` that
  returns null instead of throwing when the service key is unset). Send
  failures never fail the form action (row is already committed).
- **Templates** — `src/emails/`: `InternalNotification` shared layout +
  `LeadNotificationEmail`, `QuoteNotificationEmail`, `ContactNotificationEmail`,
  `NewsletterConfirmationEmail`. Colors are the V4 token hexes copied verbatim
  (`src/emails/theme.ts`) — raw hex is unavoidable in email HTML; no new colors.
  Quote/contact notifications set `reply-to` to the submitter (F-12: quick form
  is phone-only → internal notification only, no auto-reply).
- **Actions** — `src/app/actions/{carrier-lead,freight-quote,contact-message,newsletter}.tsx`
  (`"use server"`, `.tsx` for the React Email JSX). Shared guard:
  `src/lib/forms/guard.ts` (IP from `x-forwarded-for`, guard messages).
  Shared state: `src/lib/form-state.ts` (`FormState` for `useActionState`).
- **Wiring (U-03)** — QuickQuote, FreightQuoteForm, NewsletterForm, and the new
  ContactForm use `useActionState`: submit button gets `aria-busy` + disabled +
  "Sending…", success shows `.form-ok.show`, errors show `.form-err.show`
  (`role="alert"`). Locale travels as a hidden input (`useLocale()`), and
  `<select>` options carry canonical English `value`s so DB rows are
  locale-independent.
- **Contact form** — `src/components/forms/ContactForm.tsx` composed from the
  existing `.bigform` vocabulary (fields: name, email, phone, subject, message)
  in a new `.light` section on /contact (F-08; V4 sketched no contact form).
- **Newsletter double opt-in (S-05)** — `subscribeNewsletter` inserts (or
  re-uses) the row and emails the confirm link; idempotent and
  enumeration-safe (every valid submit shows the same "check your inbox").
  `GET /api/newsletter/confirm?token=<uuid>` validates `confirm_token`, stamps
  `confirmed_at`, and redirects to `/blog?newsletter=confirmed|invalid`, which
  NewsletterForm surfaces (via `useSearchParams`, hence the `<Suspense>` in the
  blog page).

## DB changes
Schema untouched. `src/lib/supabase/database.types.ts` was structurally fixed:
supabase-js's `GenericSchema` requires type aliases (interfaces lack implicit
index signatures) and a `Relationships` entry per table — without them every
query degenerates to `never`. Content is unchanged and still mirrors the
migrations 1:1.

## Endpoints
- Server actions: `submitCarrierLead`, `submitFreightQuote`,
  `submitContactMessage`, `subscribeNewsletter`.
- `GET /api/newsletter/confirm` (token → confirmed_at → redirect).

## Env vars (all optional in dev — graceful no-ops)
`TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY`,
`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`, `RESEND_API_KEY`,
`EMAIL_FROM`, `EMAIL_INTERNAL_TO`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SITE_URL` (confirm-link base). All already in `.env.example`.

## Deployment
Set the full env in Vercel; verify the Resend domain (SPF/DKIM) before launch
(launch-gate item). Turnstile keys per environment. Upstash: one Redis DB
shared by all forms (keys are prefixed).

## Verification
typecheck ✓ · lint ✓ · build ✓ (60 routes) · smoke: confirm route redirects
invalid→`?newsletter=invalid`, uuid-without-DB→dev-mode `confirmed`; contact
page renders the form; all guards warn-and-continue without secrets ✓

## Extension points
- M-23 CRM reads `carrier_leads`/`freight_quotes` (status defaults `new`).
- Auto-reply emails for email-bearing forms: add a second `sendEmail` call in
  the matching action + a localized template (F-12 follow-up).
- Unsubscribe route (M-33, before first campaign send): reuse `confirm_token`.
