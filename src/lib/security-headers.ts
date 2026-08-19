/**
 * M-98 — the security headers, in one testable place.
 *
 * Plain module: imported by `next.config.ts` (which is the ONLY thing that
 * sends these — `vercel.json` has no `headers` block and the middleware sets
 * none, so there is exactly one CSP and nothing to conflict with it) and by
 * `tests/unit/security-headers.test.ts`.
 *
 * ── WHY THIS FILE EXISTS AT ALL ──────────────────────────────────────────
 *
 * The CSP used to be a string literal inside `next.config.ts`. That made it
 * untestable — a config file is not importable from the unit lane without
 * dragging the next-intl plugin in with it — and an untested CSP is one nobody
 * notices is wrong until a browser refuses to run the application.
 *
 * Which is what happened. `script-src` carried `'unsafe-inline'` but not
 * `'unsafe-eval'`, and Next's DEVELOPMENT runtime (webpack's module wrapper
 * and React Refresh) evaluates strings as JavaScript. Chrome refused:
 *
 *     Uncaught EvalError: Evaluating a string as JavaScript violates the
 *     following Content Security Policy directive … 'unsafe-eval' is not an
 *     allowed source of script
 *     …/@next/react-refresh-utils/dist/runtime.js, webpack_exec, main-app.js
 *
 * The server-rendered HTML was perfect, so every page LOOKED right. Nothing
 * hydrated, so no `onClick` existed anywhere in the application — which is why
 * "Generate QR code" did nothing, silently, with no error of its own.
 *
 * ── THE RULE THIS FILE ENFORCES ──────────────────────────────────────────
 *
 * `'unsafe-eval'` is a DEVELOPMENT-ONLY concession to the dev server, and it
 * is added by exactly one branch, keyed on the build mode. Production keeps
 * the strict policy it always had. `tests/unit/security-headers.test.ts`
 * fails if production ever gains it — including through a careless "just make
 * both the same".
 */

export type BuildMode = "development" | "production" | "test";

/**
 * Everything except `script-src`, which is the only directive that differs
 * between modes. Kept as one list so the two policies cannot drift in any
 * other respect — a dev CSP that quietly permits a different `connect-src`
 * would hide a violation that only appears in production.
 */
const SHARED_DIRECTIVES = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://www.google-analytics.com https://maps.gstatic.com https://*.googleapis.com",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co https://www.google-analytics.com https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com https://www.google.com",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
] as const;

/** The third parties in the approved stack. Identical in both modes. */
const SCRIPT_SOURCES = [
  "'self'",
  "'unsafe-inline'",
  "https://challenges.cloudflare.com",
  "https://www.googletagmanager.com",
] as const;

/**
 * `'unsafe-eval'`, and why it is acceptable in development and not otherwise.
 *
 * In development the attacker model is different in kind: the code being run
 * is the code on the developer's own disk, served to their own browser on
 * localhost, and the dev server already executes arbitrary local code by
 * definition. In production the same directive would mean any injected string
 * becomes executable — which is most of what a CSP is for.
 *
 * Next's dev runtime genuinely requires it; this is not a workaround for
 * application code. No `eval`, `new Function` or string-timer exists in
 * `src/`, and the test file asserts that too, so the concession stays the dev
 * server's and does not quietly become ours.
 */
export function buildCsp(mode: BuildMode = resolveMode()): string {
  const scriptSrc: string[] = [...SCRIPT_SOURCES];
  if (mode === "development") scriptSrc.push("'unsafe-eval'");
  return [`script-src ${scriptSrc.join(" ")}`, ...SHARED_DIRECTIVES].join("; ");
}

function resolveMode(): BuildMode {
  const env = process.env.NODE_ENV;
  return env === "development" || env === "test" ? env : "production";
}

/**
 * The full header set (audit S-06, OWASP secure headers).
 *
 * Only the CSP varies by mode. HSTS, nosniff, DENY, referrer policy and the
 * permissions policy are constant — none of them has anything to do with the
 * dev runtime, and varying them would be scope creep with a security label on.
 */
export function securityHeaders(
  mode: BuildMode = resolveMode(),
): Array<{ key: string; value: string }> {
  return [
    { key: "Content-Security-Policy", value: buildCsp(mode) },
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=()",
    },
  ];
}
