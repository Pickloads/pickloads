import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialFeeCheckoutState } from "@/lib/carrier-fee-state";

/**
 * M-95 — creating the $9.99 Checkout.
 *
 * ── THE TWO QUESTIONS ────────────────────────────────────────────────────
 *
 * 1. Can somebody who should not be paying reach a Checkout? (Manual review,
 *    a refused applicant, an expired or already-spent verification, no
 *    verification at all.) Every one of those must not produce a Stripe
 *    object, because a Checkout that exists can be paid, and a payment that
 *    exists has to be reconciled or refunded.
 *
 * 2. Can the session be for the wrong amount? The price is retrieved from
 *    Stripe and checked before a session is created, so a mistyped
 *    STRIPE_CARRIER_PREREG_PRICE_ID fails closed rather than charging a
 *    carrier fifty dollars or nothing at all.
 */

interface PriceStub {
  id: string;
  unit_amount: number | null;
  currency: string;
  recurring: unknown;
  active: boolean;
  livemode: boolean;
}

interface Scenario {
  rateLimitOk: boolean;
  gate:
    | { ok: true; preRegistration: { id: string; email: string } }
    | { ok: false; reason: string };
  adminAvailable: boolean;
  feeState: { paid: boolean; openSessionId: string | null; paidAt: string | null };
  stripeConfigured: boolean;
  priceId: string | undefined;
  price: PriceStub;
  priceRetrieveThrows: boolean;
  openSessionStatus: "open" | "expired";
  createThrows: boolean;
  createdSessionUrl: string | null;
  insertError: { message: string } | null;
}

let scenario: Scenario;
let created: Record<string, unknown>[] = [];
let inserted: { table: string; row: Record<string, unknown> }[] = [];
let expired: string[] = [];
let audits: string[] = [];

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => Promise.resolve(scenario.rateLimitOk),
}));

vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve(new Headers({ "x-forwarded-for": "1.2.3.4" })),
}));

vi.mock("@/lib/carrier-authority/precheck-session", () => ({
  readPrecheckCookie: () => Promise.resolve("cookie-id"),
  setPrecheckCookie: () => Promise.resolve(),
  clearPrecheckCookie: () => Promise.resolve(),
}));

vi.mock("@/lib/carrier-authority/pre-registration", () => ({
  loadEligiblePreRegistration: () => Promise.resolve(scenario.gate),
}));

vi.mock("@/lib/audit", () => ({
  recordAuditEvent: (e: { action: string }) => {
    audits.push(e.action);
    return Promise.resolve();
  },
}));

vi.mock("@/lib/stripe", () => ({
  tryCreateStripe: () =>
    scenario.stripeConfigured
      ? {
          prices: {
            retrieve: () => {
              if (scenario.priceRetrieveThrows) throw new Error("No such price");
              return Promise.resolve(scenario.price);
            },
          },
          checkout: {
            sessions: {
              retrieve: () =>
                Promise.resolve({
                  status: scenario.openSessionStatus,
                  url: "https://checkout.stripe.com/existing",
                }),
              create: (args: Record<string, unknown>) => {
                if (scenario.createThrows) throw new Error("Stripe is down");
                created.push(args);
                return Promise.resolve({
                  id: "cs_test_new",
                  url: scenario.createdSessionUrl,
                });
              },
              expire: (id: string) => {
                expired.push(id);
                return Promise.resolve({});
              },
            },
          },
        }
      : null,
}));

function chain(result: unknown) {
  const b: Record<string, unknown> = {};
  for (const m of ["eq", "neq", "is", "order", "limit", "select"]) b[m] = () => b;
  b.maybeSingle = () => Promise.resolve(result);
  b.single = () => Promise.resolve(result);
  b.then = (f?: (v: unknown) => unknown, r?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(f, r);
  return b;
}

vi.mock("@/lib/supabase/admin", () => ({
  tryCreateAdminClient: () =>
    scenario.adminAvailable
      ? {
          from: (table: string) => ({
            insert: (row: Record<string, unknown>) => {
              inserted.push({ table, row });
              return chain({ data: null, error: scenario.insertError });
            },
            select: () => chain({ data: [], error: null }),
            update: () => chain({ data: [], error: null }),
          }),
        }
      : null,
}));

vi.mock("@/lib/carrier-authority/onboarding-fee", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/carrier-authority/onboarding-fee")
    >();
  return {
    ...actual,
    // The ledger read is exercised on its own terms elsewhere; here it is a
    // dial, so each case can put the applicant in a known payment state.
    readFeePaymentState: () => Promise.resolve(scenario.feeState),
  };
});

const { startCarrierFeeCheckout } = await import("@/app/actions/carrier-fee");

const PRE = { id: "11111111-2222-4333-8444-555555555555", email: "a@b.test" };

beforeEach(() => {
  created = [];
  inserted = [];
  expired = [];
  audits = [];
  process.env.STRIPE_CARRIER_PREREG_PRICE_ID = "price_prereg";
  process.env.NEXT_PUBLIC_SITE_URL = "https://pickloads.com";
  scenario = {
    rateLimitOk: true,
    gate: { ok: true, preRegistration: PRE },
    adminAvailable: true,
    feeState: { paid: false, openSessionId: null, paidAt: null },
    stripeConfigured: true,
    priceId: "price_prereg",
    price: {
      id: "price_prereg",
      unit_amount: 999,
      currency: "usd",
      recurring: null,
      active: true,
      livemode: false,
    },
    priceRetrieveThrows: false,
    openSessionStatus: "open",
    createThrows: false,
    createdSessionUrl: "https://checkout.stripe.com/new",
    insertError: null,
  };
});

describe("who may reach a Checkout", () => {
  it("an eligible, unpaid applicant gets a Stripe URL", async () => {
    const state = await startCarrierFeeCheckout(
      initialFeeCheckoutState,
      new FormData(),
    );
    expect(state.status).toBe("redirect");
    expect(state.url).toBe("https://checkout.stripe.com/new");
    expect(created).toHaveLength(1);
  });

  const REFUSALS = [
    "missing",
    "malformed",
    "unknown",
    "expired",
    "already_claimed",
    "not_eligible",
    "unavailable",
  ];

  for (const reason of REFUSALS) {
    it(`creates NO Stripe object when the gate says ${reason}`, async () => {
      scenario.gate = { ok: false, reason };
      const state = await startCarrierFeeCheckout(
        initialFeeCheckoutState,
        new FormData(),
      );
      expect(state.status).toBe("error");
      expect(created).toEqual([]);
      expect(inserted).toEqual([]);
      expect(audits).toContain("carrier_fee_checkout_denied");
    });
  }

  it("a MANUAL_REVIEW applicant cannot buy their way past the gate", async () => {
    // `loadEligiblePreRegistration` refuses anything but eligible_to_continue,
    // so manual review never reaches a payment page at all — paying is not a
    // route to eligibility.
    scenario.gate = { ok: false, reason: "not_eligible" };
    const state = await startCarrierFeeCheckout(
      initialFeeCheckoutState,
      new FormData(),
    );
    expect(state.status).toBe("error");
    expect(created).toEqual([]);
  });

  it("refuses without the service role rather than charging blind", async () => {
    scenario.adminAvailable = false;
    scenario.gate = { ok: false, reason: "unavailable" };
    const state = await startCarrierFeeCheckout(
      initialFeeCheckoutState,
      new FormData(),
    );
    expect(state.status).toBe("error");
    expect(created).toEqual([]);
  });

  it("is rate limited before it touches Stripe", async () => {
    scenario.rateLimitOk = false;
    const state = await startCarrierFeeCheckout(
      initialFeeCheckoutState,
      new FormData(),
    );
    expect(state.status).toBe("error");
    expect(created).toEqual([]);
  });
});

describe("never a second charge", () => {
  it("an already-paid applicant is told so, and no session is made", async () => {
    scenario.feeState = { paid: true, openSessionId: null, paidAt: "2026-08-19" };
    const state = await startCarrierFeeCheckout(
      initialFeeCheckoutState,
      new FormData(),
    );
    expect(state.status).toBe("already_paid");
    expect(created).toEqual([]);
    expect(inserted).toEqual([]);
  });

  it("reuses an OPEN session instead of creating another", async () => {
    // Refreshing the fee step, or pressing the button twice, must not leave
    // two payable Checkouts for one $9.99 fee.
    scenario.feeState = {
      paid: false,
      openSessionId: "cs_test_open",
      paidAt: null,
    };
    const state = await startCarrierFeeCheckout(
      initialFeeCheckoutState,
      new FormData(),
    );
    expect(state.status).toBe("redirect");
    expect(state.url).toBe("https://checkout.stripe.com/existing");
    expect(created).toEqual([]);
  });

  it("creates a fresh one when the stored session has expired", async () => {
    scenario.feeState = {
      paid: false,
      openSessionId: "cs_test_open",
      paidAt: null,
    };
    scenario.openSessionStatus = "expired";
    const state = await startCarrierFeeCheckout(
      initialFeeCheckoutState,
      new FormData(),
    );
    expect(state.status).toBe("redirect");
    expect(created).toHaveLength(1);
  });
});

describe("the price is verified BEFORE a session exists", () => {
  const BAD: Array<[string, Partial<PriceStub>]> = [
    ["the amount is wrong", { unit_amount: 4999 }],
    ["the amount is zero", { unit_amount: 0 }],
    ["the amount is missing", { unit_amount: null }],
    ["the currency is wrong", { currency: "eur" }],
    ["it is a subscription", { recurring: { interval: "month" } }],
    ["it has been archived", { active: false }],
  ];

  for (const [name, patch] of BAD) {
    it(`refuses to create a session when ${name}`, async () => {
      scenario.price = { ...scenario.price, ...patch };
      const state = await startCarrierFeeCheckout(
        initialFeeCheckoutState,
        new FormData(),
      );
      expect(state.status).toBe("error");
      expect(created).toEqual([]);
      expect(audits).toContain("carrier_fee_price_misconfigured");
    });
  }

  it("refuses when the price id is not configured", async () => {
    delete process.env.STRIPE_CARRIER_PREREG_PRICE_ID;
    const state = await startCarrierFeeCheckout(
      initialFeeCheckoutState,
      new FormData(),
    );
    expect(state.status).toBe("error");
    expect(created).toEqual([]);
  });

  it("refuses when Stripe cannot tell us what the price is", async () => {
    scenario.priceRetrieveThrows = true;
    const state = await startCarrierFeeCheckout(
      initialFeeCheckoutState,
      new FormData(),
    );
    expect(state.status).toBe("error");
    expect(created).toEqual([]);
  });

  it("refuses when Stripe is not configured at all", async () => {
    scenario.stripeConfigured = false;
    const state = await startCarrierFeeCheckout(
      initialFeeCheckoutState,
      new FormData(),
    );
    expect(state.status).toBe("error");
    expect(created).toEqual([]);
  });
});

describe("what the session carries", () => {
  it("links the payment to the pre-registration on both objects", async () => {
    await startCarrierFeeCheckout(initialFeeCheckoutState, new FormData());
    const args = created[0]!;
    expect(args.mode).toBe("payment");
    expect(args.metadata).toMatchObject({
      purpose: "carrier_prereg_fee",
      pre_registration_id: PRE.id,
    });
    expect(
      (args.payment_intent_data as { metadata: Record<string, string> })
        .metadata,
    ).toMatchObject({ pre_registration_id: PRE.id });
  });

  it("uses the configured PRICE, never an inline amount", async () => {
    await startCarrierFeeCheckout(initialFeeCheckoutState, new FormData());
    const items = created[0]!.line_items as Array<Record<string, unknown>>;
    expect(items).toEqual([{ price: "price_prereg", quantity: 1 }]);
    // An inline price_data would mean the amount lives in code, which is
    // exactly what "do not hard-code a production Price ID" is guarding.
    expect(JSON.stringify(created[0])).not.toContain("price_data");
    expect(JSON.stringify(created[0])).not.toContain("unit_amount");
  });

  it("returns the applicant to a SERVER route, not to a success page", async () => {
    await startCarrierFeeCheckout(initialFeeCheckoutState, new FormData());
    expect(created[0]!.success_url).toBe(
      "https://pickloads.com/become-a-carrier/payment?return=success",
    );
    expect(created[0]!.cancel_url).toBe(
      "https://pickloads.com/become-a-carrier/payment?return=cancelled",
    );
  });

  it("records the session with the amount from the VERIFIED price", async () => {
    await startCarrierFeeCheckout(initialFeeCheckoutState, new FormData());
    const row = inserted.find(
      (i) => i.table === "carrier_onboarding_payments",
    )!.row;
    expect(row.status).toBe("session_created");
    expect(row.amount_cents).toBe(999);
    expect(row.currency).toBe("usd");
    expect(row.test_mode).toBe(true);
    expect(row.provider_session_id).toBe("cs_test_new");
    expect(row.pre_registration_id).toBe(PRE.id);
    // Never a card number, never a token, never a secret.
    expect(JSON.stringify(row)).not.toMatch(/card|cvc|sk_|whsec_/i);
  });
});

describe("failures leave nothing payable behind", () => {
  it("expires the session when the ledger row cannot be written", async () => {
    // A payment with no row is money taken for something we cannot prove they
    // bought. Better to cancel the Checkout than to let it be paid.
    scenario.insertError = { message: "connection reset" };
    const state = await startCarrierFeeCheckout(
      initialFeeCheckoutState,
      new FormData(),
    );
    expect(state.status).toBe("error");
    expect(expired).toEqual(["cs_test_new"]);
    expect(audits).toContain("carrier_fee_checkout_failed");
  });

  it("reports a Stripe outage without marking anything", async () => {
    scenario.createThrows = true;
    const state = await startCarrierFeeCheckout(
      initialFeeCheckoutState,
      new FormData(),
    );
    expect(state.status).toBe("error");
    expect(inserted).toEqual([]);
    expect(state.message ?? "").not.toMatch(/stripe is down/i);
  });

  it("never leaks a secret or a Stripe error in the customer message", async () => {
    for (const arrange of [
      () => {
        scenario.createThrows = true;
      },
      () => {
        scenario.priceRetrieveThrows = true;
      },
      () => {
        scenario.stripeConfigured = false;
      },
    ]) {
      arrange();
      const state = await startCarrierFeeCheckout(
        initialFeeCheckoutState,
        new FormData(),
      );
      const msg = (state.message ?? "").toLowerCase();
      for (const leak of ["sk_", "whsec_", "price_", "no such", "api key"]) {
        expect(msg, leak).not.toContain(leak);
      }
    }
  });
});

describe("nothing the browser sends is read", () => {
  it("a forged amount, price or applicant id changes nothing", async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({
      amount: "1",
      amount_cents: "1",
      price: "price_free",
      price_id: "price_free",
      pre_registration_id: "99999999-9999-4999-8999-999999999999",
      paid: "true",
      payment_status: "paid",
    })) {
      fd.set(k, v);
    }
    const state = await startCarrierFeeCheckout(initialFeeCheckoutState, fd);
    expect(state.status).toBe("redirect");
    const args = created[0]!;
    expect(args.line_items).toEqual([{ price: "price_prereg", quantity: 1 }]);
    expect(args.metadata).toMatchObject({ pre_registration_id: PRE.id });
    const row = inserted[0]!.row;
    expect(row.amount_cents).toBe(999);
    expect(row.status).toBe("session_created");
  });

  it("the action's source reads no form field at all", () => {
    const src = readFileSync("src/app/actions/carrier-fee.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ");
    expect(src).not.toContain("formData.get");
    expect(src).not.toContain("field(");
  });
});

describe("the public state shape cannot hold a payment verdict", () => {
  it("has no paid, amount or session field", () => {
    const src = readFileSync("src/lib/carrier-fee-state.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ");
    for (const forbidden of ["paid:", "amount", "sessionId", "session_id"]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });

  it("the fee library and the action are server-only", () => {
    for (const f of [
      "src/lib/carrier-authority/onboarding-fee.ts",
      "src/lib/carrier-authority/wizard-resume.ts",
    ]) {
      expect(readFileSync(f, "utf8"), f).toContain('import "server-only"');
    }
  });

  it("no client component imports the Stripe SDK or a secret", () => {
    for (const f of [
      "src/components/onboarding/CarrierFeeStep.tsx",
      "src/components/onboarding/CarrierWizard.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toContain("STRIPE_SECRET_KEY");
      expect(src, f).not.toContain("STRIPE_WEBHOOK_SECRET");
      expect(src, f).not.toMatch(/from "stripe"/);
    }
  });
});
