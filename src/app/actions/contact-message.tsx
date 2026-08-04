"use server";

import type { FormState } from "@/lib/form-state";
import {
  field,
  guardPublicForm,
  SERVER_ERROR_MESSAGE,
} from "@/lib/forms/guard";
import { contactMessageSchema } from "@/lib/validation/contact-message";
import { firstIssueMessage } from "@/lib/validation/shared";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { EMAIL_INTERNAL_TO, sendEmail } from "@/lib/email/send";
import { ContactNotificationEmail } from "@/emails/ContactNotificationEmail";

/** Contact form → contact_messages (audit F-08) + internal notification. */
export async function submitContactMessage(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const guard = await guardPublicForm("contact-message", formData);
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = contactMessageSchema.safeParse({
    full_name: field(formData, "full_name"),
    email: field(formData, "email"),
    phone: field(formData, "phone"),
    subject: field(formData, "subject"),
    body: field(formData, "message"),
    locale: field(formData, "locale"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const message = parsed.data;

  try {
    const admin = tryCreateAdminClient();
    if (admin) {
      const { error } = await admin.from("contact_messages").insert({
        full_name: message.full_name,
        email: message.email,
        phone: message.phone,
        subject: message.subject,
        body: message.body,
        locale: message.locale,
      });
      if (error) throw new Error(error.message);
    }
  } catch (err) {
    console.error("[contact-message] insert failed", err);
    return { status: "error", message: SERVER_ERROR_MESSAGE };
  }

  await sendEmail({
    to: EMAIL_INTERNAL_TO,
    subject: `Contact form — ${message.subject ?? "(no subject)"}`,
    template: "contact-notification",
    react: <ContactNotificationEmail message={message} />,
    replyTo: message.email,
  });

  return { status: "success" };
}
