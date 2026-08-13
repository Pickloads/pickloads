import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sign out — session termination.
 *
 * ── THE DEFECT ───────────────────────────────────────────────────────────
 *
 * The control was `<a href="#signout" onClick={e => {e.preventDefault();
 * void signOut();}}>` calling `createBrowserClient().auth.signOut()` and then
 * `window.location.assign("/")` from a `finally`.
 *
 * The navigation in `finally` is the whole problem: it ran whether or not the
 * session had actually been destroyed, and it landed on the marketing
 * homepage, which looks identical signed-in and signed-out. So every failure
 * mode below was invisible to the person clicking:
 *
 *   * the browser client deletes through `document.cookie`, which cannot
 *     remove a cookie whose name/path/domain it does not match exactly — and
 *     Supabase CHUNKS large sessions across `…auth-token.0` / `.1`;
 *   * `signOut()`'s error result was discarded, and its default global scope
 *     is a network call that fails on an already-expired access token;
 *   * when `NEXT_PUBLIC_SUPABASE_URL` was a placeholder it skipped the
 *     sign-out entirely and only navigated.
 *
 * And before hydration the anchor navigated to a fragment and did nothing.
 *
 * These tests pin the replacement: server-side, cookie-jar authoritative, and
 * destroying the session even when Supabase is unreachable.
 */

let deleted: string[] = [];
let cookieJar: { name: string; value: string }[] = [];
let signOutCalls: unknown[] = [];
let signOutThrows = false;
let redirectedTo: string | null = null;

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Map<string, string>()),
  cookies: () =>
    Promise.resolve({
      getAll: () => cookieJar,
      delete: (name: string) => {
        deleted.push(name);
        cookieJar = cookieJar.filter((c) => c.name !== name);
      },
    }),
}));

vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href, locale }: { href: string; locale: string }) =>
    locale === "en" ? href : `/${locale}${href}`,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectedTo = url;
    const err = new Error("NEXT_REDIRECT");
    (err as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${url}`;
    throw err;
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        signOut: (opts?: unknown) => {
          signOutCalls.push(opts);
          if (signOutThrows) throw new Error("supabase unreachable");
          return Promise.resolve({ error: null });
        },
      },
    }),
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => Promise.resolve(true) }));

const { signOutAction } = await import("@/app/actions/auth");

async function run(locale = "en") {
  redirectedTo = null;
  const fd = new FormData();
  fd.set("locale", locale);
  try {
    await signOutAction(fd);
  } catch (e) {
    if ((e as Error).message !== "NEXT_REDIRECT") throw e;
  }
  return redirectedTo;
}

/** A realistic jar: a chunked Supabase session plus unrelated cookies. */
function realisticJar() {
  return [
    { name: "sb-lntvclaelwouzozjikii-auth-token.0", value: "chunk0" },
    { name: "sb-lntvclaelwouzozjikii-auth-token.1", value: "chunk1" },
    { name: "sb-lntvclaelwouzozjikii-auth-token-code-verifier", value: "pkce" },
    { name: "NEXT_LOCALE", value: "en" },
    { name: "cf_clearance", value: "unrelated" },
  ];
}

beforeEach(() => {
  deleted = [];
  signOutCalls = [];
  signOutThrows = false;
  cookieJar = realisticJar();
});

describe("sign out clears the session cookies", () => {
  it("calls Supabase signOut through the SSR server client", async () => {
    await run();
    expect(signOutCalls).toHaveLength(1);
  });

  it("scopes the sign-out to THIS browser, not every device", async () => {
    // A user clicking "Sign out" in one tab did not ask to be logged out of
    // their phone. Global scope is also a network call that fails closed.
    await run();
    expect(signOutCalls[0]).toEqual({ scope: "local" });
  });

  it("deletes EVERY sb-* cookie, including the chunks", async () => {
    // The chunks are the specific thing `document.cookie` deletion kept
    // missing. A surviving `.1` is a surviving session.
    await run();
    expect(deleted).toEqual(
      expect.arrayContaining([
        "sb-lntvclaelwouzozjikii-auth-token.0",
        "sb-lntvclaelwouzozjikii-auth-token.1",
        "sb-lntvclaelwouzozjikii-auth-token-code-verifier",
      ]),
    );
    expect(cookieJar.some((c) => c.name.startsWith("sb-"))).toBe(false);
  });

  it("leaves unrelated cookies alone", async () => {
    await run();
    expect(deleted).not.toContain("NEXT_LOCALE");
    expect(deleted).not.toContain("cf_clearance");
    expect(cookieJar.map((c) => c.name)).toEqual(["NEXT_LOCALE", "cf_clearance"]);
  });

  it("STILL destroys the session when Supabase is unreachable", async () => {
    // The old code's failure mode, inverted. A sign-out that depends on a
    // working network is not a sign-out.
    signOutThrows = true;
    const to = await run();
    expect(cookieJar.some((c) => c.name.startsWith("sb-"))).toBe(false);
    expect(to).toBe("/login");
  });

  it("NON-VACUITY: the sweep would have left a non-sb cookie behind", async () => {
    // Proves the filter is doing work rather than deleting everything.
    cookieJar = [{ name: "session_like_but_not_supabase", value: "x" }];
    await run();
    expect(deleted).toEqual([]);
  });
});

describe("sign out redirects to the login page", () => {
  it("lands on /login, not the marketing homepage", async () => {
    // `/` looks the same signed-in and signed-out, so it could not tell the
    // user whether the sign-out had worked.
    expect(await run()).toBe("/login");
  });

  it("keeps the user in their locale", async () => {
    expect(await run("es")).toBe("/es/login");
    expect(await run("fr")).toBe("/fr/login");
  });

  it("redirects AFTER clearing, never before", async () => {
    // If the redirect threw first, the cookies would survive — the exact
    // shape of the original bug, where navigation happened in `finally`.
    await run();
    expect(deleted.length).toBeGreaterThan(0);
  });
});

describe("the sign-out control cannot fail silently", () => {
  const read = (rel: string) =>
    readFileSync(path.join(process.cwd(), rel), "utf8");
  const codeOf = (rel: string) =>
    read(rel)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
      .replace(/(^|[^:'"`])\/\/.*$/gm, "$1");

  it("is a form posting to the server action, not an anchor", async () => {
    const src = codeOf("src/components/portal/PortalSidebar.tsx");
    expect(src).toContain("signOutAction");
    expect(src).toMatch(/<form[^>]*action=\{signOutAction\}/);
    // The anchor is what did nothing before hydration.
    expect(src).not.toMatch(/href="#signout"/);
    expect(src).not.toMatch(/window\.location\.assign/);
  });

  it("no longer signs out through the BROWSER supabase client", async () => {
    const src = codeOf("src/components/portal/PortalSidebar.tsx");
    expect(src).not.toContain("@/lib/supabase/client");
  });

  it("React owns method/encType — no hand-set attribute", async () => {
    const src = codeOf("src/components/portal/PortalSidebar.tsx");
    const tag = src.match(/<form[^>]*action=\{signOutAction\}[^>]*>/)?.[0] ?? "";
    expect(tag).not.toMatch(/method=|encType=/i);
  });

  it("there is exactly ONE sign-out implementation in the repo", async () => {
    // Every "Sign out" control must reach the same code. A second one is a
    // second chance to get session teardown wrong.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(entry.name)) {
          const rel = path.relative(process.cwd(), p).replace(/\\/g, "/");
          if (rel === "src/app/actions/auth.ts") continue; // the canonical one
          if (/auth\s*\.\s*signOut\s*\(/.test(codeOf(rel))) offenders.push(rel);
        }
      }
    };
    walk(path.join(process.cwd(), "src"));
    expect(
      offenders,
      `sign-out implemented outside the canonical action: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
