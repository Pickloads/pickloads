"use server";

import type { FormState } from "@/lib/form-state";
import {
  field,
  guardPublicForm,
  SERVER_ERROR_MESSAGE,
} from "@/lib/forms/guard";
import { carrierLeadSchema } from "@/lib/validation/carrier-lead";
import { firstIssueMessage } from "@/lib/validation/shared";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { EMAIL_INTERNAL_TO, sendEmail } from "@/lib/email/send";
import { LeadNotificationEmail } from "@/emails/LeadNotificationEmail";

/**
 * Flux 1 — quick carrier lead ("Need a dispatcher?"). Pipeline per decision
 * Q3: rate limit → Turnstile → Zod → service-role insert → internal Resend
 * notification (email_log journaled). No auto-reply: phone-only form (F-12/Q6).
 */
export async function submitCarrierLead(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const guard = await guardPublicForm("carrier-lead", formData);
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = carrierLeadSchema.safeParse({
    lead_type: field(formData, "lead_type"),
    full_name: field(formData, "full_name"),
    email: field(formData, "email"),
    truck_type: field(formData, "truck_type"),
    trailer_type: field(formData, "trailer_type"),
    home_state: field(formData, "home_state"),
    truck_count: field(formData, "truck_count"),
    stage: field(formData, "stage"),
    phone: field(formData, "phone"),
    locale: field(formData, "locale"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const lead = parsed.data;

  let leadId: string | undefined;
  try {
    const admin = tryCreateAdminClient();
    if (admin) {
      // M-26: new-authority submissions are distinguished by lead_type,
      // source and an automatic tag (arch: "auto-tag") for CRM filtering.
      const isNewAuthority = lead.lead_type === "new_authority";
      const { data, error } = await admin
        .from("carrier_leads")
        .insert({
          lead_type: lead.lead_type,
          full_name: lead.full_name,
          email: lead.email,
          truck_type: lead.truck_type,
          trailer_type: lead.trailer_type,
          home_state: lead.home_state,
          truck_count: lead.truck_count,
          phone: lead.phone,
          source: isNewAuthority ? "new_authority_page" : "quick_form",
          tags: isNewAuthority ? ["new-authority"] : [],
          locale: lead.locale,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      leadId = data.id;

      // M-26: the self-reported launch stage isn't a carrier_leads column
      // (schema final) — journal it so the CRM timeline opens with context.
      if (lead.stage) {
        const { error: stageError } = await admin
          .from("lead_activities")
          .insert({
            lead_id: leadId,
            type: "note",
            body: `Self-reported stage: ${lead.stage}`,
          });
        if (stageError) {
          console.error("[carrier-lead] stage note failed", stageError.message);
        }
      }
    }
  } catch (err) {
    console.error("[carrier-lead] insert failed", err);
    return { status: "error", message: SERVER_ERROR_MESSAGE };
  }

  await sendEmail({
    to: EMAIL_INTERNAL_TO,
    subject:
      lead.lead_type === "new_authority"
        ? `New Authority lead — ${lead.full_name ?? "carrier"} · ${lead.phone}`
        : `New carrier lead — ${lead.truck_type ?? "carrier"} · ${lead.phone}`,
    template: "carrier-lead-notification",
    react: <LeadNotificationEmail lead={lead} />,
    ...(leadId ? { leadId } : {}),
  });

  return { status: "success" };
}
