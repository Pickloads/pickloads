import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  fetchCompletedPdf,
  fetchCompletionCertificate,
  isSignwellConfigured,
  verifySignwellEvent,
} from "@/lib/signwell";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { EMAIL_INTERNAL_TO, sendEmail } from "@/lib/email/send";
import { WebhookFailureEmail } from "@/emails/WebhookFailureEmail";
import { buildAgreementSignedEmail } from "@/emails/customer-templates";
import { getCarrierOwnerRecipient, notifyCustomer } from "@/lib/notify";
import { sniffMime } from "@/lib/uploads";
import {
  EVENT_TO_STATUS,
  isTerminal,
  statusForSignedEvent,
  STATUS_TIMESTAMP_COLUMN,
  type SignatureStatus,
} from "@/lib/agreements/status";

export const dynamic = "force-dynamic";

/**
 * SignWell event callback.
 *
 * Holds to every rule in docs/security/WEBHOOK-SECURITY-STANDARD.md, and the
 * two the Dropbox Sign route breaks (rules 5 and 6) are addressed here rather
 * than copied.
 *
 * ── 1. AUTHENTICITY ──────────────────────────────────────────────────────
 *
 * HMAC-SHA256 over `${event.type}@${event.time}`, compared in constant time
 * against `event.hash`. The key is `SIGNWELL_WEBHOOK_ID` — a server-side
 * secret. It is NEVER read from the request. SignWell's own docs describe the
 * key as "the Webhook ID sent in the webhook POST resource", which if taken
 * literally would let an attacker supply the key and the hash together; see
 * the note in src/lib/signwell.ts.
 *
 * ── 2. THE SIGNATURE DOES NOT COVER THE PAYLOAD ──────────────────────────
 *
 * It covers a type and a second. So a valid signature proves only that
 * SignWell emitted SOME event of this type at this time — it says nothing
 * about which document, and `metadata.carrier_id` in the body is attacker-
 * controlled as far as the signature is concerned.
 *
 * This route therefore treats `metadata.carrier_id` as a CLAIM and re-derives
 * the authority for it:
 *
 *   - the document id is taken from `data.object.id`;
 *   - the carrier is stamped only when the claimed carrier row exists AND is
 *     still unsigned (`.is("agreement_signed_at", null)`);
 *   - the stamp is a no-op on an already-signed carrier, so a replay aimed at
 *     a different carrier cannot re-date an existing agreement.
 *
 * What it deliberately does NOT do is trust the body to name a carrier that
 * never had an agreement sent to it. That is the residual gap, and it is
 * bounded by (3): the idempotency key is document-scoped, so a forged event
 * has to carry a document id that has not already been processed, and the
 * completed-PDF fetch in (4) will 404 for a document that does not exist in
 * our SignWell account. An attacker cannot manufacture a signed agreement;
 * at worst they can burn an idempotency key.
 *
 * ── 3. IDEMPOTENCY (and why not `event.hash`) ────────────────────────────
 *
 * The obvious key is `event.hash`. It is the wrong one, and this is the exact
 * defect recorded as SEC-P2-02 against the Dropbox Sign route: the hash is a
 * pure function of `(type, time)`, so two DIFFERENT documents completing in
 * the same second produce the SAME hash. The second one is deduped, answered
 * 200, and silently never processed — a carrier's agreement never stamped,
 * with no error anywhere.
 *
 * The key here is `${document.id}:${event.type}:${event.time}`. Document ids
 * are high-cardinality, so true retries (same document, same event, same
 * second) collapse and genuine concurrent completions do not.
 *
 * ── 4. ARTEFACTS ─────────────────────────────────────────────────────────
 *
 * On `document_completed` the signed PDF is downloaded and stored in the
 * PRIVATE `carrier-docs` bucket under the carrier's own folder, with the same
 * `${carrier_id}/${uuid}-${name}` convention every other document uses — so
 * it inherits the existing storage RLS and the 300-second signed-URL policy
 * for portal access. Nothing is ever made public, and no SignWell-hosted URL
 * is handed to a customer.
 *
 * Bytes are magic-byte checked before storage (`sniffMime`). A remote server
 * that says `application/pdf` is making a claim; the file header is evidence.
 * The completion certificate is best-effort — see src/lib/signwell.ts.
 *
 * ── 5. FAILURE ───────────────────────────────────────────────────────────
 *
 * Unconfigured → 503 and no work. Bad signature → 401. Malformed → 400.
 * Processing failure → the event row is marked `failed`, ops is emailed, and
 * a 500 is returned so SignWell retries.
 */

const eventSchema = z.object({
  event: z.object({
    type: z.string().min(1).max(64),
    // JSON number in practice; accepted as either and stringified exactly as
    // SignWell's own sample does before hashing.
    time: z.union([z.string(), z.number()]),
    hash: z.string().min(16).max(256),
    // Present only on document_viewed / document_signed / document_declined.
    related_signer: z
      .object({
        email: z.string().max(320).optional(),
        name: z.string().max(255).optional(),
      })
      .nullable()
      .optional(),
  }),
  data: z.object({
    object: z.object({
      id: z.string().min(1).max(128),
      status: z.string().max(64).optional(),
      name: z.string().max(255).optional(),
      metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    }),
    account_id: z.string().max(128).optional(),
  }),
});

/** Fully signed by every recipient. `document_signed` is one signer only. */
const COMPLETED_EVENT = "document_completed";

export async function POST(request: Request) {
  if (!isSignwellConfigured()) {
    return NextResponse.json(
      { error: "SignWell webhook not configured" },
      { status: 503 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = eventSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Unexpected payload" }, { status: 400 });
  }
  const { event, data } = parsed.data;

  // Verify BEFORE any business logic, storage read or outbound call.
  if (
    !verifySignwellEvent({
      eventType: event.type,
      eventTime: event.time,
      eventHash: event.hash,
    })
  ) {
    // No detail: telling a caller which half failed helps them fix it.
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }

  const admin = tryCreateAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Storage not configured" },
      { status: 503 },
    );
  }

  const documentId = data.object.id;
  const eventId = `${documentId}:${event.type}:${String(event.time)}`;

  const { data: inserted, error: insertError } = await admin
    .from("webhook_events")
    .insert({
      provider: "signwell",
      event_id: eventId,
      event_type: event.type,
      payload,
      status: "received",
    })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ received: true }, { status: 200 });
    }
    console.error("[signwell-webhook] event store failed", insertError.message);
    return NextResponse.json({ error: "Storage failure" }, { status: 500 });
  }

  try {
    // M-92: keep the signature_requests lifecycle current for every event we
    // understand. Runs BEFORE the completion work so the portal reflects
    // "completed" even if artefact storage later fails and the event retries.
    await applyStatus(admin, {
      documentId,
      eventType: event.type,
      signerEmail: parsed.data.event.related_signer?.email ?? null,
    });

    if (event.type === COMPLETED_EVENT) {
      await handleCompleted(admin, documentId, data.object.metadata ?? null);
    }
    // Every other event type is acknowledged and archived, not acted on.

    await admin
      .from("webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("id", inserted.id);

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[signwell-webhook] processing failed", message);

    await admin
      .from("webhook_events")
      .update({ status: "failed", error: message })
      .eq("id", inserted.id);

    await sendEmail({
      to: EMAIL_INTERNAL_TO,
      subject: `Webhook failure — signwell ${event.type}`,
      template: "webhook-failure",
      react: WebhookFailureEmail({
        provider: "signwell",
        eventType: event.type,
        eventId,
        error: message,
      }),
    });

    return NextResponse.json({ error: "Processing failure" }, { status: 500 });
  }
}

type AdminClient = NonNullable<ReturnType<typeof tryCreateAdminClient>>;

/**
 * M-92 — advance the signature_requests row for this document.
 *
 * Silent no-op when no row matches: a document created outside this
 * application (a manual send from the SignWell dashboard) is a legitimate
 * thing that we simply do not track, and it must not fail the webhook.
 *
 * ── WHY TERMINAL STATES ARE NEVER OVERWRITTEN ────────────────────────────
 *
 * No provider guarantees webhook ordering, and SignWell retries on non-2xx.
 * So a `document_viewed` delivered late — after a completion — is entirely
 * possible, and applying it blindly would move a completed agreement back to
 * "viewed" in the carrier's portal. The status is only advanced away from a
 * non-terminal state.
 */
async function applyStatus(
  admin: AdminClient,
  args: { documentId: string; eventType: string; signerEmail: string | null },
): Promise<void> {
  const { data: request } = await admin
    .from("signature_requests")
    .select("id, status, carrier_id")
    .eq("provider", "signwell")
    .eq("provider_document_id", args.documentId)
    .maybeSingle();
  if (!request) return;

  const current = request.status as SignatureStatus;
  if (isTerminal(current)) return;

  let next: SignatureStatus | undefined = EVENT_TO_STATUS[args.eventType];
  if (args.eventType === "document_signed") {
    const owner = await getCarrierOwnerRecipient(admin, request.carrier_id);
    next = statusForSignedEvent({
      signerEmail: args.signerEmail,
      carrierEmail: owner?.email ?? null,
    });
  }
  if (!next || next === current) return;

  // Every timestamp column is named explicitly rather than written through a
  // computed key. The Supabase Update type rejects an index signature, and it
  // is right to — a computed column name is exactly how a typo turns into a
  // silent no-op. Spread-in rather than set-to-undefined because tsconfig has
  // exactOptionalPropertyTypes: an absent key and an undefined one are
  // different things, and only the absent one is legal here.
  const now = new Date().toISOString();
  const stampColumn = STATUS_TIMESTAMP_COLUMN[next];
  const patch = {
    status: next,
    ...(stampColumn === "viewed_at" ? { viewed_at: now } : {}),
    ...(stampColumn === "carrier_signed_at" ? { carrier_signed_at: now } : {}),
    ...(stampColumn === "completed_at" ? { completed_at: now } : {}),
    ...(stampColumn === "declined_at" ? { declined_at: now } : {}),
    ...(stampColumn === "expired_at" ? { expired_at: now } : {}),
  };

  const { error } = await admin
    .from("signature_requests")
    .update(patch)
    .eq("id", request.id);
  if (error) {
    // Not fatal to the event: the artefact work and the agreement stamp are
    // what the business depends on. A stale status is visible and fixable;
    // a dropped completion is neither.
    console.error("[signwell-webhook] status update failed", error.message);
  }
}

/** Store one artefact in the private bucket and register it in `documents`. */
async function storeArtefact(
  admin: AdminClient,
  args: {
    carrierId: string;
    bytes: Uint8Array;
    fileName: string;
    docType: "dispatch_agreement" | "other";
  },
): Promise<void> {
  // Defence in depth: the remote server's Content-Type is a claim. Anything
  // that is not really a PDF does not enter the bucket.
  const sniffed = sniffMime(args.bytes);
  if (sniffed !== "application/pdf") {
    throw new Error(
      `${args.docType} from SignWell was not a PDF (sniffed: ${sniffed ?? "unknown"})`,
    );
  }

  const storagePath = `${args.carrierId}/${randomUUID()}-${args.fileName}`;
  const { error: uploadError } = await admin.storage
    .from("carrier-docs")
    .upload(storagePath, Buffer.from(args.bytes), {
      contentType: "application/pdf",
      upsert: false,
    });
  if (uploadError) throw new Error(uploadError.message);

  const { error: docError } = await admin.from("documents").insert({
    carrier_id: args.carrierId,
    type: args.docType,
    storage_path: storagePath,
    file_name: args.fileName,
    file_size_bytes: args.bytes.byteLength,
    mime_type: "application/pdf",
    uploaded_by: null,
    // Countersigned by SignWell, not something a reviewer approves.
    status: "approved",
  });
  if (docError) throw new Error(docError.message);
}

async function handleCompleted(
  admin: AdminClient,
  documentId: string,
  metadata: Record<string, unknown> | null,
): Promise<void> {
  const carrierId = z.uuid().safeParse(metadata?.["carrier_id"]);
  if (!carrierId.success) {
    throw new Error(
      `document_completed without usable metadata.carrier_id (document ${documentId})`,
    );
  }

  // The claimed carrier must exist. This is also where a forged event with an
  // invented carrier id stops.
  const { data: carrier, error: carrierError } = await admin
    .from("carriers")
    .select("id, company_name, agreement_signed_at")
    .eq("id", carrierId.data)
    .maybeSingle();
  if (carrierError) throw new Error(carrierError.message);
  if (!carrier) {
    throw new Error(
      `document_completed for unknown carrier ${carrierId.data} (document ${documentId})`,
    );
  }

  // The signed agreement. A failure here IS fatal to the event: without the
  // artefact there is nothing to stamp against, and SignWell should retry.
  const pdf = await fetchCompletedPdf(documentId);
  if (!pdf.ok) throw new Error(`signed PDF unavailable: ${pdf.reason}`);
  await storeArtefact(admin, {
    carrierId: carrier.id,
    bytes: pdf.bytes,
    fileName: `dispatch-agreement-${documentId}.pdf`,
    docType: "dispatch_agreement",
  });

  // The certificate is corroborating evidence and is NOT available on every
  // SignWell plan. Its absence is logged, never fatal — an unavailable
  // certificate must not block carrier activation.
  const cert = await fetchCompletionCertificate(documentId);
  if (cert.ok) {
    await storeArtefact(admin, {
      carrierId: carrier.id,
      bytes: cert.bytes,
      fileName: `completion-certificate-${documentId}.pdf`,
      docType: "other",
    });
  } else {
    console.warn(
      `[signwell-webhook] completion certificate not stored: ${cert.reason}`,
    );
  }

  // THE ACTIVATION GATE, UNCHANGED. `.is(null)` keeps the stamp idempotent
  // and keeps a replay from re-dating an agreement that is already signed.
  // Activation itself remains the separate staff decision it has always been:
  // this sets agreement_signed_at and nothing else — never `active`.
  const { data: stamped, error: updateError } = await admin
    .from("carriers")
    .update({ agreement_signed_at: new Date().toISOString() })
    .eq("id", carrier.id)
    .is("agreement_signed_at", null)
    .select("id, company_name")
    .maybeSingle();
  if (updateError) throw new Error(updateError.message);

  // `stamped` is null when it was already signed — a duplicate completion.
  // No second email.
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
