"use server";

import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { isStaffRole } from "@/lib/auth";
import { field } from "@/lib/forms/guard";
import { QUOTE_STAGE_MAP as STAGE_MAP, updateQuoteSchema } from "@/lib/validation/quotes";
import { firstIssueMessage } from "@/lib/validation/shared";
import { sendEmail } from "@/lib/email/send";
import { buildQuoteStatusEmail } from "@/emails/customer-templates";
import { resolveEmailLocale } from "@/emails/i18n";
import { getShipperOwnerRecipient, notifyCustomer } from "@/lib/notify";
import type { FormState } from "@/lib/form-state";

/**
 * M-60 — staff freight-quote status/rate updates. Until now quote statuses
 * could only change via direct DB edits, which meant the directive's
 * "quote status-updated" email had nothing to hang off. This action is the
 * missing staff surface: explicit staff gate → Zod → COOKIE-BOUND update
 * ("staff update quotes" RLS re-checks) → audit event → localized shipper
 * email + portal notification (only when the shipper-visible stage actually
 * changed — internal pipeline moves inside the same stage stay silent).
 */

const NOT_STAFF = "Your session expired or lacks staff access. Sign in again.";

export async function updateFreightQuote(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateQuoteSchema.safeParse({
    quote_id: field(formData, "quote_id"),
    status: field(formData, "status"),
    quoted_rate: field(formData, "quoted_rate"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: NOT_STAFF };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !isStaffRole(profile.role)) {
    return { status: "error", message: NOT_STAFF };
  }

  // Old state first — the notification fires only on a stage transition.
  const { data: before } = await supabase
    .from("freight_quotes")
    .select("id, status, quoted_rate, shipper_id, email, locale, pickup_city, pickup_state, pickup_zip, delivery_city, delivery_state, delivery_zip")
    .eq("id", parsed.data.quote_id)
    .maybeSingle();
  if (!before) return { status: "error", message: "Quote not found." };

  const { error } = await supabase
    .from("freight_quotes")
    .update({
      status: parsed.data.status,
      quoted_rate: parsed.data.quoted_rate,
    })
    .eq("id", parsed.data.quote_id);
  if (error) {
    console.error("[quotes] update failed", error.message);
    return { status: "error", message: "Couldn't save the quote. Retry." };
  }

  const admin = tryCreateAdminClient();
  if (admin) {
    const { error: auditError } = await admin.from("audit_events").insert({
      actor_id: user.id,
      action: "quote.status_change",
      target_table: "freight_quotes",
      target_id: before.id,
      detail: {
        old_status: before.status,
        new_status: parsed.data.status,
        quoted_rate: parsed.data.quoted_rate,
      },
    });
    if (auditError) {
      console.error("[quotes] audit insert failed", auditError.message);
    }
  }

  const oldStage = STAGE_MAP[before.status];
  const newStage = STAGE_MAP[parsed.data.status];
  const rateChanged = parsed.data.quoted_rate !== before.quoted_rate;
  if ((oldStage !== newStage || rateChanged) && admin) {
    const lane =
      before.pickup_city && before.delivery_city
        ? `${before.pickup_city}, ${before.pickup_state ?? "?"} → ${before.delivery_city}, ${before.delivery_state ?? "?"}`
        : `${before.pickup_zip ?? "?"} → ${before.delivery_zip ?? "?"}`;

    if (before.shipper_id) {
      // Portal shipper: notification + email in their preferred language.
      const recipient = await getShipperOwnerRecipient(admin, before.shipper_id);
      if (recipient) {
        const email = buildQuoteStatusEmail(recipient.locale, {
          lane,
          stage: newStage,
          quotedRate: parsed.data.quoted_rate,
        });
        await notifyCustomer({
          recipient,
          kind: "quote_status",
          title: email.subject,
          href: "/portal/shipper/quotes",
          email,
          quoteId: before.id,
        });
      }
    } else if (before.email) {
      // Public-form quote (no account): email only, in the form locale.
      const email = buildQuoteStatusEmail(resolveEmailLocale(before.locale), {
        lane,
        stage: newStage,
        quotedRate: parsed.data.quoted_rate,
      });
      await sendEmail({
        to: before.email,
        subject: email.subject,
        template: email.template,
        react: email.react,
        quoteId: before.id,
      });
    }
  }

  return { status: "success" };
}
