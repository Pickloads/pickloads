"use server";

import type { FormState } from "@/lib/form-state";
import {
  field,
  guardPublicForm,
  SERVER_ERROR_MESSAGE,
} from "@/lib/forms/guard";
import { freightQuoteSchema } from "@/lib/validation/freight-quote";
import { firstIssueMessage } from "@/lib/validation/shared";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { EMAIL_INTERNAL_TO, sendEmail } from "@/lib/email/send";
import { QuoteNotificationEmail } from "@/emails/QuoteNotificationEmail";

/** Flux 2 — shipper freight quote (reply within 1 business hour). */
export async function submitFreightQuote(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const guard = await guardPublicForm("freight-quote", formData);
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = freightQuoteSchema.safeParse({
    pickup_zip: field(formData, "pickup_zip"),
    delivery_zip: field(formData, "delivery_zip"),
    pickup_date: field(formData, "pickup_date"),
    commodity: field(formData, "commodity"),
    weight_lbs: field(formData, "weight_lbs"),
    pallets: field(formData, "pallets"),
    equipment: field(formData, "equipment"),
    frequency: field(formData, "frequency"),
    company_name: field(formData, "company_name"),
    email: field(formData, "email"),
    phone: field(formData, "phone"),
    locale: field(formData, "locale"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const quote = parsed.data;

  let quoteId: string | undefined;
  try {
    const admin = tryCreateAdminClient();
    if (admin) {
      const { data, error } = await admin
        .from("freight_quotes")
        .insert({
          pickup_zip: quote.pickup_zip,
          delivery_zip: quote.delivery_zip,
          pickup_date: quote.pickup_date,
          commodity: quote.commodity,
          weight_lbs: quote.weight_lbs,
          pallets: quote.pallets,
          equipment: quote.equipment,
          frequency: quote.frequency,
          company_name: quote.company_name,
          email: quote.email,
          phone: quote.phone,
          locale: quote.locale,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      quoteId = data.id;
    }
  } catch (err) {
    console.error("[freight-quote] insert failed", err);
    return { status: "error", message: SERVER_ERROR_MESSAGE };
  }

  await sendEmail({
    to: EMAIL_INTERNAL_TO,
    subject: `Freight quote — ${quote.pickup_zip ?? "?"} → ${quote.delivery_zip ?? "?"} (${quote.equipment ?? "TBD"})`,
    template: "freight-quote-notification",
    react: <QuoteNotificationEmail quote={quote} />,
    replyTo: quote.email,
    ...(quoteId ? { quoteId } : {}),
  });

  return { status: "success" };
}
