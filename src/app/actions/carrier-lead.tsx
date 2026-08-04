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
    truck_type: field(formData, "truck_type"),
    trailer_type: field(formData, "trailer_type"),
    home_state: field(formData, "home_state"),
    truck_count: field(formData, "truck_count"),
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
      const { data, error } = await admin
        .from("carrier_leads")
        .insert({
          lead_type: "dispatch",
          truck_type: lead.truck_type,
          trailer_type: lead.trailer_type,
          home_state: lead.home_state,
          truck_count: lead.truck_count,
          phone: lead.phone,
          source: "quick_form",
          locale: lead.locale,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      leadId = data.id;
    }
  } catch (err) {
    console.error("[carrier-lead] insert failed", err);
    return { status: "error", message: SERVER_ERROR_MESSAGE };
  }

  await sendEmail({
    to: EMAIL_INTERNAL_TO,
    subject: `New carrier lead — ${lead.truck_type ?? "carrier"} · ${lead.phone}`,
    template: "carrier-lead-notification",
    react: <LeadNotificationEmail lead={lead} />,
    ...(leadId ? { leadId } : {}),
  });

  return { status: "success" };
}
