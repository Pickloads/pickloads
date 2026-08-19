import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { buildCsp, securityHeaders } from "@/lib/security-headers";

/**
 * M-98 — the CSP that stopped the application from running.
 *
 * ── THE FAILURE ──────────────────────────────────────────────────────────
 *
 * `script-src` allowed `'unsafe-inline'` but not `'unsafe-eval'`. Next's DEV
 * runtime evaluates strings as JavaScript — webpack's module wrapper and React
 * Refresh both do — so Chrome refused:
 *
 *     Uncaught EvalError: Evaluating a string as JavaScript violates the
 *     following Content Security Policy directive … 'unsafe-eval' is not an
 *     allowed source of script
 *
 * Nothing hydrated. Every page still rendered perfectly, because the SERVER
 * output was fine; there was simply no client. So "the Generate QR code button
 * does nothing" was literally true, and so was "does nothing" for every other
 * button in the product — it just happened to be noticed on the MFA page.
 *
 * ── WHY THIS TEST IS THE IMPORTANT HALF OF THE FIX ───────────────────────
 *
 * The fix is one word in one branch. The risk is that somebody later
 * "simplifies" the two policies into one, and `'unsafe-eval'` — the single
 * directive that turns any injected string into executable code — reaches
 * production. That is a one-line change with no visible symptom whatsoever,
 * which is exactly the kind this file exists to catch.
 */

describe("development CSP permits what the Next dev server requires", () => {
  const dev = buildCsp("development");

  it("allows unsafe-eval, without which nothing hydrates", () => {
    const scriptSrc = dev
      .split("; ")
      .find((d) => d.startsWith("script-src "))!;
    expect(scriptSrc).toContain("'unsafe-eval'");
  });

  it("still allows the inline bootstrap and the approved third parties", () => {
    expect(dev).toContain("'unsafe-inline'");
    expect(dev).toContain("https://challenges.cloudflare.com");
    expect(dev).toContain("https://www.googletagmanager.com");
  });

  it("still allows the Supabase connection the auth client needs", () => {
    expect(dev).toContain("connect-src 'self' https://*.supabase.co");
  });

  it("still allows the data: URL the MFA QR is rendered from", () => {
    // M-96 normalizes the payload into `data:image/svg+xml;charset=utf-8,…`.
    // A CSP without `data:` in img-src would blank the QR all over again, for
    // a completely different reason.
    expect(dev).toContain("img-src 'self' data:");
  });
});

describe("production CSP does NOT contain unsafe-eval", () => {
  const prod = buildCsp("production");

  it("refuses eval — the whole point of the policy", () => {
    expect(prod).not.toContain("unsafe-eval");
  });

  it("refuses it under every non-development mode", () => {
    for (const mode of ["production", "test"] as const) {
      expect(buildCsp(mode), mode).not.toContain("unsafe-eval");
    }
  });

  it("keeps every other directive byte-identical to development", () => {
    // The two policies may differ in ONE directive and no other. A dev CSP
    // that quietly permitted a different connect-src would hide a violation
    // that only shows up in production.
    const split = (csp: string) => new Map(
      csp.split("; ").map((d) => {
        const i = d.indexOf(" ");
        return i === -1 ? [d, ""] : [d.slice(0, i), d.slice(i + 1)];
      }),
    );
    const dev = split(buildCsp("development"));
    const prd = split(prod);
    expect([...prd.keys()]).toEqual([...dev.keys()]);
    for (const [directive, value] of prd) {
      if (directive === "script-src") continue;
      expect(value, directive).toBe(dev.get(directive));
    }
    // And the one that differs, differs by exactly that token.
    expect(dev.get("script-src")).toBe(
      `${prd.get("script-src")} 'unsafe-eval'`,
    );
  });

  it("keeps the rest of the S-06 header set unchanged in both modes", () => {
    const strip = (mode: "development" | "production") =>
      securityHeaders(mode).filter(
        (h) => h.key !== "Content-Security-Policy",
      );
    expect(strip("development")).toEqual(strip("production"));
    const keys = securityHeaders("production").map((h) => h.key);
    expect(keys).toEqual([
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]);
  });

  it("defaults to the strict policy when NODE_ENV says nothing useful", () => {
    // Fail closed: an unrecognised mode must not be treated as development.
    const original = process.env.NODE_ENV;
    try {
      // @ts-expect-error — deliberately writing a value the type forbids.
      process.env.NODE_ENV = "staging";
      expect(buildCsp()).not.toContain("unsafe-eval");
    } finally {
      // @ts-expect-error — restoring the original value.
      process.env.NODE_ENV = original;
    }
  });
});

describe("there is exactly one CSP, and the app does not need eval itself", () => {
  it("no second Content-Security-Policy is sent from anywhere else", () => {
    // A second header would not merge — browsers enforce the INTERSECTION of
    // all policies, so a stray one silently re-breaks what this fixes.
    // Only the surfaces that can actually SEND a header: application source,
    // the Next config and the platform config. Not the test lane — and note
    // that a git pathspec of "*.ts" matches at any depth, which is how the
    // first version of this scanned itself and failed.
    const files = [
      ...execSync('git ls-files "src/**/*.ts" "src/**/*.tsx"', {
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .filter(Boolean),
      "next.config.ts",
      "vercel.json",
    ].filter((f) => f !== "src/lib/security-headers.ts");
    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /Content-Security-Policy|script-src/.test(src);
    });
    // next.config.ts may MENTION it in prose; it must not build one.
    for (const f of offenders) {
      const code = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^[ \t]*\/\/.*$/gm, " ");
      expect(code, `${f} builds a second CSP`).not.toMatch(
        /["'`]Content-Security-Policy["'`]|script-src /,
      );
    }
  });

  it("no application code evaluates strings, so the dev concession stays the dev server's", () => {
    const files = execSync('git ls-files "src/**/*.ts" "src/**/*.tsx"', {
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const f of files) {
      const code = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^[ \t]*\/\/.*$/gm, " ");
      expect(code, `${f} uses eval`).not.toMatch(/\beval\s*\(/);
      expect(code, `${f} uses new Function`).not.toMatch(/new\s+Function\s*\(/);
    }
  });
});
