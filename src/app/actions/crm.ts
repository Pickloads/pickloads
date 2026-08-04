"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isStaffRole } from "@/lib/auth";
import type { FormState } from "@/lib/form-state";
import type { Database } from "@/lib/supabase/database.types";

/**
 * M-23 CRM server actions — staff only.
 *
 * All writes go through the COOKIE-BOUND server client (not the admin
 * client): RLS staff policies are the second gate after the explicit role
 * check, and the DB journaling triggers (migration 0003) see `auth.uid()`,
 * so status changes are attributed to the acting dispatcher automatically.
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

async function staffSession(): Promise<{
  supabase: ServerSupabase;
  userId: string;
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
  return { supabase, userId: user.id };
}

const NOT_STAFF = "Your session expired or lacks staff access. Sign in again.";
const CRM_ERROR = "Couldn't save that change. Refresh and try again.";

const leadStatusSchema = z.enum([
  "new",
  "call",
  "qualified",
  "appointment",
  "agreement",
  "waiting_documents",
  "active",
  "inactive",
  "lost",
]);

export type LeadStatusValue = z.infer<typeof leadStatusSchema>;

/* ---------------- Kanban drag & drop ---------------- */

export async function updateLeadStatus(
  leadId: string,
  status: string,
): Promise<{ ok: boolean; error?: string }> {
  const id = z.uuid().safeParse(leadId);
  const next = leadStatusSchema.safeParse(status);
  if (!id.success || !next.success) {
    return { ok: false, error: "Invalid status change." };
  }
  const session = await staffSession();
  if (!session) return { ok: false, error: NOT_STAFF };

  // Journaling + first_contacted_at stamping are automatic (DB trigger).
  const { error } = await session.supabase
    .from("carrier_leads")
    .update({ status: next.data })
    .eq("id", id.data);
  if (error) {
    console.error("[crm] status update failed", error.message);
    return { ok: false, error: CRM_ERROR };
  }
  return { ok: true };
}

/* ---------------- Lead detail: activities ---------------- */

const activitySchema = z.object({
  lead_id: z.uuid(),
  type: z.enum(["note", "call", "callback", "appointment"]),
  body: z
    .string()
    .trim()
    .max(2000, "Note is too long.")
    .optional()
    .transform((v) => (v ? v : null)),
  // datetime-local input ("YYYY-MM-DDTHH:mm"); interpreted in server TZ.
  callback_at: z
    .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)])
    .optional()
    .transform((v) => (v ? new Date(v).toISOString() : null)),
});

export async function addLeadActivity(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = activitySchema.safeParse({
    lead_id: formData.get("lead_id"),
    type: formData.get("type"),
    body: typeof formData.get("body") === "string" ? formData.get("body") : "",
    callback_at:
      typeof formData.get("callback_at") === "string"
        ? formData.get("callback_at")
        : "",
  });
  if (!parsed.success) {
    return { status: "error", message: "Check the activity fields." };
  }
  const a = parsed.data;
  if ((a.type === "note" || a.type === "call") && !a.body) {
    return { status: "error", message: "Write a note first." };
  }
  if ((a.type === "callback" || a.type === "appointment") && !a.callback_at) {
    return { status: "error", message: "Pick a date & time." };
  }

  const session = await staffSession();
  if (!session) return { status: "error", message: NOT_STAFF };

  const { error } = await session.supabase.from("lead_activities").insert({
    lead_id: a.lead_id,
    type: a.type,
    body: a.body,
    created_by: session.userId, // RLS insert policy requires = auth.uid()
  });
  if (error) {
    console.error("[crm] activity insert failed", error.message);
    return { status: "error", message: CRM_ERROR };
  }

  // Callback/appointment also plans the next touch on the lead itself.
  if (a.callback_at) {
    const { error: cbError } = await session.supabase
      .from("carrier_leads")
      .update({ callback_at: a.callback_at })
      .eq("id", a.lead_id);
    if (cbError) console.error("[crm] callback_at update failed", cbError.message);
  }

  return { status: "success" };
}

/* ---------------- Lead detail: meta (assign/priority/tags/status) -------- */

const metaSchema = z.object({
  lead_id: z.uuid(),
  status: leadStatusSchema,
  assigned_to: z
    .union([z.literal(""), z.uuid()])
    .transform((v) => (v ? v : null)),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  tags: z
    .string()
    .max(400)
    .transform((v) =>
      v
        .split(",")
        .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-"))
        .filter((t) => t.length > 0)
        .slice(0, 12),
    ),
  callback_at: z
    .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)])
    .transform((v) => (v ? new Date(v).toISOString() : null)),
});

export async function updateLeadMeta(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = metaSchema.safeParse({
    lead_id: formData.get("lead_id"),
    status: formData.get("status"),
    assigned_to: formData.get("assigned_to") ?? "",
    priority: formData.get("priority"),
    tags: formData.get("tags") ?? "",
    callback_at: formData.get("callback_at") ?? "",
  });
  if (!parsed.success) {
    return { status: "error", message: "Check the lead fields." };
  }
  const m = parsed.data;

  const session = await staffSession();
  if (!session) return { status: "error", message: NOT_STAFF };

  const update: Database["public"]["Tables"]["carrier_leads"]["Update"] = {
    status: m.status,
    assigned_to: m.assigned_to,
    priority: m.priority,
    tags: m.tags,
    callback_at: m.callback_at,
  };
  const { error } = await session.supabase
    .from("carrier_leads")
    .update(update)
    .eq("id", m.lead_id);
  if (error) {
    console.error("[crm] meta update failed", error.message);
    return { status: "error", message: CRM_ERROR };
  }
  return { status: "success" };
}
