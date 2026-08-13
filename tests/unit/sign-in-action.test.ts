import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialFormState } from "@/lib/form-state";

/**
 * P0 — `signInAction`, the server action that replaced browser-side sign-in.
 *
 * `tests/unit/login-credential-safety.test.ts` proves the FORM cannot submit a
 * password by GET. This file proves the ACTION behind it behaves: that a
 * password is actually exchanged for a session, that each role reaches its own
 * portal, and that nothing about a failure tells the caller which account
 * exists.
 *
 * Supabase is mocked because the alternative is worse, not because it is
 * easier: the e2e lane runs on a placeholder project with no auth server, and
 * the integration lane runs on a bare PostgreSQL with no GoTrue. A test that
 * needs a live hosted auth service is a test that does not run, and an
 * unverified auth path is exactly what produced this defect.
 */

interface Scenario {
  signInError: { message: string } | null;
  user: { id: string } | null;
  profile: { role: string; status: string } | null;
  throws?: boolean;
}

let scenario: Scenario;
let signInCalls: { email: string; password: string }[] = [];
let signOutCalls = 0;
let redirectedTo: string | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: {
        signInWithPassword: (creds: { email: string; password: string }) => {
          signInCalls.push(creds);
          if (scenario.throws) throw new Error("network down");
          return Promise.resolve({
            data: { user: scenario.user },
            error: scenario.signInError,
          });
        },
        signOut: () => {
          signOutCalls += 1;
          return Promise.resolve({ error: null });
        },
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: scenario.profile, error: null }),
          }),
        }),
      }),
    }),
}));

// Mocked so `next-intl`'s client navigation module is never loaded — it
// imports `next/navigation` through an ESM path vitest cannot resolve once
// that module is mocked below. The real `getPathname` only adds the locale
// prefix, which is not what any assertion here is about.
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href }: { href: string }) => href,
}));

// `redirect()` throws NEXT_REDIRECT in Next. Reproducing that here is not
// cosmetic: the action must call it OUTSIDE its try/catch, or a successful
// sign-in gets caught and reported as a service outage.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectedTo = url;
    const err = new Error("NEXT_REDIRECT");
    (err as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${url}`;
    throw err;
  },
}));

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Map<string, string>()),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => Promise.resolve(true),
}));

const { signInAction } = await import("@/app/actions/auth");

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Runs the action, capturing the NEXT_REDIRECT throw as a destination. */
async function run(fields: Record<string, string>) {
  redirectedTo = null;
  try {
    const state = await signInAction(initialFormState, form(fields));
    return { state, redirectedTo };
  } catch (e) {
    if ((e as Error).message !== "NEXT_REDIRECT") throw e;
    return { state: null, redirectedTo };
  }
}

const GOOD = { email: "user@example.com", password: "correct horse battery" };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://real.supabase.co";
  signInCalls = [];
  signOutCalls = 0;
  scenario = {
    signInError: null,
    user: { id: "u-1" },
    profile: { role: "carrier", status: "active" },
  };
});

describe("the password is exchanged for a session", () => {
  it("calls signInWithPassword with the submitted credentials", async () => {
    await run(GOOD);
    expect(signInCalls).toEqual([
      { email: GOOD.email, password: GOOD.password },
    ]);
  });

  it("trims the email but never the password", async () => {
    // A trimmed password silently changes the secret; a trimmed email is
    // what the user meant. Only one of those is safe to normalise.
    await run({ email: "  user@example.com  ", password: "  spaced  " });
    expect(signInCalls[0]).toEqual({
      email: "user@example.com",
      password: "  spaced  ",
    });
  });

  it("refuses an empty submission without calling Supabase", async () => {
    const { state } = await run({ email: "", password: "" });
    expect(signInCalls).toEqual([]);
    expect(state?.status).toBe("error");
  });
});

describe("role routing — each role reaches its own portal", () => {
  const CASES: Array<[string, string]> = [
    ["shipper", "/portal/shipper"],
    ["carrier", "/portal/carrier"],
    ["broker", "/portal/broker"],
    ["admin", "/portal/admin"],
    ["dispatcher", "/portal/admin"],
  ];

  for (const [role, home] of CASES) {
    it(`a verified ${role} lands on ${home}`, async () => {
      scenario.profile = { role, status: "active" };
      const { redirectedTo: to } = await run(GOOD);
      expect(to).toBe(home);
    });
  }

  it("honours a safe ?next= over the role home", async () => {
    const { redirectedTo: to } = await run({
      ...GOOD,
      next: "/portal/carrier/documents",
    });
    expect(to).toBe("/portal/carrier/documents");
  });

  it("REFUSES a protocol-relative ?next= (open redirect)", async () => {
    // `//evil.com` passes startsWith("/") and is an absolute URL. A login
    // page that redirects off-site is a phishing page with a real cert.
    const { redirectedTo: to } = await run({ ...GOOD, next: "//evil.com" });
    expect(to).toBe("/portal/carrier");
  });

  it("REFUSES an absolute ?next=", async () => {
    const { redirectedTo: to } = await run({
      ...GOOD,
      next: "https://evil.com/harvest",
    });
    expect(to).toBe("/portal/carrier");
  });

  it("sends a suspended account to the login error state, not a portal", async () => {
    scenario.profile = { role: "carrier", status: "suspended" };
    const { redirectedTo: to } = await run(GOOD);
    expect(to).toContain("error=suspended");
    expect(to).not.toContain("/portal");
  });
});

describe("failures are generic and leak nothing", () => {
  it("a wrong password stays unauthenticated with a generic message", async () => {
    scenario.signInError = { message: "Invalid login credentials" };
    scenario.user = null;
    const { state, redirectedTo: to } = await run(GOOD);
    expect(to).toBeNull();
    expect(state?.status).toBe("error");
    expect(state?.message).toBe("Invalid email or password. Please try again.");
  });

  it("an unknown email is refused IDENTICALLY to a wrong password", async () => {
    // Different messages here turn the login form into an account oracle.
    scenario.signInError = { message: "Invalid login credentials" };
    scenario.user = null;
    const unknown = await run({ email: "nobody@example.com", password: "x" });
    const wrong = await run(GOOD);
    expect(unknown.state?.message).toBe(wrong.state?.message);
  });

  it("never forwards the Supabase message", async () => {
    scenario.signInError = { message: "AuthApiError: invalid_credentials (400)" };
    scenario.user = null;
    const { state } = await run(GOOD);
    expect(state?.message).not.toContain("AuthApiError");
    expect(state?.message).not.toContain("invalid_credentials");
  });

  it("keeps the unverified-email state distinguishable", async () => {
    // M-52 never auto-confirms, so collapsing this into "invalid password"
    // dead-ends every legitimate new signup.
    scenario.signInError = { message: "Email not confirmed" };
    scenario.user = null;
    const { state } = await run(GOOD);
    expect(state?.message).toMatch(/verify your email/i);
  });

  it("drops the session when the profile row is missing", async () => {
    // Authenticated with nowhere to go. Leaving the session established would
    // be a half-signed-in user bouncing off every portal gate.
    scenario.profile = null;
    const { state, redirectedTo: to } = await run(GOOD);
    expect(signOutCalls).toBe(1);
    expect(to).toBeNull();
    expect(state?.status).toBe("error");
  });

  it("reports an outage without claiming bad credentials", async () => {
    scenario.throws = true;
    const { state } = await run(GOOD);
    expect(state?.message).toMatch(/couldn't reach/i);
  });

  it("NO error message ever contains the submitted credentials", async () => {
    scenario.signInError = { message: "Invalid login credentials" };
    scenario.user = null;
    const { state } = await run(GOOD);
    expect(state?.message ?? "").not.toContain(GOOD.password);
    expect(state?.message ?? "").not.toContain(GOOD.email);
  });
});

describe("environment guards", () => {
  it("refuses to attempt sign-in against a placeholder project", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://placeholder.supabase.co";
    const { state } = await run(GOOD);
    expect(signInCalls).toEqual([]);
    expect(state?.message).toMatch(/not configured/i);
  });
});
