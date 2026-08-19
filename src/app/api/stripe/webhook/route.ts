import { NextResponse } from "next/server";
import { z } from "zod";
import type Stripe from "stripe";
import { tryCreateStripe } from "@/lib/stripe";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { EMAIL_INTERNAL_TO, sendEmail } from "@/lib/email/send";
import { WebhookFailureEmail } from "@/emails/WebhookFailureEmail";
import {
  buildPaymentFailedEmail,
  buildPaymentReceivedEmail,
} from "@/emails/customer-templates";
import { getCarrierOwnerRecipient, notifyCustomer } from "@/lib/notify";
import {
  CARRIER_PREREG_CURRENCY,
  CARRIER_PREREG_FEE_CENTS,
  CARRIER_PREREG_PURPOSE,
  auditFee,
  mirrorPaymentStatus,
  settleFeePayment,
} from "@/lib/carrier-authority/onboarding-fee";

export const dynamic = "force-dynamic";

/**
 * M-31 — Stripe event callback (audit S-02: signature-verified, idempotent
 * via the `webhook_events` (provider, event_id) unique key, ops alert on
 * processing failure — same contract as the M-22 e-sign webhook).
 *
 * Processing rules:
 * - `invoice.paid` → the invoice's `metadata.load_id` moves the load
 *   invoiced → paid (guarded update; a manual "paid" beats us harmlessly).
 * - `invoice.payment_failed` → archived + ops alert email (dunning is
 *   handled inside Stripe; the dispatcher just needs to know).
 * - Everything else is acknowledged and archived, not acted on.
 *
 * COMPLIANCE: these invoices only ever carry the dispatch fee
 * (src/lib/stripe.ts) — no freight money is represented here.
 */

/**
 * M-95. Parsed, not cast: the fields below are the ONLY ones this route reads
 * off a Checkout Session, and anything else Stripe sends is ignored rather
 * than carried around. `payment_status` and `amount_total` are optional in the
 * type because they are optional in the API — and a missing one must read as
 * "not paid", which the branch's explicit `!== "paid"` comparison gives.
 */
const checkoutSessionSchema = z.object({
  id: z.string(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
  payment_status: z.string().optional(),
  amount_total: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  payment_intent: z.union([z.string(), z.object({}).loose()]).nullable().optional(),
  status: z.string().nullable().optional(),
});

const chargeSchema = z.object({
  id: z.string(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
  amount_refunded: z.number().nullable().optional(),
});

const invoiceObjectSchema = z.object({
  id: z.string(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
  amount_paid: z.number().optional(),
  amount_due: z.number().optional(),
  hosted_invoice_url: z.string().nullable().optional(),
});

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = tryCreateStripe();
  if (!secret || !stripe) {
    return NextResponse.json(
      { error: "Stripe webhook not configured" },
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: "Unreadable body" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, secret);
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  const admin = tryCreateAdminClient();
  if (!admin) {
    // Can't dedupe or process without the service key — let Stripe retry.
    return NextResponse.json(
      { error: "Storage not configured" },
      { status: 503 },
    );
  }

  // Idempotency (S-02): (provider, event_id) unique constraint is the gate.
  const { data: inserted, error: insertError } = await admin
    .from("webhook_events")
    .insert({
      provider: "stripe",
      event_id: event.id,
      event_type: event.type,
      payload: JSON.parse(raw),
      status: "received",
    })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      // Duplicate delivery — already handled.
      return NextResponse.json({ received: true }, { status: 200 });
    }
    console.error("[stripe-webhook] event store failed", insertError.message);
    return NextResponse.json({ error: "Storage failure" }, { status: 500 });
  }

  try {
    if (event.type === "invoice.paid") {
      const invoice = invoiceObjectSchema.safeParse(event.data.object);
      if (!invoice.success) {
        throw new Error("invoice.paid payload didn't match the expected shape");
      }
      const loadId = z.uuid().safeParse(invoice.data.metadata?.["load_id"]);
      if (!loadId.success) {
        throw new Error(
          `invoice.paid without usable metadata.load_id (invoice ${invoice.data.id})`,
        );
      }
      // Enrich the stored payload so the payment-history table can render
      // amount + load without a Stripe API round-trip.
      await admin
        .from("webhook_events")
        .update({
          payload: {
            load_id: loadId.data,
            invoice_id: invoice.data.id,
            amount_usd: (invoice.data.amount_paid ?? 0) / 100,
            hosted_invoice_url: invoice.data.hosted_invoice_url ?? null,
          },
        })
        .eq("id", inserted.id);

      const { error: updateError } = await admin
        .from("loads")
        .update({ status: "paid" })
        .eq("id", loadId.data)
        .eq("status", "invoiced");
      if (updateError) throw new Error(updateError.message);

      // M-55: keep the invoices mirror (0008) in step — the carrier portal
      // reads it. Missing row (pre-mirror invoice) is not an error.
      const { error: mirrorError } = await admin
        .from("invoices")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("stripe_invoice_id", invoice.data.id);
      if (mirrorError) {
        console.error("[stripe-webhook] mirror update failed", mirrorError.message);
      }

      // M-60: thank the carrier (email + portal feed). Idempotent by the
      // webhook_events gate above — a duplicate delivery never reaches here.
      const paidCarrierId = z.uuid().safeParse(
        invoice.data.metadata?.["carrier_id"],
      );
      if (paidCarrierId.success) {
        const recipient = await getCarrierOwnerRecipient(
          admin,
          paidCarrierId.data,
        );
        if (recipient) {
          const email = buildPaymentReceivedEmail(recipient.locale, {
            amountUsd: (invoice.data.amount_paid ?? 0) / 100,
          });
          await notifyCustomer({
            recipient,
            kind: "payment_received",
            title: email.subject,
            href: "/portal/carrier/invoices",
            email,
          });
        }
      }
    } else if (
      event.type === "invoice.voided" ||
      event.type === "invoice.marked_uncollectible"
    ) {
      // M-55 mirror status transitions beyond paid.
      const invoice = invoiceObjectSchema.safeParse(event.data.object);
      if (invoice.success) {
        const { error: mirrorError } = await admin
          .from("invoices")
          .update({
            status:
              event.type === "invoice.voided" ? "void" : "uncollectible",
          })
          .eq("stripe_invoice_id", invoice.data.id);
        if (mirrorError) {
          console.error(
            "[stripe-webhook] mirror update failed",
            mirrorError.message,
          );
        }
      }
    } else if (event.type === "invoice.payment_failed") {
      const invoice = invoiceObjectSchema.safeParse(event.data.object);
      const invoiceId = invoice.success ? invoice.data.id : "unknown";

      // M-60: tell the carrier directly (Stripe dunning retries; the ops
      // alert below still fires so the desk can call).
      const failedCarrierId = z.uuid().safeParse(
        invoice.success ? invoice.data.metadata?.["carrier_id"] : undefined,
      );
      if (failedCarrierId.success) {
        const recipient = await getCarrierOwnerRecipient(
          admin,
          failedCarrierId.data,
        );
        if (recipient) {
          const email = buildPaymentFailedEmail(recipient.locale, {
            hostedUrl: invoice.success
              ? (invoice.data.hosted_invoice_url ?? null)
              : null,
          });
          await notifyCustomer({
            recipient,
            kind: "payment_failed",
            title: email.subject,
            href: "/portal/carrier/invoices",
            email,
          });
        }
      }

      await sendEmail({
        to: EMAIL_INTERNAL_TO,
        subject: `Stripe payment failed — invoice ${invoiceId}`,
        template: "stripe-payment-failed",
        react: WebhookFailureEmail({
          provider: "stripe",
          eventType: event.type,
          eventId: event.id,
          error: `Payment failed for invoice ${invoiceId}. Stripe dunning will retry; consider calling the carrier.`,
        }),
      });
    } else if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded" ||
      event.type === "checkout.session.async_payment_failed" ||
      event.type === "checkout.session.expired"
    ) {
      /* ── M-95: the $9.99 carrier pre-registration fee ──────────────────
       *
       * Everything this branch believes, it re-verifies. `metadata` is a label
       * WE set when the session was created; it says which applicant a payment
       * is for, and it says nothing at all about how much was paid. So the
       * amount, the currency and the price actually charged are all checked
       * against server configuration before a single row moves.
       *
       * Any failure here throws, which lands in the catch below: the event is
       * marked `failed`, ops are emailed, and Stripe gets a 500 and retries.
       * Nothing is marked paid on a path that could not complete its checks.
       */
      const session = checkoutSessionSchema.safeParse(event.data.object);
      if (!session.success) {
        throw new Error(
          `${event.type} payload didn't match the expected shape`,
        );
      }
      const s = session.data;

      // Not ours — the account also takes M-31 dispatch-fee invoices, and one
      // day may take more. Silence is the correct response to somebody else's
      // payment, not a guess at what it was for.
      if (s.metadata?.["purpose"] === CARRIER_PREREG_PURPOSE) {
        const preRegistrationId = z
          .uuid()
          .safeParse(s.metadata?.["pre_registration_id"]);
        if (!preRegistrationId.success) {
          throw new Error(
            `${event.type} carries our purpose but no usable pre_registration_id (session ${s.id})`,
          );
        }
        const preId = preRegistrationId.data;

        // Minimise what the ledger keeps. The raw event carries
        // `customer_details` — an email, a name, sometimes an address — and
        // none of it is needed to reconcile a $9.99 fee.
        await admin
          .from("webhook_events")
          .update({
            payload: {
              session_id: s.id,
              pre_registration_id: preId,
              payment_status: s.payment_status ?? null,
              amount_total: s.amount_total ?? null,
              currency: s.currency ?? null,
              livemode: event.livemode,
            },
          })
          .eq("id", inserted.id);

        if (
          event.type === "checkout.session.expired" ||
          event.type === "checkout.session.async_payment_failed"
        ) {
          // Close the row out so the applicant can start a fresh Checkout.
          // NEVER touches a row that is already `paid`.
          const { error: failError } = await admin
            .from("carrier_onboarding_payments")
            .update({ status: "failed" })
            .eq("provider", "stripe")
            .eq("provider_session_id", s.id)
            .neq("status", "paid");
          if (failError) throw new Error(failError.message);
          await auditFee("carrier_fee_checkout_closed", preId, {
            session_id: s.id,
            event: event.type,
          });
        } else {
          /* ── A completed session. Is it actually PAID, and for OUR fee? ── */

          // `checkout.session.completed` fires for delayed payment methods
          // while `payment_status` is still `unpaid`. Treating "completed" as
          // "paid" is the single most likely way to give away the product.
          if (s.payment_status !== "paid") {
            await auditFee("carrier_fee_not_settled", preId, {
              session_id: s.id,
              reason: "payment_status_not_paid",
              payment_status: s.payment_status ?? null,
            });
          } else if (
            s.amount_total !== CARRIER_PREREG_FEE_CENTS ||
            s.currency !== CARRIER_PREREG_CURRENCY
          ) {
            // Right label, wrong money. Never settled, always shouted about.
            await auditFee("carrier_fee_amount_mismatch", preId, {
              session_id: s.id,
              amount_total: s.amount_total ?? null,
              currency: s.currency ?? null,
              expected_cents: CARRIER_PREREG_FEE_CENTS,
            });
            throw new Error(
              `carrier fee session ${s.id} settled the wrong amount: ${s.amount_total} ${s.currency}`,
            );
          } else {
            // The third check, and the one metadata cannot fake: what price
            // did Stripe actually charge? Re-read from Stripe, not from the
            // event.
            const expectedPriceId =
              process.env.STRIPE_CARRIER_PREREG_PRICE_ID ?? "";
            const lineItems = await stripe.checkout.sessions.listLineItems(
              s.id,
              { limit: 5 },
            );
            const chargedPriceIds = lineItems.data.map(
              (li) => li.price?.id ?? "",
            );
            if (
              !expectedPriceId ||
              chargedPriceIds.length !== 1 ||
              chargedPriceIds[0] !== expectedPriceId
            ) {
              await auditFee("carrier_fee_price_mismatch", preId, {
                session_id: s.id,
                charged: chargedPriceIds,
              });
              throw new Error(
                `carrier fee session ${s.id} charged an unexpected price`,
              );
            }

            const outcome = await settleFeePayment(admin, {
              sessionId: s.id,
              paymentIntentId:
                typeof s.payment_intent === "string" ? s.payment_intent : null,
              preRegistrationId: preId,
              amountCents: s.amount_total,
              currency: s.currency,
              livemode: event.livemode,
              paidAt: new Date(event.created * 1000).toISOString(),
            });

            if (outcome === "storage_failure") {
              // §"Database failure: do not mark payment successful." Throwing
              // gets a 500 and a Stripe retry, which is the only way this ends
              // up recorded.
              throw new Error(
                `carrier fee session ${s.id} could not be written to the ledger`,
              );
            }
            if (outcome === "no_matching_session") {
              // A session we never created, carrying our metadata. Worth
              // shouting about; not worth inventing a row for.
              throw new Error(
                `carrier fee session ${s.id} matches no payment row`,
              );
            }

            // `already_settled` is a normal, quiet outcome — the whole point
            // of idempotency. The mirror is refreshed either way.
            await mirrorPaymentStatus(admin, preId, "paid");
            await auditFee(
              outcome === "settled"
                ? "carrier_fee_paid"
                : "carrier_fee_paid_duplicate_event",
              preId,
              {
                session_id: s.id,
                amount_cents: s.amount_total,
                currency: s.currency,
                livemode: event.livemode,
              },
            );
          }
        }
      }
    } else if (event.type === "charge.refunded") {
      /* ── M-95: refunds are RECORDED, never initiated ────────────────────
       *
       * No code in this repository calls `stripe.refunds.create`, because no
       * refund policy has been approved. What this branch does is keep the
       * ledger honest when somebody issues one by hand in the Stripe
       * dashboard, so a refunded fee does not keep reading as revenue.
       *
       * It deliberately does NOT revoke anything. Whether a refund should
       * un-onboard a carrier who has already uploaded documents and signed an
       * agreement is a business decision nobody has made, and guessing at it
       * in a webhook is how a paying customer loses their account overnight.
       */
      const charge = chargeSchema.safeParse(event.data.object);
      if (
        charge.success &&
        charge.data.metadata?.["purpose"] === CARRIER_PREREG_PURPOSE
      ) {
        const preRegistrationId = z
          .uuid()
          .safeParse(charge.data.metadata?.["pre_registration_id"]);
        if (preRegistrationId.success) {
          const { error: refundError } = await admin
            .from("carrier_onboarding_payments")
            .update({ status: "refunded" })
            .eq("provider", "stripe")
            .eq("pre_registration_id", preRegistrationId.data)
            .eq("status", "paid");
          if (refundError) throw new Error(refundError.message);
          await mirrorPaymentStatus(admin, preRegistrationId.data, "refunded");
          await auditFee("carrier_fee_refunded", preRegistrationId.data, {
            charge_id: charge.data.id,
            amount_refunded: charge.data.amount_refunded ?? null,
          });
        }
      }
    }
    // All other event types: acknowledged + archived.

    await admin
      .from("webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("id", inserted.id);

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe-webhook] processing failed", message);

    await admin
      .from("webhook_events")
      .update({ status: "failed", error: message })
      .eq("id", inserted.id);

    // S-02: alert ops — the Notifications module reads webhook_events too.
    await sendEmail({
      to: EMAIL_INTERNAL_TO,
      subject: `Webhook failure — stripe ${event.type}`,
      template: "webhook-failure",
      react: WebhookFailureEmail({
        provider: "stripe",
        eventType: event.type,
        eventId: event.id,
        error: message,
      }),
    });

    // Non-200 → Stripe retries with backoff.
    return NextResponse.json({ error: "Processing failure" }, { status: 500 });
  }
}
