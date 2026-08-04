# M-40 — Unit tests (vitest)

## What

First automated test layer: 7 vitest suites / 76 tests under `tests/unit/`
covering the pure server/lib modules that guard money, PII and public input.

- `validation.test.ts` — every Zod schema in `src/lib/validation/*`: valid +
  invalid cases per schema, `lead_type` `.catch("dispatch")` behavior, EIN /
  ZIP / weight ("42,000" → 42000, 80k cap) / past-pickup-date rules,
  `localeField` never-fails default, ESIGN consent literal.
- `v4-slugs.test.ts` — `slugifyV4` (src/i18n/v4.ts) is a copy of the
  `slugify` in `scripts/extract-i18n.mjs`; tests pin the algorithm (tag
  stripping, `&amp;` → and, 56-char truncation, `"s"` fallback) and prove
  real component strings resolve to keys present in `messages/en.json` +
  `messages/es.json` (incl. "¿Necesitas un dispatcher?"), and that the two
  catalogs share an identical key set.
- `markdown.test.ts` + `markdown-dom.test.ts` — the M-33 escape-first
  renderer: `<script>`/`onerror` inert, `javascript:`/`data:`/`//` links
  dropped, headings demoted, bold/links/lists/quotes/code render. The DOM
  suite (jsdom) parses the output with a real HTML parser — the same path
  the blog takes via `dangerouslySetInnerHTML` — and asserts zero script/img
  elements survive.
- `loads.test.ts` — M-30 status machine: full happy path, cancellation only
  until money moves, terminal states, illegal skip/reverse transitions,
  money/RPM/lane formatters.
- `crypto.test.ts` — S-01 AES-256-GCM: roundtrip (ASCII + unicode), random
  IV, ciphertext + auth-tag tamper detection, unrecognized-format and
  rotated-key nulls, refuses to encrypt with no key (no plaintext fallback).
- `guards.test.ts` — graceful-degradation contracts: rate limit no-op when
  Upstash env unset and **fail-open** on Redis outage; Turnstile no-op when
  secret unset but **fail-closed** on missing token / non-200 / malformed
  body / network error when the secret is set.

## How

`vitest.config.ts`: node environment by default (`// @vitest-environment
jsdom` per-file opt-in), `@` → `src` alias mirroring tsconfig, and a stub
alias for the `server-only` package (throws outside RSC) at
`tests/unit/stubs/server-only.ts`. Env-dependent behavior is exercised with
`vi.stubEnv` / `vi.stubGlobal("fetch", …)` — no network, no secrets.

## Run

`npm test` (vitest run) · `npm run test:watch`. No DB changes, no endpoints,
no env vars.

## Extension points

Add suites under `tests/unit/**/*.test.{ts,tsx}`. Server actions
(`src/app/actions/*`) need `next/headers` mocking — deliberately left to the
e2e layer (M-41) which exercises them through real requests.
