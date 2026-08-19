import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialPrecheckState } from "@/lib/carrier-precheck-state";

/**
 * M-94 §19/§26 — the public entry point.
 *
 * `carrier-precheck.test.ts` proves the DECISIONS are right. This file proves
 * the door in front of them: that an anonymous request runs the same rate
 * limit and Turnstile pipeline as every other public form, that it does so
 * BEFORE any FMCSA call is made, and that the only thing the browser is handed
 * back is which screen to render.
 *
 * ── WHY THE ABUSE CASE IS THE POINT ──────────────────────────────────────
 *
 * §19: this endpoint performs an FMCSA lookup on demand, unauthenticated, with
 * our credential paying for it. Without the guard in front, PickLoads is a
 * free FMCSA enumeration proxy — and the person enumerating gets to do it from
 * behind our WebKey. So the assertion that matters most below is not that a
 * refused submission returns an error; it is that a refused submission never
 * reaches the provider at all.
 */

interface Scenario {
  guard: { ok: true; ip: string } | { ok: false; message: string };
  decision: "eligible_to_continue" | "manual_review" | "not_eligible";
  preRegistrationId: string | null;
}

let scenario: Scenario;
let precheckRuns = 0;
let cookieSet: string | null = null;

vi.mock("@/lib/forms/guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/guard")>();
  return { ...actual, guardPublicForm: () => Promise.resolve(scenario.guard) };
});

vi.mock("@/lib/carrier-authority/pre-registration", () => ({
  runCarrierPrecheck: () => {
    precheckRuns += 1;
    return Promise.resolve({
      decision: scenario.decision,
      preRegistrationId: scenario.preRegistrationId,
      publicReasonCodes: [],
    });
  },
}));

vi.mock("@/lib/carrier-authority/precheck-session", () => ({
  setPrecheckCookie: (id: string) => {
    cookieSet = id;
    return Promise.resolve();
  },
  readPrecheckCookie: () => Promise.resolve(null),
  clearPrecheckCookie: () => Promise.resolve(),
}));

const { submitCarrierPrecheck } = await import(
  "@/app/actions/carrier-precheck"
);

function form(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    legal_name: "Acme Trucking LLC",
    usdot_number: "76830",
    mc_number: "MC-123456",
    email: "ops@acme.example",
    locale: "en",
  };
  for (const [k, v] of Object.entries({ ...base, ...over })) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  precheckRuns = 0;
  cookieSet = null;
  scenario = {
    guard: { ok: true, ip: "1.2.3.4" },
    decision: "eligible_to_continue",
    preRegistrationId: "pre-reg-1",
  };
});

describe("§19 · the guard runs before FMCSA does", () => {
  it("a rate-limited submission never reaches the provider", async () => {
    scenario.guard = {
      ok: false,
      message: "Too many requests from your network.",
    };
    const state = await submitCarrierPrecheck(initialPrecheckState, form());
    expect(state.status).toBe("error");
    expect(precheckRuns).toBe(0);
  });

  it("a failed Turnstile never reaches the provider", async () => {
    scenario.guard = {
      ok: false,
      message: "We couldn't verify your submission.",
    };
    const state = await submitCarrierPrecheck(initialPrecheckState, form());
    expect(state.status).toBe("error");
    expect(precheckRuns).toBe(0);
  });

  it("an invalid USDOT never reaches the provider either", async () => {
    const state = await submitCarrierPrecheck(
      initialPrecheckState,
      form({ usdot_number: "not-a-number" }),
    );
    expect(state.status).toBe("error");
    expect(precheckRuns).toBe(0);
  });

  it("the refusal says nothing about how the limit is keyed", async () => {
    scenario.guard = {
      ok: false,
      message: "Too many requests from your network.",
    };
    const state = await submitCarrierPrecheck(initialPrecheckState, form());
    const message = (state.message ?? "").toLowerCase();
    for (const leak of ["ip", "upstash", "redis", "bucket", "window", "token"]) {
      expect(message).not.toContain(leak);
    }
  });
});

describe("§17 · the browser is told a screen, not a decision", () => {
  it("an eligible check sets the httpOnly cookie and returns no id", async () => {
    const state = await submitCarrierPrecheck(initialPrecheckState, form());
    expect(state.status).toBe("eligible");
    expect(cookieSet).toBe("pre-reg-1");
    // The id is NOT in the returned state: page script cannot read it, cannot
    // log it, and cannot paste it into a link.
    expect(Object.keys(state)).toEqual(["status"]);
  });

  it("manual review sets no cookie", async () => {
    scenario.decision = "manual_review";
    scenario.preRegistrationId = null;
    const state = await submitCarrierPrecheck(initialPrecheckState, form());
    expect(state.status).toBe("manual_review");
    expect(cookieSet).toBeNull();
  });

  it("a refusal sets no cookie", async () => {
    scenario.decision = "not_eligible";
    scenario.preRegistrationId = null;
    const state = await submitCarrierPrecheck(initialPrecheckState, form());
    expect(state.status).toBe("not_eligible");
    expect(cookieSet).toBeNull();
  });

  it("an eligible decision with no stored record degrades to manual review", async () => {
    // Unreachable by construction; handled anyway, because an "eligible"
    // screen with nothing behind it is a dead end at the next step.
    scenario.preRegistrationId = null;
    const state = await submitCarrierPrecheck(initialPrecheckState, form());
    expect(state.status).toBe("manual_review");
    expect(cookieSet).toBeNull();
  });

  it("client-supplied verdict fields change nothing", async () => {
    scenario.decision = "not_eligible";
    scenario.preRegistrationId = null;
    const state = await submitCarrierPrecheck(
      initialPrecheckState,
      form({
        verified: "true",
        eligible: "true",
        fmcsaPassed: "true",
        paid: "true",
        approved: "true",
        active: "true",
        decision: "eligible_to_continue",
      }),
    );
    expect(state.status).toBe("not_eligible");
    expect(cookieSet).toBeNull();
  });
});
