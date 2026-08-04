import "server-only";

import { z } from "zod";

/**
 * Dropbox Sign integration (decision Q5, module M-20 step 3 / M-22 webhook).
 *
 * The dispatch agreement is sent as an email signature request built from a
 * Dropbox Sign template (the lawyer-approved agreement uploaded once in the
 * Dropbox Sign dashboard). `metadata.carrier_id` ties the webhook back to the
 * carriers row.
 *
 * Graceful degradation: without DROPBOX_SIGN_API_KEY (+ template id) nothing
 * is sent and callers show the honest "pending legal review" state (U-09:
 * agreement is blocked on lawyer review anyway).
 */

const API_BASE = "https://api.hellosign.com/v3";

export function isEsignConfigured(): boolean {
  return Boolean(
    process.env.DROPBOX_SIGN_API_KEY && process.env.DROPBOX_SIGN_TEMPLATE_ID,
  );
}

export type SignatureRequestResult =
  | { sent: true; signatureRequestId: string | null }
  | { sent: false; reason: string };

export async function sendAgreementSignatureRequest(args: {
  carrierId: string;
  email: string;
  name: string;
}): Promise<SignatureRequestResult> {
  const apiKey = process.env.DROPBOX_SIGN_API_KEY;
  const templateId = process.env.DROPBOX_SIGN_TEMPLATE_ID;
  if (!apiKey || !templateId) {
    return { sent: false, reason: "esign_not_configured" };
  }

  const body = new URLSearchParams();
  body.set("template_ids[0]", templateId);
  body.set("subject", "PickLoads Dispatch Agreement — signature requested");
  body.set(
    "message",
    "Please review and sign your PickLoads dispatch service agreement. Questions? Call (908) 404-5373.",
  );
  body.set("signers[Carrier][name]", args.name);
  body.set("signers[Carrier][email_address]", args.email);
  body.set("metadata[carrier_id]", args.carrierId);
  if (process.env.DROPBOX_SIGN_TEST_MODE === "1") body.set("test_mode", "1");

  try {
    const res = await fetch(`${API_BASE}/signature_request/send_with_template`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[esign] send failed (${res.status}): ${text.slice(0, 300)}`);
      return { sent: false, reason: `api_error_${res.status}` };
    }
    const parsed = z
      .object({
        signature_request: z.object({ signature_request_id: z.string() }),
      })
      .safeParse(await res.json());
    return {
      sent: true,
      signatureRequestId: parsed.success
        ? parsed.data.signature_request.signature_request_id
        : null,
    };
  } catch (err) {
    console.error("[esign] send request failed", err);
    return { sent: false, reason: "network_error" };
  }
}
