import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { EMAIL_INTERNAL_TO, sendEmail } from "@/lib/email/send";
import { WebhookFailureEmail } from "@/emails/WebhookFailureEmail";
import { buildAgreementSignedEmail } from "@/emails/customer-templates";
import { getCarrierOwnerRecipient, notifyCustomer } from "@/lib/notify";

export const dynamic = "force-dynamic";

/**
 * M-22 — Dropbox Sign event callback (audit S-02: signature-verified,
 * idempotent via the `webhook_events` (provider, event_id) unique key, with
 * an ops alert on processing failure).
 *
 * Contract (Dropbox Sign):
 * - POST multipart/form-data with a `json` field carrying the event payload.
 * - `event.event_hash` = HMAC-SHA256(hex) of `event_time + event_type`,
 *   keyed with the app's API key → env `DROPBOX_SIGN_WEBHOOK_SECRET`.
 * - The 200 response body must contain "Hello API Event Received".
 *
 * On `signature_request_signed` / `signature_request_all_signed` the
 * `metadata.carrier_id` (set by src/lib/esign.ts when sending) stamps
 * `carriers.agreement_signed_at`.
 */

const eventSchema = z.object({
  event: z.object({
    event_time: z.string(),
    event_type: z.string(),
    event_hash: z.string(),
  }),
  signature_request: z
    .object({
      signature_request_id: z.string().optional(),
      is_complete: z.boolean().optional(),
      metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    })
    .optional(),
});

const OK_BODY = "Hello API Event Received";
const SIGNED_EVENTS = new Set([
  "signature_request_signed",
  "signature_request_all_signed",
]);

function verifyHash(
  secret: string,
  eventTime: string,
  eventType: string,
  eventHash: string,
): boolean {
  const expected = createHmac("sha256", secret)
    .update(eventTime + eventType)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(eventHash, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const secret = process.env.DROPBOX_SIGN_WEBHOOK_SECRET;
  if (!secret) {
    // Graceful: endpoint exists but the integration isn't configured yet.
    return NextResponse.json(
      { error: "E-sign webhook not configured" },
      { status: 503 },
    );
  }

  // Dropbox Sign posts multipart/form-data { json: "<payload>" }; accept a
  // raw JSON body too (their test tool and future providers).
  let raw: string;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const jsonField = form.get("json");
      raw = typeof jsonField === "string" ? jsonField : "";
    } else {
      raw = await request.text();
    }
  } catch {
    return NextResponse.json({ error: "Unreadable body" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = eventSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Unexpected payload" }, { status: 400 });
  }
  const { event, signature_request } = parsed.data;

  if (
    !verifyHash(secret, event.event_time, event.event_type, event.event_hash)
  ) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  // Connectivity test event — verified, nothing to process or store.
  if (event.event_type === "callback_test") {
    return new NextResponse(OK_BODY, { status: 200 });
  }

  const admin = tryCreateAdminClient();
  if (!admin) {
    // Can't dedupe or process without the service key — let the provider retry.
    return NextResponse.json(
      { error: "Storage not configured" },
      { status: 503 },
    );
  }

  // Idempotency (S-02): the (provider, event_id) unique constraint is the gate.
  const { data: inserted, error: insertError } = await admin
    .from("webhook_events")
    .insert({
      provider: "dropbox_sign",
      event_id: event.event_hash,
      event_type: event.event_type,
      payload,
      status: "received",
    })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      // Duplicate delivery — already handled.
      return new NextResponse(OK_BODY, { status: 200 });
    }
    console.error("[esign-webhook] event store failed", insertError.message);
    return NextResponse.json({ error: "Storage failure" }, { status: 500 });
  }

  try {
    if (SIGNED_EVENTS.has(event.event_type)) {
      const carrierIdRaw = signature_request?.metadata?.["carrier_id"];
      const carrierId = z.uuid().safeParse(carrierIdRaw);
      if (!carrierId.success) {
        throw new Error(
          `signed event without usable metadata.carrier_id (got: ${String(carrierIdRaw)})`,
        );
      }
      const { data: stamped, error: updateError } = await admin
        .from("carriers")
        .update({ agreement_signed_at: new Date().toISOString() })
        .eq("id", carrierId.data)
        .is("agreement_signed_at", null)
        .select("id, company_name")
        .maybeSingle();
      if (updateError) throw new Error(updateError.message);

      // M-60: congratulate the carrier + portal notification. `stamped` is
      // null on duplicate signed-events (already stamped) — no double email.
      if (stamped) {
        const recipient = await getCarrierOwnerRecipient(admin, stamped.id);
        if (recipient) {
          const email = buildAgreementSignedEmail(recipient.locale, {
            companyName: stamped.company_name,
          });
          await notifyCustomer({
            recipient,
            kind: "agreement_signed",
            title: email.subject,
            href: "/portal/carrier/agreements",
            email,
          });
        }
      }
    }
    // All other event types are acknowledged and archived, not acted on.

    await admin
      .from("webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("id", inserted.id);

    return new NextResponse(OK_BODY, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[esign-webhook] processing failed", message);

    await admin
      .from("webhook_events")
      .update({ status: "failed", error: message })
      .eq("id", inserted.id);

    // S-02: alert ops — the Notifications module reads webhook_events too.
    await sendEmail({
      to: EMAIL_INTERNAL_TO,
      subject: `Webhook failure — dropbox_sign ${event.event_type}`,
      template: "webhook-failure",
      react: WebhookFailureEmail({
        provider: "dropbox_sign",
        eventType: event.event_type,
        eventId: event.event_hash,
        error: message,
      }),
    });

    // Non-200 → Dropbox Sign retries with backoff.
    return NextResponse.json({ error: "Processing failure" }, { status: 500 });
  }
}
