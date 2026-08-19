import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * M-95 — the Stripe webhook is the ONLY thing that may say "paid".
 *
 * ── WHAT THIS FILE IS DEFENDING ──────────────────────────────────────────
 *
 * Everything upstream of a payment can be forged by whoever is holding the
 * browser: the return URL, the query string, the client state, the metadata
 * they can see in devtools. The webhook is the one channel Stripe signs, and
 * it is therefore the one place a `paid` row may come from.
 *
 * So the assertions come in two shapes. Positive: a genuine, signed,
 * correctly-priced session settles exactly once. Negative — and there are far
 * more of these — every other combination writes nothing:
 *
 *   unsigned · badly signed · replayed · someone else's payment · the right
 *   label with the wrong amount · the right amount in the wrong currency ·
 *   the right money against the wrong Price · `completed` but not yet paid ·
 *   expired · a session we never created · a database that will not write.
 */

interface StripeStub {
  event: unknown;
  constructThrows: boolean;
  lineItemPriceIds: string[];
  listLineItemsThrows: boolean;
}

interface DbRow {
  id: string;
  status: string;
}

interface Scenario {
  secret: string | undefined;
  priceId: string | undefined;
  adminAvailable: boolean;
  /** 23505 = the webhook_events dedup key rejecting a replay. */
  webhookInsertError: { code?: string; message: string } | null;
  /** Rows the ledger returns for the session lookup after a failed update. */
  existingPaymentRow: DbRow | null;
  paymentUpdateMatches: number;
  paymentUpdateError: { message: string } | null;
}

let scenario: Scenario;
let stripeStub: StripeStub;
let updates: { table: string; row: Record<string, unknown> }[] = [];
let audits: string[] = [];
let emails: string[] = [];

vi.mock("@/lib/stripe", () => ({
  tryCreateStripe: () =>
    scenario.secret === undefined
      ? null
      : {
          webhooks: {
            constructEventAsync: () => {
              if (stripeStub.constructThrows) {
                throw new Error("No signatures found matching the expected signature");
              }
              return Promise.resolve(stripeStub.event);
            },
          },
          checkout: {
            sessions: {
              listLineItems: () => {
                if (stripeStub.listLineItemsThrows) {
                  throw new Error("Stripe unreachable");
                }
                return Promise.resolve({
                  data: stripeStub.lineItemPriceIds.map((id) => ({
                    price: { id },
                  })),
                });
              },
            },
          },
        },
}));

vi.mock("@/lib/audit", () => ({
  recordAuditEvent: (e: { action: string }) => {
    audits.push(e.action);
    return Promise.resolve();
  },
}));

vi.mock("@/lib/email/send", () => ({
  EMAIL_INTERNAL_TO: "ops@example.com",
  sendEmail: ({ subject }: { subject: string }) => {
    emails.push(subject);
    return Promise.resolve({ ok: true });
  },
}));

vi.mock("@/lib/notify", () => ({
  getCarrierOwnerRecipient: () => Promise.resolve(null),
  notifyCustomer: () => Promise.resolve(),
}));

function chain(result: unknown) {
  const b: Record<string, unknown> = {};
  for (const m of ["eq", "neq", "is", "in", "order", "limit", "select"]) {
    b[m] = () => b;
  }
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
            insert: () =>
              chain({
                data: { id: "wh-1" },
                error: scenario.webhookInsertError,
              }),
            update: (row: Record<string, unknown>) => {
              updates.push({ table, row });
              if (table === "carrier_onboarding_payments") {
                return chain({
                  data: Array.from(
                    { length: scenario.paymentUpdateMatches },
                    () => ({ id: "pay-1" }),
                  ),
                  error: scenario.paymentUpdateError,
                });
              }
              return chain({ data: [{ id: "x" }], error: null });
            },
            select: () => chain({ data: scenario.existingPaymentRow, error: null }),
          }),
        }
      : null,
}));

const { POST } = await import("@/app/api/stripe/webhook/route");

const PRE_ID = "11111111-2222-4333-8444-555555555555";
const PRICE_ID = "price_carrier_prereg_test";

function checkoutEvent(over: Record<string, unknown> = {}) {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    created: 1_760_000_000,
    livemode: false,
    data: {
      object: {
        id: "cs_test_1",
        metadata: {
          purpose: "carrier_prereg_fee",
          pre_registration_id: PRE_ID,
        },
        payment_status: "paid",
        amount_total: 999,
        currency: "usd",
        payment_intent: "pi_test_1",
        status: "complete",
        ...over,
      },
    },
  };
}

function post(body = "{}") {
  return POST(
    new Request("https://pickloads.com/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=deadbeef" },
      body,
    }),
  );
}

function paymentUpdates() {
  return updates.filter((u) => u.table === "carrier_onboarding_payments");
}

function settledPaid() {
  return paymentUpdates().some((u) => u.row.status === "paid");
}

beforeEach(() => {
  updates = [];
  audits = [];
  emails = [];
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.STRIPE_CARRIER_PREREG_PRICE_ID = PRICE_ID;
  scenario = {
    secret: "whsec_test",
    priceId: PRICE_ID,
    adminAvailable: true,
    webhookInsertError: null,
    existingPaymentRow: null,
    paymentUpdateMatches: 1,
    paymentUpdateError: null,
  };
  stripeStub = {
    event: checkoutEvent(),
    constructThrows: false,
    lineItemPriceIds: [PRICE_ID],
    listLineItemsThrows: false,
  };
});

/* ── The channel itself ─────────────────────────────────────────────────── */

describe("the signature is the whole basis of trust", () => {
  it("refuses a request with no signature header", async () => {
    const res = await POST(
      new Request("https://pickloads.com/api/stripe/webhook", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(res.status).toBe(400);
    expect(settledPaid()).toBe(false);
  });

  it("refuses a FORGED signature with 401 and writes nothing", async () => {
    stripeStub.constructThrows = true;
    const res = await post();
    expect(res.status).toBe(401);
    expect(updates).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("refuses to run at all without a configured signing secret", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    scenario.secret = undefined;
    const res = await post();
    expect(res.status).toBe(503);
    expect(settledPaid()).toBe(false);
  });

  it("asks Stripe to retry rather than losing an event when storage is down", async () => {
    scenario.adminAvailable = false;
    const res = await post();
    expect(res.status).toBe(503);
  });
});

describe("idempotency", () => {
  it("a replayed delivery is acknowledged and changes nothing", async () => {
    scenario.webhookInsertError = { code: "23505", message: "duplicate key" };
    const res = await post();
    expect(res.status).toBe(200);
    // The dedup key short-circuits BEFORE any handler runs.
    expect(updates).toEqual([]);
    expect(settledPaid()).toBe(false);
  });

  it("a second settle of the same session does not re-stamp paid_at", async () => {
    // The conditional UPDATE matched nothing because the row is already paid.
    scenario.paymentUpdateMatches = 0;
    scenario.existingPaymentRow = { id: "pay-1", status: "paid" };
    const res = await post();
    expect(res.status).toBe(200);
    expect(audits).toContain("carrier_fee_paid_duplicate_event");
    expect(audits).not.toContain("carrier_fee_paid");
  });
});

/* ── Is this payment ours, and is it the right payment? ─────────────────── */

describe("what may become a paid row", () => {
  it("settles a genuine, correctly priced session exactly once", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    const paid = paymentUpdates().filter((u) => u.row.status === "paid");
    expect(paid).toHaveLength(1);
    expect(paid[0]!.row.paid_at).toEqual(expect.any(String));
    expect(paid[0]!.row.amount_cents).toBe(999);
    expect(paid[0]!.row.currency).toBe("usd");
    // livemode false → a TEST payment, and it must be recorded as one so it
    // is never mistaken for revenue.
    expect(paid[0]!.row.test_mode).toBe(true);
    expect(audits).toContain("carrier_fee_paid");
  });

  it("ignores a payment that is not ours", async () => {
    stripeStub.event = checkoutEvent({
      metadata: { purpose: "something_else", pre_registration_id: PRE_ID },
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(paymentUpdates()).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("does NOT settle a completed session that is not yet paid", async () => {
    // Delayed payment methods fire `completed` with `payment_status: unpaid`.
    // Treating completed as paid is the likeliest way to give away the product.
    stripeStub.event = checkoutEvent({ payment_status: "unpaid" });
    const res = await post();
    expect(res.status).toBe(200);
    expect(settledPaid()).toBe(false);
    expect(audits).toContain("carrier_fee_not_settled");
  });

  it("REFUSES the right label with the wrong amount", async () => {
    stripeStub.event = checkoutEvent({ amount_total: 1 });
    const res = await post();
    expect(res.status).toBe(500); // → Stripe retries; a human sees the alert
    expect(settledPaid()).toBe(false);
    expect(audits).toContain("carrier_fee_amount_mismatch");
    expect(emails.join(" ")).toMatch(/webhook failure/i);
  });

  it("REFUSES the right amount in the wrong currency", async () => {
    stripeStub.event = checkoutEvent({ currency: "eur" });
    const res = await post();
    expect(res.status).toBe(500);
    expect(settledPaid()).toBe(false);
    expect(audits).toContain("carrier_fee_amount_mismatch");
  });

  it("REFUSES the right money charged against the wrong Price", async () => {
    // The check metadata cannot fake: what did Stripe actually charge?
    stripeStub.lineItemPriceIds = ["price_some_other_product"];
    const res = await post();
    expect(res.status).toBe(500);
    expect(settledPaid()).toBe(false);
    expect(audits).toContain("carrier_fee_price_mismatch");
  });

  it("REFUSES a session with more than one line item", async () => {
    stripeStub.lineItemPriceIds = [PRICE_ID, PRICE_ID];
    const res = await post();
    expect(res.status).toBe(500);
    expect(settledPaid()).toBe(false);
  });

  it("REFUSES when no expected Price is configured at all", async () => {
    delete process.env.STRIPE_CARRIER_PREREG_PRICE_ID;
    const res = await post();
    expect(res.status).toBe(500);
    expect(settledPaid()).toBe(false);
  });

  it("does not settle when Stripe cannot be re-asked about the line items", async () => {
    stripeStub.listLineItemsThrows = true;
    const res = await post();
    expect(res.status).toBe(500);
    expect(settledPaid()).toBe(false);
  });

  it("REFUSES our own metadata on a session we never created", async () => {
    scenario.paymentUpdateMatches = 0;
    scenario.existingPaymentRow = null;
    const res = await post();
    expect(res.status).toBe(500);
    expect(audits).not.toContain("carrier_fee_paid");
  });

  it("REFUSES a session carrying no usable pre-registration id", async () => {
    stripeStub.event = checkoutEvent({
      metadata: { purpose: "carrier_prereg_fee", pre_registration_id: "nope" },
    });
    const res = await post();
    expect(res.status).toBe(500);
    expect(settledPaid()).toBe(false);
  });

  it("does NOT mark paid when the database will not write", async () => {
    scenario.paymentUpdateError = { message: "connection reset" };
    const res = await post();
    // 500 → Stripe retries → it eventually lands. Never a silent success.
    expect(res.status).toBe(500);
    expect(audits).not.toContain("carrier_fee_paid");
  });
});

/* ── The other lifecycle events ─────────────────────────────────────────── */

describe("sessions that end without a payment", () => {
  for (const type of [
    "checkout.session.expired",
    "checkout.session.async_payment_failed",
  ]) {
    it(`${type} closes the row out and never touches a paid one`, async () => {
      stripeStub.event = { ...checkoutEvent(), type };
      const res = await post();
      expect(res.status).toBe(200);
      const closed = paymentUpdates().find((u) => u.row.status === "failed");
      expect(closed).toBeDefined();
      expect(settledPaid()).toBe(false);
      expect(audits).toContain("carrier_fee_checkout_closed");
    });
  }

  it("an async payment that later SUCCEEDS does settle", async () => {
    stripeStub.event = {
      ...checkoutEvent(),
      type: "checkout.session.async_payment_succeeded",
    };
    const res = await post();
    expect(res.status).toBe(200);
    expect(settledPaid()).toBe(true);
  });
});

describe("refunds are recorded, never initiated", () => {
  it("marks a refunded fee refunded", async () => {
    stripeStub.event = {
      id: "evt_r",
      type: "charge.refunded",
      created: 1_760_000_100,
      livemode: false,
      data: {
        object: {
          id: "ch_1",
          metadata: {
            purpose: "carrier_prereg_fee",
            pre_registration_id: PRE_ID,
          },
          amount_refunded: 999,
        },
      },
    };
    const res = await post();
    expect(res.status).toBe(200);
    expect(paymentUpdates().some((u) => u.row.status === "refunded")).toBe(true);
    expect(audits).toContain("carrier_fee_refunded");
  });

  it("ignores refunds for payments that are not ours", async () => {
    stripeStub.event = {
      id: "evt_r2",
      type: "charge.refunded",
      created: 1_760_000_100,
      livemode: false,
      data: { object: { id: "ch_2", metadata: { purpose: "dispatch_fee" } } },
    };
    const res = await post();
    expect(res.status).toBe(200);
    expect(paymentUpdates()).toEqual([]);
  });
});

describe("unknown events", () => {
  it("are acknowledged and acted on by nothing", async () => {
    stripeStub.event = {
      id: "evt_x",
      type: "customer.subscription.created",
      created: 1_760_000_200,
      livemode: false,
      data: { object: { id: "sub_1" } },
    };
    const res = await post();
    expect(res.status).toBe(200);
    expect(paymentUpdates()).toEqual([]);
    expect(audits).toEqual([]);
  });
});
