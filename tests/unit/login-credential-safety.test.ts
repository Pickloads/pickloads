import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * P0 — the login form submitted passwords in the URL.
 *
 * ── THE DEFECT, PRECISELY ────────────────────────────────────────────────
 *
 * `LoginForm` was `<form onSubmit={handleSubmit}>` with no `method` and no
 * `action`. The handler called `preventDefault()` and authenticated through
 * the browser Supabase client, and that code was correct.
 *
 * It was also the only thing standing between a password and the address bar.
 * A `<form>` with no `method` submits **GET to its own URL**, so the security
 * of the login page depended on React finishing hydration before the user
 * could press Enter. Lose that race — slow network, a JS error, a blocked
 * chunk — and the browser does exactly what the markup says:
 *
 *     GET /login?email=<email>&password=<password> 200
 *
 * password in the URL, the history, the referrer and the access log.
 *
 * ── WHY THESE TESTS ARE STRUCTURAL AND NOT BEHAVIOURAL ───────────────────
 *
 * A test that drives the form with JavaScript enabled proves nothing about
 * this bug: with JS working, the old code passed too. What has to be true is
 * a property of the MARKUP — that no credential form can submit by GET even
 * with the JavaScript deleted. So these assert on the source and on the
 * server-rendered HTML, which is where the guarantee actually lives.
 *
 * The end-to-end behaviour (POST reaches the action, session cookie is set,
 * each role lands on its own portal) is covered in `tests/e2e/auth.spec.ts`.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/**
 * Source with comments stripped.
 *
 * Not optional here: this file's own subjects DOCUMENT the removed pattern —
 * `LoginForm` explains in a header comment that it used to be
 * `<form onSubmit={handleSubmit}>` calling `signInWithPassword`. Scanning raw
 * text reports that explanation as the defect, and the obvious way to make
 * the test pass is to delete the explanation.
 */
const codeOf = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:'"`])\/\/.*$/gm, "$1");

/** Every form that carries a password, a TOTP code or an account email. */
const CREDENTIAL_FORMS = [
  "src/components/auth/LoginForm.tsx",
  "src/components/auth/ResetPasswordForm.tsx",
  "src/components/auth/ForgotPasswordForm.tsx",
  "src/components/portal/AccountSettingsForms.tsx",
  "src/components/portal/MfaEnrollment.tsx",
];

describe("login submits by POST, never GET", () => {
  it("the form is wired to a server action", () => {
    const src = read("src/components/auth/LoginForm.tsx");
    expect(src).toContain("signInAction");
    expect(src).toContain("useActionState");
    expect(src).toMatch(/<form[^>]*action=\{formAction\}/);
  });

  it("does NOT hand-set method/encType — React owns that for a function action", () => {
    // The first version of this fix added `method="post"` as a fail-safe and
    // asserted it here. That was wrong on the framework contract: when
    // `action` is a function React renders `method="POST"` and the multipart
    // encType itself, and a hand-set attribute earns
    //   "Cannot specify a encType or method for a form that specifies a
    //    function as the action."
    //
    // The guarantee did not weaken — it moved to where it was always
    // enforced. `tests/e2e/login-post.spec.ts` asserts the RENDERED tag says
    // POST and that a native submit produces one.
    const src = codeOf("src/components/auth/LoginForm.tsx");
    const tag = src.match(/<form[^>]*>/)?.[0] ?? "";
    expect(tag).toContain("action={formAction}");
    expect(tag, "React warns when method is set alongside a function action")
      .not.toMatch(/method=/);
    expect(tag).not.toMatch(/encType=/i);
  });

  it("no longer authenticates in the browser", () => {
    const src = codeOf("src/components/auth/LoginForm.tsx");
    expect(src).not.toContain("signInWithPassword");
    expect(src).not.toContain("@/lib/supabase/client");
    // `onSubmit` is what made GET reachable. It must not come back here.
    expect(src).not.toMatch(/<form[^>]*onSubmit=/);
  });

  it("EVERY credential-bearing form forbids a GET fallback", () => {
    // The login form was not special — it was simply the one that got
    // noticed. Reset-password carries two passwords, account settings carries
    // a new password, MFA carries a TOTP code.
    //
    // Two legitimate shapes, and exactly two:
    //   * `action={fn}`  — React renders POST; setting `method` here WARNS.
    //   * `onSubmit=`    — no function action, so `method="post"` is both
    //                      allowed and required, otherwise the default is GET.
    for (const rel of CREDENTIAL_FORMS) {
      const src = codeOf(rel);
      for (const tag of src.match(/<form[^>]*>/g) ?? []) {
        expect(
          tag,
          `${rel}: a credential form must not submit by GET`,
        ).not.toMatch(/method="get"/i);

        const hasFunctionAction = /\baction=\{/.test(tag);
        if (hasFunctionAction) {
          expect(
            tag,
            `${rel}: React owns method/encType for a function action`,
          ).not.toMatch(/method=|encType=/i);
        } else {
          expect(
            tag,
            `${rel}: a handler-only credential form must declare method="post"`,
          ).toMatch(/method="post"/);
        }
      }
    }
  });

  it("NON-VACUITY: a bare <form onSubmit> would be caught", () => {
    const bad = '<form onSubmit={handleSubmit}>';
    expect(/<form[^>]*method="post"/.test(bad)).toBe(false);
    expect(/<form[^>]*onSubmit=/.test(bad)).toBe(true);
  });
});

describe("no password can reach a URL", () => {
  it("the action never puts credentials in a redirect", () => {
    const action = read("src/app/actions/auth.ts");
    // Redirect targets are built from portalHomeFor()/next only.
    for (const target of action.match(/redirect\([^)]*\)/g) ?? []) {
      expect(target).not.toMatch(/password|email/i);
    }
  });

  it("rejects an off-site ?next= (open redirect)", async () => {
    // A login page that redirects anywhere is a phishing landing page with a
    // real certificate. `//evil.com` is protocol-relative and ABSOLUTE, which
    // is why startsWith("/") alone is not enough.
    const action = read("src/app/actions/auth.ts");
    expect(action).toContain('!next.startsWith("//")');
  });

  it("no auth surface logs or analyses a credential", () => {
    for (const rel of [
      "src/app/actions/auth.ts",
      ...CREDENTIAL_FORMS,
    ]) {
      const src = read(rel).replace(/\/\*[\s\S]*?\*\//g, "");
      // console.*/track(...) taking a password variable would put it in logs
      // or the analytics pipeline.
      expect(src, `${rel}: credential in a log or event`).not.toMatch(
        /(console\.\w+|track\w*)\([^)]*password/i,
      );
    }
  });
});

describe("errors are generic — Supabase text is never forwarded", () => {
  const action = read("src/app/actions/auth.ts");

  it("returns only the approved messages", () => {
    expect(action).toContain("Invalid email or password. Please try again.");
    // The one distinction worth keeping: M-52 never auto-confirms, so without
    // it a verified signup dead-ends on "invalid password".
    expect(action).toContain("Verify your email first");
  });

  it("never returns the raw error object or message", () => {
    expect(action).not.toMatch(/message:\s*(authError|error)\??\.message/);
    expect(action).not.toMatch(/return\s*\{[^}]*error\.message/);
  });
});

describe("role routing uses the existing portal map", () => {
  it("resolves the destination from portalHomeFor, inventing no route", () => {
    const action = read("src/app/actions/auth.ts");
    expect(action).toContain("portalHomeFor");
    expect(action).toContain('from "@/lib/auth"');
  });

  it("portalHomeFor still covers every role in the enum", () => {
    // If a role is added and this map is not, that role silently lands on the
    // carrier portal and is bounced by requireCarrier — the loop M-81 fixed.
    const auth = read("src/lib/auth.ts");
    const types = read("src/lib/supabase/database.types.ts");
    const block = types.match(/export type UserRole =([\s\S]*?);/)?.[1] ?? "";
    const roles = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(roles.length).toBeGreaterThan(3);
    for (const role of roles) {
      if (role === "carrier") continue; // the documented default branch
      expect(auth, `portalHomeFor does not handle "${role}"`).toContain(
        `"${role}"`,
      );
    }
  });

  it("suspended accounts do not get a portal redirect", () => {
    const action = read("src/app/actions/auth.ts");
    expect(action).toContain("suspended");
    expect(action).toContain("error=suspended");
  });
});

describe("no other form in the repo can leak a secret by GET", () => {
  it("sweeps every form element in src/", () => {
    const files: string[] = [];
    (function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.tsx$/.test(entry.name)) files.push(p);
      }
    })(path.join(ROOT, "src"));

    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      const src = codeOf(rel);
      if (!/type="password"|name="code"/.test(src)) continue;
      for (const tag of src.match(/<form[^>]*>/g) ?? []) {
        // A server action ALWAYS posts — Next renders method="POST" into the
        // HTML and the no-JS path works. `action={anything}` therefore counts,
        // not just the two identifier names this file happens to use.
        const isPost =
          /method="post"/i.test(tag) || /\baction=\{/.test(tag);
        if (!isPost) offenders.push(`${rel}: ${tag}`);
      }
    }
    expect(
      offenders,
      `forms collecting a secret with no POST guarantee: ${offenders.join(" | ")}`,
    ).toEqual([]);
  });

  it("NON-VACUITY: the sweep actually found credential files to check", () => {
    const withSecrets = CREDENTIAL_FORMS.filter((rel) =>
      /type="password"|name="code"/.test(read(rel)),
    );
    expect(withSecrets.length).toBeGreaterThanOrEqual(4);
  });
});
