# M-98 — the CSP was stopping the whole client from hydrating

**Branch:** `final-website-production` · **Baseline:** M-97 (`002f693`)
**Status:** fixed, gate green, **not committed** pending sign-off; not pushed,
not deployed.

---

## 1. Root cause

`script-src` allowed `'unsafe-inline'` but not `'unsafe-eval'`. Next's
**development** runtime evaluates strings as JavaScript — webpack's module
wrapper and React Refresh both do — so Chrome refused to run it:

```
Uncaught EvalError: Evaluating a string as JavaScript violates the following
Content Security Policy directive … 'unsafe-eval' is not an allowed source of
script
  next/dist/compiled/@next/react-refresh-utils/dist/runtime.js
  webpack_exec · main-app.js
```

**Nothing hydrated.** The server-rendered HTML was perfect, so every page
looked right — correct role, correct MFA policy, correct AAL — and no `onClick`
existed anywhere in the application. "Generate QR code does nothing" was
literally true, and would have been equally true of every other button in the
product under `next dev`; it was simply noticed on the MFA page.

Two independent confirmations that the handler never ran:

* the account has **zero** TOTP factors. A single click reaching
  `mfa.enroll()` would have left an unverified one behind, so none accumulated
  because none was ever created;
* the reported `POST /portal/admin/mfa → 303` (M-97) is what a **native** form
  submit produces — a hydrated component calls `preventDefault()` and never
  posts at all.

### On the two fixes before this one

M-96 (undecodable QR data URL) and M-97 (a Server Action redirecting mid-MFA)
were real defects, measured against the live project, and both would have bitten
the moment hydration worked. Neither was *this*. The lesson worth recording: I
checked `script-src` for `'unsafe-inline'`, saw it, and concluded "CSP is fine"
— without checking for `eval`, which is a different directive with a different
failure mode. A partial check reported as a clearance is worse than no check.

## 2. CSP before

```
script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://www.googletagmanager.com
```
One policy, both modes.

## 3. CSP after — development

```
script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://www.googletagmanager.com 'unsafe-eval'
```

Verified live against the running dev server: `unsafe-eval` present, **one**
CSP header.

## 4. CSP after — production

```
script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://www.googletagmanager.com
```

Byte-identical to what it was. Every other directive — `default-src`,
`style-src`, `img-src`, `font-src`, `connect-src`, `frame-src`, `base-uri`,
`form-action`, `frame-ancestors`, `upgrade-insecure-requests` — is shared, so
the two policies cannot drift in any respect except this one token. A dev CSP
that quietly permitted a different `connect-src` would hide a violation that
only appears in production.

`resolveMode()` **fails closed**: anything that is not `development` or `test`
— including an unset or misspelled `NODE_ENV` — gets the strict policy.

## 5. Why the concession is acceptable in development only

In development the code being evaluated is the code on the developer's own
disk, served to their own browser on localhost, by a server that already
executes arbitrary local code by definition. In production the same directive
makes any injected string executable, which is most of what a CSP is for.

It is the dev server's requirement, not the application's: no `eval` and no
`new Function` exists anywhere in `src/`, and a test asserts that, so the
concession cannot quietly become ours.

## 6. Files changed

```
src/lib/security-headers.ts          NEW — the policy, testable, one source
next.config.ts                       imports it; no literal policy left
tests/unit/security-headers.test.ts  NEW — 11 tests
tests/e2e/shipment-map.spec.ts       +1 production-server assertion
docs/modules/M-98-dev-csp-hydration.md
```

The CSP moved out of `next.config.ts` because a config file cannot be imported
from the unit lane without dragging the next-intl plugin with it — and an
untested CSP is one nobody notices is wrong until a browser refuses to run the
application, which is precisely what happened.

## 7. Audit: where the CSP comes from

`next.config.ts` `headers()` is the **only** source. `vercel.json` has no
`headers` block (crons only), the middleware sets none, and there is no other
security-headers helper. Confirmed empirically as well: the live dev server
returns exactly **one** `Content-Security-Policy` header. A second one would not
merge — browsers enforce the intersection of all policies — so a stray one is
both a conflict and a silent re-break. A unit test scans application source plus
both config files for anyone building a second policy, and the e2e asserts the
served header count is 1.

## 8. Tests

| | |
|---|---|
| typecheck / lint | clean |
| `security-headers.test.ts` | 11 passed |
| full unit | **2342** passed, 4 skipped (was 2331) |
| e2e | **664** passed (was 663) |
| build | clean, 444 pages |
| `npm audit` | 0 |

The production assertion runs in the **e2e** lane specifically, because that
lane runs `next start` — so the header it measures is the one a visitor gets.
The unit test proves the policy *builder* never emits `unsafe-eval` outside
development; the e2e proves the server actually sends what the builder built.
Those are different failure modes, and only the second catches a config that
stopped calling the builder.

## 9. Still to confirm in a browser

This fix is verifiable from the server side (header correct, single header,
production clean) but the hydration itself is a browser fact. After restarting
`next dev`:

1. `/portal/admin/mfa` loads with **no** `EvalError` in the console;
2. **Generate QR code** invokes the handler;
3. `mfa.enroll()` runs — a factor appears on the account;
4. the QR becomes visible (M-96 made the payload decodable);
5. the 6-digit input appears;
6. a correct code reaches AAL2 and lands on `/portal/admin` (M-97 removed the
   redirect that broke this).

If step 3 happens but step 4 does not, that is M-96 territory and the panel now
says so and offers the manual setup key rather than showing a blank frame.
