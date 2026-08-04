# M-42 — Password recovery + supplemental i18n

## What

### Password recovery (`(auth)` group, V4 `.bigform`)

- `/forgot-password` — `ForgotPasswordForm` calls
  `supabase.auth.resetPasswordForEmail(email, { redirectTo:
  <origin>[/locale]/reset-password })`, preserving the visitor's locale
  (localePrefix "as-needed"). Always shows a neutral success message — never
  confirms whether an account exists (no enumeration).
- `/reset-password` — `ResetPasswordForm`. The browser client
  (`detectSessionInUrl`) exchanges the recovery code for a session on load;
  the form watches `getSession` + `onAuthStateChange`, warns when no
  recovery session exists (expired/used link), validates min-8 + match
  client-side, then `supabase.auth.updateUser({ password })`. Success keeps
  the recovery session and links to `/portal` (role-routed home).
- `/login` gains a "Forgot password?" link under the password field.
- Both pages: `robots: noindex`, minimal `(auth)` chrome, statically
  generated for all 5 locales (212 → 222 pages).

**Graceful degradation:** with placeholder/unset `NEXT_PUBLIC_SUPABASE_URL`
both forms refuse with a clear call-us message instead of firing network
calls (same `configured` check as `LoginForm`). Covered by two e2e tests.

**Supabase prerequisite (see LAUNCH-RUNBOOK):** the site URL and
`https://pickloads.com/*` must be in Auth → URL Configuration → Redirect
URLs, or `redirectTo` is ignored; customize the "Reset Password" email
template per brand.

### Supplemental V4-dictionary strings

`scripts/extract-i18n.mjs` gains a `SUPPLEMENTAL` module (10 strings): the
become-a-carrier hero subtitle + phone fallback line, and the
start-your-trucking-company launch-checklist copy ("Your launch checklist",
step titles, "Straight talk:", "Before you start"). Real es/fr translations;
**ru/ht intentionally mirror English pending native review** (`addEntry`
copies English for missing locales — flagged as a launch content
prerequisite). Portal/admin strings stay English by design. Regenerated
catalogs: 344 strings × 5 locales.

The new auth-page strings themselves ride the `useV4()` English fallback,
same as the login page.

## Gates

typecheck / lint / build (222 static pages) / `npm test` (76) /
`npm run test:e2e` (12, includes 2 new recovery tests) — all green.

No DB changes. No new env vars. Endpoints: the two new pages only.
