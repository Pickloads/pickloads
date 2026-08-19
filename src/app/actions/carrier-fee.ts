"use server";

import { headers } from "next/headers";

import {
  CARRIER_PREREG_PURPOSE,
  auditFee,
  readFeePaymentState,
  verifyConfiguredPrice,
} from "@/lib/carrier-authority/onboarding-fee";
import { loadEligiblePreRegistration } from "@/lib/carrier-authority/pre-registration";
import { readPrecheckCookie } from "@/lib/carrier-authority/precheck-session";
import { checkRateLimit } from "@/lib/rate-limit";
import { tryCreateStripe } from "@/lib/stripe";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import type { FeeCheckoutState } from "@/lib/carrier-fee-state";

/**
 * M-95 — start (or resume) the $9.99 Checkout.
 *
 * ── WHAT THE BROWSER SENDS ───────────────────────────────────────────────
 *
 * Nothing. There is no `FormData` field this action reads — not an amount, not
 * a price id, not a pre-registration id. The applicant is identified by the
 * httpOnly cookie M-94 set, the pre-registration is re-read from the database,
 * and the price comes from server configuration. A caller who posts
 * `{amount: 1, price: price_free}` gets a $9.99 checkout for whoever their
 * cookie says they are, or a refusal.
 *
 * ── THE ORDER OF THE CHECKS MATTERS ──────────────────────────────────────
 *
 *   1. rate limit — this creates objects in a payment processor;
 *   2. the M-94 gate — only an ELIGIBLE, live, unspent pre-registration may
 *      pay. §"MANUAL REVIEW": paying is not a way to become eligible, so
 *      somebody in manual review cannot even reach a Checkout;
 *   3. already paid? — never a second charge;
 *   4. the PRICE is verified against Stripe before a session exists;
 *   5. only then is a session created, and a row written to record it.
 */

const GENERIC =
  "We couldn't start the payment. Please try again in a moment — or call (908) 404-5373.";
const NOT_ELIGIBLE =
  "Start with carrier verification — we need your USDOT and MC before the verification fee.";
const UNAVAILABLE =
  "Card payment isn't available right now. Nothing has been charged — please try again shortly.";

export async function startCarrierFeeCheckout(
  _prev: FeeCheckoutState,
  formData: FormData,
): Promise<FeeCheckoutState> {
  // Read on purpose, and then discarded on purpose. NOTHING in the submission
  // influences this action — not an amount, not a price, not an applicant id —
  // and the explicit discard is here so that a future edit which starts
  // reading a field has to delete this line and think about why.
  void formData;

  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  // Deliberately wider than the 5/10min form default and still bounded: an
  // applicant legitimately retries a failed card, and each retry is a Stripe
  // object we create.
  if (!(await checkRateLimit("carrier-fee-checkout", ip, 12))) {
    return {
      status: "error",
      message:
        "Too many payment attempts from your network. Please wait a few minutes — or call (908) 404-5373.",
    };
  }

  const admin = tryCreateAdminClient();
  const gate = await loadEligiblePreRegistration(
    await readPrecheckCookie(),
    admin,
  );
  if (!gate.ok || !admin) {
    await auditFee("carrier_fee_checkout_denied", null, {
      reason: gate.ok ? "unavailable" : gate.reason,
    });
    return { status: "error", message: NOT_ELIGIBLE };
  }
  const pre = gate.preRegistration;

  // Already settled — never a second charge, and never a second session that
  // could become one.
  const existing = await readFeePaymentState(admin, pre.id);
  if (existing.paid) {
    return { status: "already_paid" };
  }

  const stripe = tryCreateStripe();
  const priceCheck = await verifyConfiguredPrice(stripe);
  if (!priceCheck.ok || !stripe) {
    // A misconfigured price is an OPERATIONAL failure, not a customer one.
    // Loudly audited, generically reported, and nothing is charged.
    console.error(
      `[fee] price check failed: ${priceCheck.ok ? "no stripe client" : `${priceCheck.reason} (${priceCheck.detail})`}`,
    );
    await auditFee("carrier_fee_price_misconfigured", pre.id, {
      reason: priceCheck.ok ? "stripe_not_configured" : priceCheck.reason,
    });
    return { status: "error", message: UNAVAILABLE };
  }

  /* ── Reuse an open session rather than littering Stripe ───────────────── */
  if (existing.openSessionId) {
    try {
      const open = await stripe.checkout.sessions.retrieve(
        existing.openSessionId,
      );
      if (open.status === "open" && open.url) {
        return { status: "redirect", url: open.url };
      }
    } catch {
      // Expired, or Stripe is unhappy about it. Fall through and make a new
      // one; the stale row is closed out by `checkout.session.expired`.
    }
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? h.get("origin") ?? "";
  if (!origin) {
    console.error("[fee] no site origin for the return URLs");
    return { status: "error", message: GENERIC };
  }

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceCheck.price.id, quantity: 1 }],
      // Prefilled from the VERIFIED record, not from a form field.
      customer_email: pre.email,
      /**
       * The link between a payment and an applicant. It is set here, on the
       * server, and the webhook re-verifies the amount, the currency AND the
       * price id before believing it — metadata alone is a label, not proof.
       */
      metadata: {
        purpose: CARRIER_PREREG_PURPOSE,
        pre_registration_id: pre.id,
      },
      payment_intent_data: {
        metadata: {
          purpose: CARRIER_PREREG_PURPOSE,
          pre_registration_id: pre.id,
        },
        description: "PickLoads carrier verification & onboarding fee",
      },
      // The return lands on a SERVER page that re-reads the database. The
      // session id is in the URL for support/debugging only — the page does
      // not read it as evidence of anything.
      success_url: `${origin}/become-a-carrier/payment?return=success`,
      cancel_url: `${origin}/become-a-carrier/payment?return=cancelled`,
    });
  } catch (err) {
    console.error(
      "[fee] checkout create failed",
      err instanceof Error ? err.message : String(err),
    );
    await auditFee("carrier_fee_checkout_failed", pre.id, {
      reason: "stripe_error",
    });
    return { status: "error", message: UNAVAILABLE };
  }

  if (!session.url) {
    return { status: "error", message: GENERIC };
  }

  const { error: insertError } = await admin
    .from("carrier_onboarding_payments")
    .insert({
      pre_registration_id: pre.id,
      provider: "stripe",
      provider_session_id: session.id,
      // From the VERIFIED price, so the stored figure is never a guess.
      amount_cents: priceCheck.price.unit_amount ?? 0,
      currency: priceCheck.price.currency,
      status: "session_created",
      test_mode: !priceCheck.livemode,
    });
  if (insertError) {
    // The session exists in Stripe but we could not record it. Do NOT send the
    // applicant to a checkout we cannot later reconcile — a payment with no
    // row is money taken for something we cannot prove they bought.
    console.error("[fee] payment row insert failed", insertError.message);
    await auditFee("carrier_fee_checkout_failed", pre.id, {
      reason: "storage_failure",
      session_id: session.id,
    });
    try {
      await stripe.checkout.sessions.expire(session.id);
    } catch {
      /* best effort — the session expires on its own within 24h */
    }
    return { status: "error", message: GENERIC };
  }

  await auditFee("carrier_fee_checkout_created", pre.id, {
    session_id: session.id,
    amount_cents: priceCheck.price.unit_amount,
    currency: priceCheck.price.currency,
    livemode: priceCheck.livemode,
  });

  return { status: "redirect", url: session.url };
}
