import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { securityHeaders } from "./src/lib/security-headers";

/*
 * Security headers per audit item S-06 (OWASP secure headers).
 *
 * The policy itself lives in `src/lib/security-headers.ts` so it can be unit
 * tested — it is the only CSP the application sends (`vercel.json` has no
 * `headers` block and the middleware sets none), and an untested CSP is one
 * nobody notices is wrong until a browser refuses to run the app.
 *
 * M-98: that is not hypothetical. `script-src` had `'unsafe-inline'` but not
 * `'unsafe-eval'`, which Next's DEV runtime requires (webpack's module wrapper
 * and React Refresh evaluate strings). Chrome refused, nothing hydrated, and
 * every page rendered perfectly while no click handler in the application
 * existed. `'unsafe-eval'` is now added in DEVELOPMENT ONLY; production keeps
 * the strict policy, and `tests/unit/security-headers.test.ts` fails if that
 * ever stops being true.
 */
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    // Evaluated per invocation rather than captured at module load, so the
    // mode is read from the process actually serving the request.
    return [{ source: "/(.*)", headers: securityHeaders() }];
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
export default withNextIntl(nextConfig);
