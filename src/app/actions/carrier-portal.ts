"use server";

import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { recordAuditEvent } from "@/lib/audit";
import { getMyCarrierId } from "@/lib/memberships";
import { checkRateLimit } from "@/lib/rate-limit";
import { field } from "@/lib/forms/guard";
import {
  changeRequestSchema,
  contactInfoSchema,
  dispatchPreferencesSchema,
  REGULATED_FIELD_LABELS,
} from "@/lib/validation/portal";
import { firstIssueMessage } from "@/lib/validation/shared";
import { sendAgreementSignatureRequest } from "@/lib/esign";
import { EMAIL_INTERNAL_TO, sendEmail } from "@/lib/email/send";
import { buildAgreementSentEmail } from "@/emails/customer-templates";
import { getRecipientByProfile, notifyCustomer } from "@/lib/notify";
import { InternalNotification } from "@/emails/InternalNotification";
import type { FormState } from "@/lib/form-state";

/**
 * M-55 — carrier company-profile self-service (decision D5):
 * - Contact info (name/phone): cookie-bound update under "own profile update".
 * - Dispatch preferences (lanes/home time): service-role write to the two
 *   0010 preference columns AFTER a server-side membership check — carriers
 *   deliberately has no member UPDATE policy, so regulated columns
 *   (MC/DOT/EIN/fee) stay out of reach even with a stolen session token.
 * - Regulated-field changes: change REQUEST only — a tagged support thread
 *   for staff review + an audit_events row. Nothing changes until staff act.
 */

const SIGN_IN_AGAIN = "Your session expired — sign in again.";
const NOT_LINKED =
  "Your account isn't linked to a carrier record yet — call (908) 404-5373.";

export async function updateContactInfo(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = contactInfoSchema.safeParse({
    full_name: field(formData, "full_name"),
    phone: field(formData, "phone"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: SIGN_IN_AGAIN };

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: parsed.data.full_name, phone: parsed.data.phone })
    .eq("id", user.id);
  if (error) {
    console.error("[carrier-portal] contact update failed", error.message);
    return { status: "error", message: "Couldn't save your info. Retry." };
  }
  return { status: "success" };
}

export async function updateDispatchPreferences(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = dispatchPreferencesSchema.safeParse({
    preferred_lanes: field(formData, "preferred_lanes"),
    home_time_notes: field(formData, "home_time_notes"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: SIGN_IN_AGAIN };
  const carrierId = await getMyCarrierId(supabase);
  if (!carrierId) return { status: "error", message: NOT_LINKED };

  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      status: "error",
      message:
        "This environment isn't connected to the database — nothing was saved. Call (908) 404-5373.",
    };
  }
  // Service role, but scoped strictly to the membership-verified carrier and
  // to the two D5 preference columns.
  const { error } = await admin
    .from("carriers")
    .update({
      preferred_lanes: parsed.data.preferred_lanes,
      home_time_notes: parsed.data.home_time_notes,
    })
    .eq("id", carrierId);
  if (error) {
    console.error("[carrier-portal] preferences update failed", error.message);
    return { status: "error", message: "Couldn't save preferences. Retry." };
  }
  return { status: "success" };
}

export async function submitChangeRequest(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = changeRequestSchema.safeParse({
    field: field(formData, "field"),
    message: field(formData, "message"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: SIGN_IN_AGAIN };
  if (!(await checkRateLimit("change-request", user.id, 5))) {
    return {
      status: "error",
      message:
        "Too many change requests. Wait a few minutes — or call (908) 404-5373.",
    };
  }
  const carrierId = await getMyCarrierId(supabase);
  if (!carrierId) return { status: "error", message: NOT_LINKED };

  const label = REGULATED_FIELD_LABELS[parsed.data.field];

  // Tagged support thread — staff approve/apply the change from the desk.
  const { data: thread, error: threadError } = await supabase
    .from("support_threads")
    .insert({
      profile_id: user.id,
      carrier_id: carrierId,
      subject: `[CHANGE REQUEST] ${label}`,
      status: "open",
    })
    .select("id")
    .single();
  if (threadError) {
    console.error("[carrier-portal] change thread failed", threadError.message);
    return { status: "error", message: "Couldn't submit the request. Retry." };
  }
  const { error: messageError } = await supabase
    .from("support_messages")
    .insert({
      thread_id: thread.id,
      author_id: user.id,
      body: parsed.data.message,
      is_staff: false,
    });
  if (messageError) {
    console.error("[carrier-portal] change message failed", messageError.message);
    return { status: "error", message: "Couldn't submit the request. Retry." };
  }

  // Audit trail (service-role-only table; best-effort, loud on failure).
  // M-69/P-4: routed through the single writer in src/lib/audit.ts.
  await recordAuditEvent({
    actorId: user.id,
    action: "carrier.change_request",
    targetTable: "carriers",
    targetId: carrierId,
    detail: { field: parsed.data.field, thread_id: thread.id },
  });

  await sendEmail({
    to: EMAIL_INTERNAL_TO,
    subject: `Change request — ${label}`,
    template: "carrier-change-request",
    react: InternalNotification({
      eyebrow: "Compliance",
      title: `Carrier change request: ${label}`,
      preview: `Change request — ${label}`,
      rows: [
        { label: "From", value: user.email ?? user.id },
        { label: "Field", value: label },
        { label: "Request", value: parsed.data.message.slice(0, 500) },
      ],
      footNote:
        "Verify before applying — regulated fields change only after staff review (D5).",
    }),
  });

  return { status: "success" };
}

/**
 * M-55 — agreements page "request re-send". Uses the M-22 e-sign flow with
 * the verified session email; honest refusal when e-sign isn't configured.
 */
export async function requestAgreementResend(): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return { status: "error", message: SIGN_IN_AGAIN };
  }
  if (!(await checkRateLimit("agreement-resend", user.id, 3))) {
    return {
      status: "error",
      message: "Already requested — give it a few minutes, then check your inbox.",
    };
  }
  const carrierId = await getMyCarrierId(supabase);
  if (!carrierId) return { status: "error", message: NOT_LINKED };

  const { data: carrier } = await supabase
    .from("carriers")
    .select("id, company_name, agreement_signed_at")
    .eq("id", carrierId)
    .maybeSingle();
  if (!carrier) return { status: "error", message: NOT_LINKED };
  if (carrier.agreement_signed_at !== null) {
    return {
      status: "error",
      message: "Your agreement is already signed — nothing to re-send.",
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  const result = await sendAgreementSignatureRequest({
    carrierId: carrier.id,
    email: user.email,
    name: profile?.full_name ?? carrier.company_name,
  });
  if (!result.sent) {
    // Honest state: nothing went out. The dispatch desk sends it manually.
    await sendEmail({
      to: EMAIL_INTERNAL_TO,
      subject: `Agreement re-send requested — ${carrier.company_name}`,
      template: "agreement-resend-requested",
      react: InternalNotification({
        eyebrow: "Operations",
        title: "Carrier asked for the agreement again",
        preview: `Agreement re-send — ${carrier.company_name}`,
        rows: [
          { label: "Carrier", value: carrier.company_name },
          { label: "Email", value: user.email },
          { label: "Auto-send", value: `failed (${result.reason})` },
        ],
        footNote: "Send the Dropbox Sign request manually.",
      }),
    });
    return {
      status: "error",
      message:
        "E-signing isn't connected right now — we've alerted the dispatch desk to send it manually. Or call (908) 404-5373.",
    };
  }

  const admin = tryCreateAdminClient();
  if (admin) {
    await recordAuditEvent({
      actorId: user.id,
      action: "agreement.resend_requested",
      targetTable: "carriers",
      targetId: carrier.id,
      detail: { signature_request_id: result.signatureRequestId },
    });
    // M-60: confirmation email + portal notification in the user's language.
    const recipient = await getRecipientByProfile(admin, user.id);
    if (recipient) {
      const email = buildAgreementSentEmail(recipient.locale, {
        companyName: carrier.company_name,
      });
      await notifyCustomer({
        recipient,
        kind: "agreement_sent",
        title: email.subject,
        href: "/portal/carrier/agreements",
        email,
      });
    }
  }
  return { status: "success" };
}
