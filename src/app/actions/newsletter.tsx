"use server";

import type { FormState } from "@/lib/form-state";
import {
  field,
  guardPublicForm,
  SERVER_ERROR_MESSAGE,
} from "@/lib/forms/guard";
import { subscriberSchema } from "@/lib/validation/subscriber";
import { firstIssueMessage } from "@/lib/validation/shared";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import { NewsletterConfirmationEmail } from "@/emails/NewsletterConfirmationEmail";

/**
 * Newsletter signup with double opt-in (audit S-05): insert (or re-use) the
 * subscriber row, then email a confirm link that /api/newsletter/confirm
 * validates. Idempotent: re-subscribing re-sends the confirmation; an already
 * confirmed address just returns success (no address enumeration in the UI —
 * every valid submission shows the same "check your inbox" state).
 */
export async function subscribeNewsletter(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const guard = await guardPublicForm("newsletter", formData);
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = subscriberSchema.safeParse({
    email: field(formData, "email"),
    locale: field(formData, "locale"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const { email, locale } = parsed.data;

  let confirmToken: string | null = null;
  try {
    const admin = tryCreateAdminClient();
    if (admin) {
      const { data: existing, error: readError } = await admin
        .from("subscribers")
        .select("confirm_token, confirmed_at, unsubscribed_at")
        .eq("email", email)
        .maybeSingle();
      if (readError) throw new Error(readError.message);

      if (!existing) {
        const { data, error } = await admin
          .from("subscribers")
          .insert({ email, locale })
          .select("confirm_token")
          .single();
        if (error) throw new Error(error.message);
        confirmToken = data.confirm_token;
      } else if (existing.confirmed_at && !existing.unsubscribed_at) {
        return { status: "success" }; // already on the list — same UI state
      } else {
        // unconfirmed, or resubscribing after unsubscribe → re-send confirm
        confirmToken = existing.confirm_token;
        if (existing.unsubscribed_at) {
          const { error } = await admin
            .from("subscribers")
            .update({ unsubscribed_at: null, confirmed_at: null, locale })
            .eq("email", email);
          if (error) throw new Error(error.message);
        }
      }
    }
  } catch (err) {
    console.error("[newsletter] subscribe failed", err);
    return { status: "error", message: SERVER_ERROR_MESSAGE };
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const confirmUrl = `${siteUrl}/api/newsletter/confirm?token=${confirmToken ?? "dev-mode-no-token"}`;

  await sendEmail({
    to: email,
    subject: "Confirm your Freight Insights subscription",
    template: "newsletter-confirmation",
    react: <NewsletterConfirmationEmail confirmUrl={confirmUrl} />,
  });

  return { status: "success" };
}
