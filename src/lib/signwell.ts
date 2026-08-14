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
