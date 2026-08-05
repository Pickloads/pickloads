"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { isStaffRole } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/uploads";
import { buildDocumentReviewedEmail } from "@/emails/customer-templates";
import { getCarrierOwnerRecipient, notifyCustomer } from "@/lib/notify";
import type { FormState } from "@/lib/form-state";

/**
 * M-24 admin server actions. Same security model as M-23: explicit
 * server-side role check first, then writes through the COOKIE-BOUND server
 * client so RLS staff/admin policies gate again (defense in depth). The
 * service-role client is deliberately not used here.
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

async function roleSession(): Promise<{
  supabase: ServerSupabase;
  userId: string;
  role: "admin" | "dispatcher";
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !isStaffRole(profile.role)) return null;
  if (profile.role !== "admin" && profile.role !== "dispatcher") return null;
  return { supabase, userId: user.id, role: profile.role };
}

const NOT_STAFF = "Your session expired or lacks staff access. Sign in again.";

/* ---------------- Document review (Operations) ---------------- */

const reviewSchema = z.object({
  document_id: z.uuid(),
  decision: z.enum(["approve", "reject"]),
  note: z
    .string()
    .trim()
    .max(500, "Note is too long.")
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function reviewDocument(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = reviewSchema.safeParse({
    document_id: formData.get("document_id"),
    decision: formData.get("decision"),
    note: typeof formData.get("note") === "string" ? formData.get("note") : "",
  });
  if (!parsed.success) {
    return { status: "error", message: "Check the review fields." };
  }
  if (parsed.data.decision === "reject" && !parsed.data.note) {
    return {
      status: "error",
      message: "A rejection needs a note — the carrier will ask why.",
    };
  }

  const session = await roleSession();
  if (!session) return { status: "error", message: NOT_STAFF };

  const { data: reviewed, error } = await session.supabase
    .from("documents")
    .update({
      status: parsed.data.decision === "approve" ? "approved" : "rejected",
      reviewed_by: session.userId,
      review_note: parsed.data.note,
    })
    .eq("id", parsed.data.document_id)
    .select("carrier_id, type")
    .maybeSingle();
  if (error) {
    console.error("[admin] document review failed", error.message);
    return { status: "error", message: "Couldn't save the review. Retry." };
  }

  // M-61 (audit §6.2): document review is a named sensitive staff action but
  // was journaled nowhere. It approves/rejects regulated compliance paperwork
  // — it belongs in the security log.
  await recordAuditEvent({
    actorId: session.userId,
    action: "document.review",
    targetTable: "documents",
    targetId: parsed.data.document_id,
    detail: {
      decision: parsed.data.decision,
      doc_type: reviewed?.type ?? null,
      carrier_id: reviewed?.carrier_id ?? null,
      has_note: parsed.data.note !== null,
    },
  });

  // M-60: notify the carrier owner (portal feed + localized email).
  // Best-effort — the review itself is already committed.
  if (reviewed) {
    const admin = tryCreateAdminClient();
    const recipient = admin
      ? await getCarrierOwnerRecipient(admin, reviewed.carrier_id)
      : null;
    if (recipient) {
      const email = buildDocumentReviewedEmail(recipient.locale, {
        docType: reviewed.type,
        decision: parsed.data.decision === "approve" ? "approved" : "rejected",
        note: parsed.data.note,
      });
      await notifyCustomer({
        recipient,
        kind: "document_reviewed",
        title: email.subject,
        body: parsed.data.note,
        href: "/portal/carrier/documents",
        email,
      });
    }
  }
  return { status: "success" };
}

/* ---------------- Signed URL for staff review (≤5 min, S-01) ------------ */

export async function getDocumentSignedUrl(
  documentId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const id = z.uuid().safeParse(documentId);
  if (!id.success) return { ok: false, error: "Invalid document." };

  const session = await roleSession();
  if (!session) return { ok: false, error: NOT_STAFF };

  const { data: doc } = await session.supabase
    .from("documents")
    .select("storage_path")
    .eq("id", id.data)
    .maybeSingle();
  if (!doc) return { ok: false, error: "Document not found." };

  // Storage RLS "staff manage carrier docs" authorizes this user directly.
  const { data, error } = await session.supabase.storage
    .from("carrier-docs")
    .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS); // S-01
  if (error || !data) {
    console.error("[admin] signed url failed", error?.message);
    return { ok: false, error: "Couldn't generate a download link." };
  }

  // M-61: staff pulling a carrier's private W-9 / voided check / COI is the
  // single highest-PII read in the product. Journal the ACCESS (never the
  // signed URL itself — that would put a live credential in the ledger).
  await recordAuditEvent({
    actorId: session.userId,
    action: "document.download",
    targetTable: "documents",
    targetId: id.data,
    detail: { ttl_seconds: SIGNED_URL_TTL_SECONDS },
  });
  return { ok: true, url: data.signedUrl };
}

/* ---------------- Company settings (admin only) ---------------- */

const settingSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_]+$/, "Keys are lowercase snake_case."),
  value: z.string().trim().min(1, "Value is required.").max(4000),
});

export async function updateCompanySetting(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = settingSchema.safeParse({
    key: formData.get("key"),
    value: formData.get("value"),
  });
  if (!parsed.success) {
    return { status: "error", message: "Check the setting fields." };
  }

  let value: unknown;
  try {
    value = JSON.parse(parsed.data.value);
  } catch {
    return {
      status: "error",
      message:
        'Value must be valid JSON — e.g. {"status":"active","value":"MC-123456"} or true or "sample".',
    };
  }

  const session = await roleSession();
  if (!session || session.role !== "admin") {
    return {
      status: "error",
      message: "Only admins can change company settings.",
    };
  }

  // RLS "admin write settings" gates this again at the DB.
  const { error } = await session.supabase
    .from("company_settings")
    .update({ value, updated_by: session.userId })
    .eq("key", parsed.data.key);
  if (error) {
    console.error("[admin] setting update failed", error.message);
    return { status: "error", message: "Couldn't save the setting. Retry." };
  }

  // M-61 (audit §6.2): `company_settings` is the launch switchboard — MC/DOT
  // numbers, the brokerage flip, signup gating. `updated_by` recorded WHO but
  // not WHAT or WHEN-from-where, and it is overwritten on the next edit.
  // The key is journaled; the value is not (settings can hold long JSON and
  // the ledger is not the place for payloads).
  await recordAuditEvent({
    actorId: session.userId,
    action: "settings.update",
    targetTable: "company_settings",
    detail: { key: parsed.data.key },
  });
  return { status: "success" };
}
