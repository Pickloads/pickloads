import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * SignWell integration — webhook verification and completed-document retrieval.
 *
 * Spec source: https://developers.signwell.com/reference/event-hash-verification
 * and .../getcompletedpdf, .../getnom151certificate. Nothing here is inferred
 * from another provider's scheme.
 *
 * ── THE ONE THING THAT MUST NOT BE GOT WRONG ─────────────────────────────
 *
 * SignWell's documentation describes the HMAC key as:
 *
 *   "Webhook ID sent in the webhook POST resource or get it from webhook
 *    LIST endpoint"
 *
 * Read literally, that sentence invites a catastrophic implementation: take
 * the webhook id out of the request you are trying to authenticate and use it
 * as the key. An attacker then supplies BOTH the key and the hash, and every
 * forged request verifies perfectly. The signature would be decorative.
 *
 * The key therefore comes from `SIGNWELL_WEBHOOK_ID`, a server-side secret,
 * and this module offers no way to pass one in from a request body. The id is
 * not "an id" for our purposes — it is a shared secret that happens to also
 * be an identifier, and it is stored like one.
 *
 * ── WHAT IS SIGNED ───────────────────────────────────────────────────────
 *
 *   HMAC-SHA256(key = webhook id, data = `${event.type}@${event.time}`)
 *   compared against `event.hash`, in constant time.
 *
 * Note what is NOT covered: the document payload. SignWell signs only the
 * type and the timestamp, so the signature proves "SignWell emitted an event
 * of this type at this second" and nothing about WHICH document it concerns.
 * `metadata.carrier_id` in the body is therefore untrusted input, and the
 * route re-derives authority from it rather than obeying it — see the route's
 * own notes. This is the same structural weakness recorded for Dropbox Sign
 * as SEC-P2-02 in docs/security/, and it is handled here rather than
 * inherited.
 */

const API_BASE = "https://www.signwell.com/api/v1";

/** Ceiling for a downloaded artefact. Matches the carrier-docs bucket cap. */
const MAX_ARTEFACT_BYTES = 10 * 1024 * 1024;

export function isSignwellConfigured(): boolean {
  return Boolean(
    process.env.SIGNWELL_API_KEY && process.env.SIGNWELL_WEBHOOK_ID,
  );
}

/** The send side additionally needs a template. */
export function isSignwellSendConfigured(): boolean {
  return Boolean(
    process.env.SIGNWELL_API_KEY && process.env.SIGNWELL_TEMPLATE_ID,
  );
}

/**
 * Recipient placeholder names as configured on the SignWell template.
 *
 * These MUST match the placeholder names in the template exactly or SignWell
 * rejects the request. They are constants rather than env vars because a
 * mismatch is a deploy-time bug that should be found by a failing test, not a
 * runtime surprise on a carrier's agreement.
 */
export const SIGNWELL_PLACEHOLDERS = {
  carrier: "Carrier",
  pickloads: "PickLoads Authorized Representative",
} as const;

/**
 * Fields whose value the Carrier must NOT be able to change.
 *
 * SignWell exposes no `locked` / `readonly` / `editable` property on
 * `template_fields` — verified against their createDocument reference. So this
 * cannot be enforced from code, and pretending otherwise would be worse than
 * not trying: a fake lock reads as a real one.
 *
 * What CAN be done is detect the violation. A template field is editable by a
 * recipient exactly when it is assigned to one (`recipient_id` /
 * `placeholder_name`). `inspectTemplate()` reports which of these five are
 * assigned to the Carrier placeholder, which is the precise list of fields to
 * change in the SignWell dashboard.
 */
export const MUST_NOT_BE_CARRIER_EDITABLE = [
  "carrier_legal_name",
  "carrier_mc_number",
  "carrier_usdot_number",
  "carrier_email",
  "dispatch_fee",
] as const;

export interface TemplateFieldInfo {
  apiId: string;
  type: string | null;
  /** The placeholder this field is assigned to; null = sender-filled, static. */
  assignedTo: string | null;
}

export interface TemplateInspection {
  ok: true;
  placeholders: Array<{ name: string; signingOrder: number | null }>;
  fields: TemplateFieldInfo[];
}

export type TemplateInspectResult =
  TemplateInspection | { ok: false; reason: string };

/**
 * Read the configured template so its `api_id`s and field assignments can be
 * checked against what the code sends.
 *
 * GET /api/v1/document_templates/{id}
 * (https://developers.signwell.com/reference/gettemplate)
 *
 * Exists because both failure modes here are SILENT. A mismatched `api_id`
 * means SignWell accepts the request and leaves the field blank; a field
 * assigned to the Carrier means a pre-filled MC number or dispatch fee is
 * quietly editable by the person it binds. Neither raises anything at runtime,
 * so the only way to know is to look.
 *
 * Returns structure only — never the API key, never the template id.
 */
export async function inspectTemplate(): Promise<TemplateInspectResult> {
  const apiKey = process.env.SIGNWELL_API_KEY;
  const templateId = process.env.SIGNWELL_TEMPLATE_ID;
  if (!apiKey || !templateId) {
    return { ok: false, reason: "signwell_send_not_configured" };
  }

  try {
    const res = await fetch(
      `${API_BASE}/document_templates/${encodeURIComponent(templateId)}`,
      { headers: { "X-Api-Key": apiKey } },
    );
    if (!res.ok) return { ok: false, reason: `template_http_${res.status}` };

    const body: unknown = await res.json();
    const obj = (body ?? {}) as {
      fields?: unknown;
      placeholders?: unknown;
    };

    // `fields` is an array of arrays, one per page.
    const fields: TemplateFieldInfo[] = [];
    const pages = Array.isArray(obj.fields) ? obj.fields : [];
    for (const page of pages) {
      const list = Array.isArray(page) ? page : [page];
      for (const raw of list) {
        if (typeof raw !== "object" || raw === null) continue;
        const f = raw as {
          api_id?: unknown;
          type?: unknown;
          recipient_id?: unknown;
          placeholder_name?: unknown;
        };
        if (typeof f.api_id !== "string") continue;
        const assigned =
          typeof f.placeholder_name === "string" && f.placeholder_name !== ""
            ? f.placeholder_name
            : typeof f.recipient_id === "string" && f.recipient_id !== ""
              ? f.recipient_id
              : null;
        fields.push({
          apiId: f.api_id,
          type: typeof f.type === "string" ? f.type : null,
          assignedTo: assigned,
        });
      }
    }

    const placeholders = (
      Array.isArray(obj.placeholders) ? obj.placeholders : []
    ).flatMap((raw) => {
      if (typeof raw !== "object" || raw === null) return [];
      const p = raw as { name?: unknown; signing_order?: unknown };
      if (typeof p.name !== "string") return [];
      return [
        {
          name: p.name,
          signingOrder:
            typeof p.signing_order === "number" ? p.signing_order : null,
        },
      ];
    });

    return { ok: true, placeholders, fields };
  } catch (err) {
    console.error("[signwell] template inspect failed", err);
    return { ok: false, reason: "template_request_failed" };
  }
}

export type SignwellCreateResult =
  | { ok: true; documentId: string; status: string; testMode: boolean }
  | { ok: false; reason: string };

/**
 * Create + send a document from the configured template.
 *
 * Endpoint: POST /api/v1/document_templates/documents
 * (https://developers.signwell.com/reference/createdocumentfromtemplate)
 *
 * ── SIGNING ORDER ────────────────────────────────────────────────────────
 *
 * `apply_signing_order: true` with the carrier as recipient `"1"` and the
 * PickLoads representative as `"2"`. This is the whole reason the flag is set:
 * without it SignWell emails both parties at once and PickLoads can
 * countersign an agreement the carrier has not signed yet, which is not a
 * countersignature — it is two unrelated signatures on one page.
 *
 * ── send_email ───────────────────────────────────────────────────────────
 *
 * Defaults to FALSE in the API. Set explicitly to `true`, because a signature
 * request nobody is told about is indistinguishable from one that was never
 * sent.
 *
 * ── FIELD LOCKING ────────────────────────────────────────────────────────
 *
 * There is none at API level. SignWell's field object has no `locked`,
 * `readonly` or `editable` property — verified against their createDocument
 * reference. Whether a pre-filled value can be altered by the signer is a
 * property of the TEMPLATE: a field assigned to a recipient is editable by
 * that recipient; a field not assigned to anyone renders as static text.
 *
 * So `template_fields` here pre-fills values, and the locking half of the
 * requirement is an owner action on the template. It is recorded in
 * docs/modules/M-92-signwell-send.md rather than silently assumed.
 */
export async function createAgreementFromTemplate(args: {
  carrierName: string;
  carrierSignerName: string;
  carrierSignerEmail: string;
  pickloadsName: string;
  pickloadsEmail: string;
  fields: Record<string, string>;
  carrierId: string;
}): Promise<SignwellCreateResult> {
  const apiKey = process.env.SIGNWELL_API_KEY;
  const templateId = process.env.SIGNWELL_TEMPLATE_ID;
  if (!apiKey || !templateId) {
    return { ok: false, reason: "signwell_send_not_configured" };
  }

  // Empty strings are omitted rather than sent: SignWell would stamp a blank
  // into the field, which reads as "answered, and the answer is nothing"
  // instead of leaving the signer a field to complete.
  const templateFields = Object.entries(args.fields)
    .filter(([, value]) => value.trim() !== "")
    .map(([api_id, value]) => ({ api_id, value }));

  const body = {
    template_id: templateId,
    // M-92: test_mode is TRUE for now, by owner instruction. A test-mode
    // document is not legally executed, which is why signature_requests
    // records the flag alongside the id.
    test_mode: true,
    draft: false,
    name: `PickLoads Dispatch Service Agreement — ${args.carrierName}`,
    subject: "Your PickLoads dispatch service agreement",
    message:
      "Please review and sign your PickLoads dispatch service agreement. Questions? Call (908) 404-5373.",
    apply_signing_order: true,
    embedded_signing: false,
    recipients: [
      {
        id: "1",
        placeholder_name: SIGNWELL_PLACEHOLDERS.carrier,
        name: args.carrierSignerName,
        email: args.carrierSignerEmail,
        send_email: true,
      },
      {
        id: "2",
        placeholder_name: SIGNWELL_PLACEHOLDERS.pickloads,
        name: args.pickloadsName,
        email: args.pickloadsEmail,
        send_email: true,
      },
    ],
    template_fields: templateFields,
    metadata: {
      carrier_id: args.carrierId,
      agreement_type: "dispatch_agreement",
    },
  };

  try {
    const res = await fetch(`${API_BASE}/document_templates/documents`, {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // The provider's error text can echo the request. It is logged for an
      // operator and never returned to a caller.
      const detail = await res.text().catch(() => "");
      console.error(
        `[signwell] create failed HTTP ${res.status}: ${detail.slice(0, 500)}`,
      );
      return { ok: false, reason: `create_http_${res.status}` };
    }

    const parsed: unknown = await res.json();
    const doc =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { id?: unknown; status?: unknown; test_mode?: unknown })
        : {};
    if (typeof doc.id !== "string" || doc.id === "") {
      return { ok: false, reason: "create_no_document_id" };
    }
    return {
      ok: true,
      documentId: doc.id,
      status: typeof doc.status === "string" ? doc.status : "sent",
      testMode: doc.test_mode === true,
    };
  } catch (err) {
    console.error("[signwell] create request failed", err);
    return { ok: false, reason: "create_request_failed" };
  }
}

/**
 * Constant-time verification of a SignWell event hash.
 *
 * `time` is accepted as string|number because the payload carries it as a
 * JSON number; it is stringified exactly as SignWell's own Python sample does
 * (`str(params['event']['time'])`).
 */
export function verifySignwellEvent(args: {
  eventType: string;
  eventTime: string | number;
  eventHash: string;
}): boolean {
  const key = process.env.SIGNWELL_WEBHOOK_ID;
  if (!key) return false;

  const data = `${args.eventType}@${String(args.eventTime)}`;
  const expected = createHmac("sha256", key).update(data).digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(args.eventHash, "utf8");
  // Length check first: timingSafeEqual throws on a length mismatch, and a
  // throw inside a verifier is a denial-of-service lever.
  return a.length === b.length && timingSafeEqual(a, b);
}

export type ArtefactFetch =
  | { ok: true; bytes: Uint8Array; contentType: string }
  | { ok: false; reason: string };

async function readCapped(res: Response): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_ARTEFACT_BYTES) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  // Re-check after reading: content-length is a claim, not a guarantee.
  return buf.byteLength > MAX_ARTEFACT_BYTES ? null : buf;
}

/**
 * The completed, signed PDF.
 *
 * `audit_page=true` is SignWell's default and is requested explicitly so the
 * stored artefact carries its own audit trail — the thing that makes the PDF
 * evidentially useful later. `url_only` is deliberately NOT used: we want the
 * bytes in our own private bucket, not a dependency on a SignWell-hosted URL
 * whose lifetime and access control we do not own.
 */
export async function fetchCompletedPdf(
  documentId: string,
): Promise<ArtefactFetch> {
  const apiKey = process.env.SIGNWELL_API_KEY;
  if (!apiKey) return { ok: false, reason: "signwell_not_configured" };

  try {
    const url = `${API_BASE}/documents/${encodeURIComponent(documentId)}/completed_pdf?audit_page=true&file_format=pdf`;
    const res = await fetch(url, { headers: { "X-Api-Key": apiKey } });
    if (!res.ok) {
      // 400 here usually means "not generated yet" — SignWell documents a
      // few seconds of lag after completion. The caller retries via the
      // provider's own webhook redelivery rather than sleeping in a handler.
      return { ok: false, reason: `completed_pdf_http_${res.status}` };
    }
    const bytes = await readCapped(res);
    if (!bytes) return { ok: false, reason: "completed_pdf_too_large" };
    return {
      ok: true,
      bytes,
      contentType: res.headers.get("content-type") ?? "application/pdf",
    };
  } catch (err) {
    return {
      ok: false,
      reason: `completed_pdf_error:${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

/**
 * The NOM-151 completion certificate.
 *
 * OPTIONAL BY DESIGN. This endpoint is not available on every SignWell plan
 * or account configuration, and a 404 here is a normal answer rather than a
 * failure. The signed agreement is the artefact the business needs; the
 * certificate is corroborating evidence. Letting its absence fail the whole
 * webhook would mean an unavailable certificate blocks carrier activation,
 * which is the wrong thing to be strict about.
 */
export async function fetchCompletionCertificate(
  documentId: string,
): Promise<ArtefactFetch> {
  const apiKey = process.env.SIGNWELL_API_KEY;
  if (!apiKey) return { ok: false, reason: "signwell_not_configured" };

  try {
    const url = `${API_BASE}/documents/${encodeURIComponent(documentId)}/nom151_certificate?url_only=true`;
    const res = await fetch(url, { headers: { "X-Api-Key": apiKey } });
    if (!res.ok) return { ok: false, reason: `certificate_http_${res.status}` };

    const body: unknown = await res.json();
    const fileUrl =
      typeof body === "object" && body !== null && "file_url" in body
        ? (body as { file_url?: unknown }).file_url
        : undefined;
    if (typeof fileUrl !== "string" || !fileUrl.startsWith("https://")) {
      return { ok: false, reason: "certificate_no_url" };
    }

    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) {
      return { ok: false, reason: `certificate_file_http_${fileRes.status}` };
    }
    const bytes = await readCapped(fileRes);
    if (!bytes) return { ok: false, reason: "certificate_too_large" };
    return {
      ok: true,
      bytes,
      contentType: fileRes.headers.get("content-type") ?? "application/pdf",
    };
  } catch (err) {
    return {
      ok: false,
      reason: `certificate_error:${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}
