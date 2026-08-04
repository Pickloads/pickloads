# M-41 — E2E smoke suite (Playwright)

## What

10 chromium smoke tests (`tests/e2e/smoke.spec.ts`) against a real
production build, run secretless (placeholder Supabase env, no
Turnstile/Upstash/Resend keys) — so they double as proof of every
graceful-degradation contract:

1. Home renders the rich hero (`t.rich` V4 dictionary path) + exactly 3
   pricing plans with correct names.
2. `/es` home is actually translated ("¿Necesitas un dispatcher?",
   `html[lang=es]`).
3. Quick-quote server action: invalid phone → Zod message in `.form-err.show`.
4. Quick-quote valid phone → **verified secretless behavior**: guard no-ops,
   DB write skipped, email log-only, action reports success (`.form-ok.show`)
   — never a crash or 500.
5. `/faq` `<details>` accordions open on click.
6. `/dispatch/dry-van` → 200 with equipment content.
7. `/portal` → middleware redirect to `/login?next=/portal` (auth wall works
   even against an unreachable Supabase host: `getUser` fails → no user).
8. `sitemap.xml` → 200 XML with localized routes + hreflang alternates.
9. `robots.txt` → Disallow `/portal` + `/api`, Sitemap pointer.
10. Unknown route → HTTP 404 with the branded not-found page.

Suite runtime: ~13s (budget <90s).

## How to run

```
npm run build          # once — the config intentionally does NOT build
npm run test:e2e       # starts `next start` on :4321 via webServer
```

`playwright.config.ts`: baseURL `http://127.0.0.1:4321`, chromium
`executablePath` pinned to `/opt/pw-browsers/chromium` (container-provisioned
binary; on a normal machine remove the launchOptions override and
`npx playwright install chromium`). `reuseExistingServer: true` — kill any
stale server on :4321 after rebuilding, or the suite tests the old build.

## Gotchas found while building this

- A `next start` left running across a rebuild serves prerendered HTML
  referencing chunk hashes that no longer exist on disk (assets 400) — always
  restart the server after `npm run build`.
- The quick-quote phone input is `required`, so a truly empty submit is
  blocked by native browser validation; the server-side Zod path is exercised
  with a non-empty invalid value ("abc").

No DB changes, no endpoints, no env vars.
