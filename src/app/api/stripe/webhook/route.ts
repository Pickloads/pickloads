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
