"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/uploads";
import { recordAuditEvent } from "@/lib/audit";

/**
 * M-25 carrier portal server actions. Everything runs on the cookie-bound
 * server client: RLS ("carrier own docs read", storage "carrier read own
 * folder") scopes every query to the signed-in carrier — there is no
 * carrier-id parameter to tamper with beyond what RLS already denies.
 */

export async function getMyDocumentSignedUrl(
  documentId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const id = z.uuid().safeParse(documentId);
  if (!id.success) return { ok: false, error: "Invalid document." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Session expired — sign in again." };

  // RLS returns the row only when it belongs to this carrier's folder.
  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path, carrier_id")
    .eq("id", id.data)
    .maybeSingle();
  if (!doc) return { ok: false, error: "Document not found." };

  // Storage RLS re-checks the folder prefix against the carrier (S-01);
  // links expire in ≤5 minutes.
  const { data, error } = await supabase.storage
    .from("carrier-docs")
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    console.error("[carrier] signed url failed", error?.message);
    return { ok: false, error: "Couldn't generate a download link." };
  }

  /*
   * M-69 / P-5 — journal the ACCESS on the carrier path.
   *
   * actions/admin.ts has audited `document.download` since M-61, but this
   * action — the one a carrier uses to pull their own W-9, COI or voided
   * check — minted signed URLs with no event at all, so the "document-access
   * history" the tracking directive §15 claims was only half true.
   *
   * Same helper, same action string and same shape as the staff path, so the
   * admin security log renders both without a special case. Recorded: who,
   * which document, which carrier, the URL lifetime. NEVER the signed URL
   * itself (that is a live credential) and never file contents.
   */
  await recordAuditEvent({
    actorId: user.id,
    action: "document.download",
    targetTable: "documents",
    targetId: id.data,
    detail: { carrier_id: doc.carrier_id, ttl_seconds: SIGNED_URL_TTL_SECONDS },
  });
  return { ok: true, url: data.signedUrl };
}
