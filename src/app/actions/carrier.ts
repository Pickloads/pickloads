"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/uploads";

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
    .select("storage_path")
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
  return { ok: true, url: data.signedUrl };
}
