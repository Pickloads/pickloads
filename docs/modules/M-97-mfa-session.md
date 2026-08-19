# M-97 — MFA verification no longer logs the admin out

**Branch:** `final-website-production` · **Baseline:** M-96 (`d11df16`)
**Status:** fixed, committed locally, **not pushed, not deployed**.

Follow-up to M-96 (the QR was undecodable). With the QR fixed, the flow got one
step further and failed at the end: a correct 6-digit code produced
`POST /portal/admin/mfa → 303 → /login`.

---

## 1. Root cause

**A best-effort audit row was sitting on the critical path of an auth
transition, holding the power to redirect.**

`recordMfaEnrollment` was a **Server Action**. A Server Action called from a
client component POSTs to the **current route** and Next re-renders that route
with the response. The current route is `/portal/admin/mfa`, whose first line
is `requireStaffNoMfa()` → `requireProfile()` → `redirect("/login")` when the
request carries no readable session.

```
mfa.verify() succeeds
  → Supabase rotates the auth cookies client-side (AAL1 token → larger AAL2 token)
  → journal POST fires immediately, mid-rotation
  → Next re-renders /portal/admin/mfa
  → requireStaffNoMfa() finds no session → redirect("/login")
  → the action POST is answered 303
  → the browser follows it
  → the admin lands on /login having just completed MFA correctly
```

The audit write itself never failed, and MFA itself was never broken. The
303 was Next answering a Server Action that redirected — which is why the
status was 303 and not the 307 the middleware emits.

## 2. Why 303 → /login, specifically

Three things had to line up, and they are worth separating because only one of
them was a defect:

| | |
|---|---|
| **303** | how Next answers a Server Action whose render called `redirect()`. Middleware redirects are 307. The status alone said "a server action redirected", not "middleware rejected you". |
| **/login** | `requireProfile()`'s redirect target. The page gate, doing its job. |
| **no session on that request** | the cookie rotation. `@supabase/ssr` chunks the auth cookie, and the AAL2 token (carrying `aal` and `amr`) is longer than the AAL1 one, so the chunk set changes at exactly that moment. |

The fix does not try to win the race. It removes the redirect from the path, so
the race stops mattering: whatever the cookie state is on that request, the
worst outcome is a missing audit row.

## 3. The getSession() warning

> Using the user object as returned from `supabase.auth.getSession()` … could be
> insecure. Use `supabase.auth.getUser()` instead.

**Not from application code.** The only `getSession()` in `src/` is in
`ResetPasswordForm.tsx`, a client component, where it is correct. The warning
came from inside `auth-js`: `getAuthenticatorAssuranceLevel()` reads the stored
session, and on the server auth-js wraps `session.user` in a proxy that warns on
first property access (`insecureUserWarningProxy`, `lib/helpers.ts`).

It was pointing at something real. `getMfaState()` decided whether **MFA is
satisfied** from a session nothing had authenticated — cookies are storage, and
storage can say anything.

Fixed by calling `supabase.auth.getUser()` **first**, which contacts the Auth
server and validates the token. That also silences the warning legitimately:
auth-js sets `suppressGetSessionWarning = true` after a successful `getUser()`
(`GoTrueClient.ts:3214`), so the warning stops because the thing it warned
about stopped.

**Fail-closed on the new branch.** When the project is configured but the
request carries no authenticated user, `getMfaState` now reports the role's real
requirement with `satisfied: false`. It deliberately does **not** return
`unconfigured()`, which reports `satisfied: true` — correct only when there is
no auth service to consult, and a bypass anywhere else.

## 4. Cookie / session fix

Nothing writes cookies by hand, and the `@supabase/ssr` contract is unchanged —
`updateSession` in `src/lib/supabase/middleware.ts` was already correct
(`getUser()`, cookies copied onto the response). The fix is architectural:

**`recordMfaEnrollment` (Server Action) → `POST /api/portal/mfa-journal`
(Route Handler).**

A route handler:

* renders no page, so no page gate can fire;
* is outside the middleware matcher (`/((?!api|…))`), so no middleware redirect
  can fire either;
* returns a status code and nothing else.

It keeps every check the action had: identity re-derived from cookies via
`getUser()` (never the body), staff-role required, body limited to one value
from a two-item enum. It gains a same-origin check, because an endpoint that
writes to the security ledger should not accept a cross-site POST. It answers
**204 whether or not the caller is staff** — a journalling endpoint should not
be an oracle for who is signed in.

The client call is `try/catch`-wrapped and best-effort: the factor is already
active by then, so a failed journal entry must never cost the user their
navigation.

## 5. AAL2 flow, preserved

```
authenticated admin at AAL1
  → mfa.enroll (browser client, caller's own user)
  → mfa.challenge + mfa.verify   ← mints the AAL2 token into this browser's cookies
  → POST /api/portal/mfa-journal (best effort, cannot redirect)
  → window.location.assign(returnTo)   ← full navigation, so the SERVER re-reads
  → requireStaff() → getMfaState() → getUser() validates → currentLevel "aal2"
  → satisfied → /portal/admin renders
```

Unchanged and unweakened: `admin` is still hard-required at AAL2 with no grace,
`requireStaff`/`requireAdmin` still gate every staff route, enrollment still
grants nothing on its own (every staff surface reads `profiles.role` first), and
no client-side value participates in an access decision.

## 6. Files changed

```
src/app/api/portal/mfa-journal/route.ts   NEW — the journal, as a route handler
src/app/actions/security.ts               DELETED — superseded (its only caller moved)
src/components/portal/MfaEnrollment.tsx   fetch the route instead of the action
src/lib/mfa.ts                            getUser() before any AAL decision; fail closed
tests/unit/mfa-enrollment.test.tsx        +9 tests (40 total)
tests/e2e/mfa-session.spec.ts             NEW — 6 tests
tests/unit/security.test.ts               audit catalogue repointed at the new file
docs/modules/M-61-security.md             file list updated
```

## 7. Tests

* typecheck **clean** · lint **clean**
* MFA/auth unit suites — **104 passed**
* full unit — **2331 passed**, 4 skipped (was 2322)
* e2e — **663 passed** (was 657)
* build — clean, 444 pages · `npm audit` — **0**

The e2e lane cannot walk the real flow: it needs an authenticated staff session
and a valid TOTP code computed from the freshly-issued secret, and this lane
runs secretless with neither. What it does assert is the half that broke — the
journal endpoint answers **no redirect and no Location header** to a caller with
no session, and the gated page still bounces strangers to `/login`. The AAL1 →
AAL2 transition is covered by unit tests and by hand against the live project.

**Note for whoever runs the lane next:** `.env.e2e` sets no service-role or
Stripe key, so a populated `.env.local` leaks real ones in and seven
"degrades honestly without env" smoke tests fail. Export those four as empty
strings, or blank them in `.env.e2e`.
