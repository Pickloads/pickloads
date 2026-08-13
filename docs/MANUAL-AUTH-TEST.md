# Manual authenticated test — sign-in and sign-out

**Why this document exists.** Both automated lanes run without a real Supabase
auth server: the e2e lane uses a placeholder project, and the integration lane
is a bare PostgreSQL with no GoTrue. Everything that can be proved without one
is proved — the sign-out action's cookie sweep, the role→portal map, the
generic error wording, the POST-only form contract, and that every portal route
bounces an anonymous visitor.

What **cannot** be proved there is the round trip: a real session cookie issued
by Supabase, carried by a browser, and then destroyed. The sign-out control
only renders when a session exists, so no automated lane in this repository has
ever clicked it against a live project.

These steps close that gap. They need the real PickLoads Supabase project
connected and take about ten minutes.

> Run them against **staging** if one exists. Against production, use a
> throwaway account — step 4 deliberately checks a suspended/expired path.

---

## Prerequisites

- `.env.local` with the real `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
- A confirmed test account per role you want to cover: **shipper**, **carrier**,
  and one **staff** (dispatcher or admin).
- `npm run build && npm run start`. Use a production build — the defects this
  suite was written for were hydration-timing defects, and `next dev` hides
  them.

---

## 1 · Sign in reaches the right portal

For each role, in a **fresh private window** (so no cookie survives between
roles):

| Role | Expected landing URL |
| ---- | -------------------- |
| shipper | `/portal/shipper` |
| carrier | `/portal/carrier` |
| dispatcher / admin | `/portal/admin` |
| broker | `/portal/broker` |

Check as you go:

1. The address bar after submitting contains **no** `email=` or `password=`.
   (The original P0: the form submitted credentials by GET.)
2. DevTools → Network → the `/login` request is **POST**, not GET.
3. DevTools → Application → Cookies shows `sb-<project-ref>-auth-token`
   (possibly chunked as `.0` / `.1`).

## 2 · Sign out actually ends the session

Signed in as the shipper:

1. Click **Sign out** in the sidebar.
2. **Expected:** you land on `/login` — *not* on `/`.
3. DevTools → Application → Cookies: **no cookie whose name starts with `sb-`
   remains.** Check for chunk suffixes specifically; a surviving
   `…auth-token.1` is a surviving session and is the exact failure this fix
   was written for.
4. Now type `/portal/shipper` into the address bar. **Expected:** redirected to
   `/login?next=%2Fportal%2Fshipper`. If the dashboard renders, the sign-out
   did not clear server-visible state — stop and report it.
5. Press the **browser Back button.** Expected: you do **not** see the
   dashboard. Portal pages are sent with `Cache-Control: no-store`, which
   should keep them out of the back/forward cache — this step is what confirms
   the header is doing its job on a real authenticated render.

Repeat 1–5 for the carrier and for staff.

## 3 · Sign out with the network interrupted

The old implementation navigated away in a `finally` block whether or not the
session had been destroyed, so a failed sign-out looked exactly like a
successful one.

1. Sign in.
2. DevTools → Network → set throttling to **Offline**.
3. Click **Sign out**.
4. Restore the network, then visit `/portal/shipper`.
5. **Expected:** still redirected to `/login`. The cookie sweep is local to the
   server request and does not depend on Supabase being reachable.

## 4 · Cross-checks worth one minute each

- **Wrong password** → "Invalid email or password. Please try again." and you
  stay on `/login`. An unknown email must produce the **identical** message; a
  different one turns the form into an account oracle.
- **Unverified account** → the "verify your email first" message, not "invalid
  password".
- **Two tabs:** sign out in tab A, then act in tab B. Tab B's next server
  request must bounce to `/login` (sign-out is scoped `local`, so it ends this
  browser's session — both tabs share it — but not other devices).
- **Other devices stay signed in.** That is deliberate: clicking "Sign out" in
  one browser is not a request to revoke a phone.

---

## What to report if any step fails

The server log is now the fastest diagnostic — `[turnstile]` lines explain a
refused form submission with the Cloudflare error code and its meaning. For
auth, capture:

- the exact URL after the failing action,
- the full cookie list (names only — **never paste a cookie value**),
- the Network entry for the failing request (method and status),
- the server console output for that request.
