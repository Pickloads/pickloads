import "server-only";

import { recordAuditEvent } from "@/lib/audit";
import { tryCreateStripe, type Stripe } from "@/lib/stripe";
import { tryCreateAdminClient } from "@/lib/supabase/admin";

/**
 * M-95 — the $9.99 carrier pre-registration fee.
 *
 * ── WHAT IS AUTHORITATIVE, STATED ONCE ───────────────────────────────────
 *
 * A `carrier_onboarding_payments` row with `status = 'paid'`, written by the
 * Stripe webhook after Stripe told us — over a signature-verified channel —
 * that the session was paid. Nothing else. Not a query parameter, not the
 * return page, not a client state field, not `carrier_pre_registrations.
 * payment_status` (which is a MIRROR this module also maintains for the staff
 * queue, and which the gate deliberately does not read).
 *
 * The reason the mirror is not the gate's source: two columns that mean the
 * same thing will disagree eventually, and when they do, the safe one to
 * believe is the ledger with the unique constraint on it.
 *
 * ── THE AMOUNT IS VERIFIED THREE TIMES, IN THREE PLACES ──────────────────
 *
 *   1. BEFORE a session is created — the configured Price is retrieved and
 *      checked against 999 / usd / one-time. A misconfigured `STRIPE_
 *      CARRIER_PREREG_PRICE_ID` must not become a $0 or a $999 checkout.
 *   2. In the SESSION — `amount_total` and `currency` on the completed event.
 *   3. In the LINE ITEMS — the price actually charged is re-read from Stripe
 *      and compared with the configured id, because `metadata` is set by us
 *      but a session could in principle be created by some other code path
 *      with the right metadata and the wrong price.
 *
 * Checks 2 and 3 are what make check 1 more than a comment. A webhook that
 * trusted its own metadata would accept a $0.50 payment carrying
 * `purpose: carrier_prereg_fee`.
 */

/** $9.99, in cents. The only amount this fee may ever be. */
export const CARRIER_PREREG_FEE_CENTS = 999;
export const CARRIER_PREREG_CURRENCY = "usd";

/**
 * Marks a Checkout Session as OURS.
 *
 * The account may take other payments (M-31 dispatch-fee invoices already
 * exist), and the webhook must never mistake one for the other. Absence of
 * this value means "not a carrier pre-registration fee", and the handler
 * leaves such events alone rather than guessing.
 */
export const CARRIER_PREREG_PURPOSE = "carrier_prereg_fee";

export type FeeConfigError =
  | "stripe_not_configured"
  | "price_not_configured"
  | "price_unreadable"
  | "price_wrong_amount"
  | "price_wrong_currency"
  | "price_not_one_time"
  | "price_inactive";

export type PriceCheck =
  | { ok: true; price: Stripe.Price; livemode: boolean }
  | { ok: false; reason: FeeConfigError; detail: string };

/**
 * Retrieve the configured Price and prove it is the $9.99 one-time USD fee.
 *
 * Called before every session creation rather than cached: a Price can be
 * archived or replaced in the Stripe dashboard between two requests, and the
 * failure mode of a stale cache here is charging the wrong amount.
 */
export async function verifyConfiguredPrice(
  stripe: Stripe | null = tryCreateStripe(),
): Promise<PriceCheck> {
  if (!stripe) {
    return {
      ok: false,
      reason: "stripe_not_configured",
      detail: "STRIPE_SECRET_KEY unset",
    };
  }
  const priceId = process.env.STRIPE_CARRIER_PREREG_PRICE_ID;
  if (!priceId) {
    return {
      ok: false,
      reason: "price_not_configured",
      detail: "STRIPE_CARRIER_PREREG_PRICE_ID unset",
    };
  }

  let price: Stripe.Price;
  try {
    price = await stripe.prices.retrieve(priceId);
  } catch (err) {
    // Stripe unreachable, or the id does not exist in this mode. Either way we
    // do not know what we would be charging, so we charge nothing.
    return {
      ok: false,
      reason: "price_unreadable",
      detail: err instanceof Error ? err.name : "unknown",
    };
  }

  if (price.active === false) {
    return { ok: false, reason: "price_inactive", detail: priceId };
  }
  // `recurring` non-null means a subscription. §"one-time payment".
  if (price.recurring !== null && price.recurring !== undefined) {
    return { ok: false, reason: "price_not_one_time", detail: priceId };
  }
  if (price.currency !== CARRIER_PREREG_CURRENCY) {
    return {
      ok: false,
      reason: "price_wrong_currency",
      detail: `${price.currency} != ${CARRIER_PREREG_CURRENCY}`,
    };
  }
  if (price.unit_amount !== CARRIER_PREREG_FEE_CENTS) {
    return {
      ok: false,
      reason: "price_wrong_amount",
      detail: `${price.unit_amount} != ${CARRIER_PREREG_FEE_CENTS}`,
    };
  }

  return { ok: true, price, livemode: price.livemode };
}

/* ── The authoritative payment read ─────────────────────────────────────── */

export interface FeePaymentState {
  /** THE gate condition. True only for a stored `paid` row. */
  paid: boolean;
  /** An open Checkout the applicant can be sent back to, if any. */
  openSessionId: string | null;
  /** Present once paid, for display and reconciliation. */
  paidAt: string | null;
}

/**
 * Read the fee state for a pre-registration from the LEDGER.
 *
 * Never takes a "trust me" parameter, never consults the request, and never
 * reads `carrier_pre_registrations.payment_status`. A caller that wants to
 * know whether the fee is paid has exactly this one way to find out.
 */
export async function readFeePaymentState(
  admin: NonNullable<ReturnType<typeof tryCreateAdminClient>>,
  preRegistrationId: string,
): Promise<FeePaymentState> {
  const { data, error } = await admin
    .from("carrier_onboarding_payments")
    .select("provider_session_id, status, paid_at")
    .eq("pre_registration_id", preRegistrationId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    // A read failure is NOT "unpaid, go ahead and pay again" and it is NOT
    // "paid". It is "we do not know", and the only safe unknown here is the
    // one that refuses to advance.
    console.error("[fee] payment read failed", error.message);
    return { paid: false, openSessionId: null, paidAt: null };
  }

  const rows = data ?? [];
  const paidRow = rows.find((r) => r.status === "paid");
  if (paidRow) {
    return {
      paid: true,
      openSessionId: null,
      paidAt: paidRow.paid_at,
    };
  }
  const open = rows.find((r) => r.status === "session_created");
  return {
    paid: false,
    openSessionId: open?.provider_session_id ?? null,
    paidAt: null,
  };
}

/* ── Recording a completed payment ──────────────────────────────────────── */

export type SettleOutcome =
  | "settled"
  | "already_settled"
  | "no_matching_session"
  | "storage_failure";

/**
 * Mark a session paid. Idempotent, and safe to call twice.
 *
 * ── WHY THE UPDATE IS CONDITIONAL ────────────────────────────────────────
 *
 * `where status <> 'paid'` means a replayed webhook — one that somehow got
 * past the `webhook_events` dedup, e.g. Stripe re-sending under a new event id
 * after an outage — updates nothing and reports `already_settled` rather than
 * rewriting `paid_at` to a later time. The row's timestamps are reconciliation
 * evidence; moving them because a message arrived twice would corrupt that.
 *
 * The database has the last word regardless: 0032's
 * `onboarding_payments_one_paid_per_pre_registration` is a unique partial
 * index over `status = 'paid'`, so a second paid row for one applicant cannot
 * exist even if every check above it were removed.
 */
export async function settleFeePayment(
  admin: NonNullable<ReturnType<typeof tryCreateAdminClient>>,
  input: {
    sessionId: string;
    paymentIntentId: string | null;
    preRegistrationId: string;
    amountCents: number;
    currency: string;
    livemode: boolean;
    paidAt: string;
  },
): Promise<SettleOutcome> {
  const { data, error } = await admin
    .from("carrier_onboarding_payments")
    .update({
      status: "paid",
      paid_at: input.paidAt,
      provider_payment_intent_id: input.paymentIntentId,
      // Recorded from the SESSION, never from the browser, and re-asserted
      // here so the stored figure is the one Stripe actually captured.
      amount_cents: input.amountCents,
      currency: input.currency,
      test_mode: !input.livemode,
    })
    .eq("provider", "stripe")
    .eq("provider_session_id", input.sessionId)
    .eq("pre_registration_id", input.preRegistrationId)
    .neq("status", "paid")
    .select("id");

  if (error) {
    console.error("[fee] settle failed", error.message);
    return "storage_failure";
  }
  if ((data?.length ?? 0) === 1) return "settled";

  // Nothing matched. Either it is already paid (fine) or the session belongs
  // to no row we created (not fine — the caller audits it).
  const { data: existing } = await admin
    .from("carrier_onboarding_payments")
    .select("id, status")
    .eq("provider", "stripe")
    .eq("provider_session_id", input.sessionId)
    .maybeSingle();
  return existing ? "already_settled" : "no_matching_session";
}

/**
 * Keep `carrier_pre_registrations.payment_status` in step.
 *
 * A MIRROR, for the staff queue, and explicitly NOT the gate's source (see
 * the header). Best effort: a failure here is logged and does not un-settle a
 * payment Stripe has already taken.
 *
 * It writes ONLY `payment_status`. It does not touch `decision`, and that is
 * the §"MANUAL REVIEW" requirement in code form: paying cannot make an
 * applicant eligible, because the code path that records payment has no
 * ability to write eligibility.
 */
export async function mirrorPaymentStatus(
  admin: NonNullable<ReturnType<typeof tryCreateAdminClient>>,
  preRegistrationId: string,
  status: "paid" | "failed" | "refunded" | "session_created",
): Promise<void> {
  const { error } = await admin
    .from("carrier_pre_registrations")
    .update({ payment_status: status })
    .eq("id", preRegistrationId);
  if (error) {
    console.error("[fee] payment mirror failed", error.message);
  }
}

/** One place for the fee's audit vocabulary, so the ledger stays greppable. */
export async function auditFee(
  action: string,
  preRegistrationId: string | null,
  detail: Record<string, unknown>,
): Promise<void> {
  await recordAuditEvent({
    actorId: null,
    action,
    targetTable: "carrier_onboarding_payments",
    targetId: preRegistrationId,
    detail,
  });
}
