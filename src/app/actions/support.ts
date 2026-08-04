"use server";

import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { getMyCarrierId, getMyShipperId } from "@/lib/memberships";
import { checkRateLimit } from "@/lib/rate-limit";
import { field } from "@/lib/forms/guard";
import {
  supportReplySchema,
  supportThreadSchema,
} from "@/lib/validation/portal";
import { firstIssueMessage } from "@/lib/validation/shared";
import { EMAIL_INTERNAL_TO, sendEmail } from "@/lib/email/send";
import { InternalNotification } from "@/emails/InternalNotification";
import {
  buildSupportConfirmationEmail,
  buildSupportReplyEmail,
} from "@/emails/customer-templates";
import { getRecipientByProfile, notifyCustomer } from "@/lib/notify";
import type { FormState } from "@/lib/form-state";

/**
 * M-55 — support threads (decision D2: simple threaded messages, no SLA
 * engine). Authenticated write surface (audit §6.8): body length is capped
 * in-schema (5000) AND in Zod, inserts are rate-limited per user, rendering
 * is escape-first (plain text, React-escaped). All writes run cookie-bound
 * under the 0007/0009 RLS policies ("own support threads insert" /
 * "own support messages insert") — is_staff is forced false for customers at
 * the policy level, so a forged staff flag can never render as PickLoads.
 */

const SIGN_IN_AGAIN = "Your session expired — sign in again.";
const RATE_LIMITED =
  "You're sending messages too quickly. Wait a few minutes and try again — or call (908) 404-5373.";

export async function createSupportThread(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = supportThreadSchema.safeParse({
    subject: field(formData, "subject"),
    body: field(formData, "body"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: SIGN_IN_AGAIN };
  if (!(await checkRateLimit("support", user.id, 10))) {
    return { status: "error", message: RATE_LIMITED };
  }

  // Company context (either may be null — staff sees the author regardless).
  const [carrierId, shipperId] = await Promise.all([
    getMyCarrierId(supabase),
    getMyShipperId(supabase),
  ]);

  const { data: thread, error: threadError } = await supabase
    .from("support_threads")
    .insert({
      profile_id: user.id,
      carrier_id: carrierId,
      shipper_id: shipperId,
      subject: parsed.data.subject,
      status: "open",
    })
    .select("id")
    .single();
  if (threadError) {
    console.error("[support] thread insert failed", threadError.message);
    return { status: "error", message: "Couldn't send your message. Retry." };
  }

  const { error: messageError } = await supabase
    .from("support_messages")
    .insert({
      thread_id: thread.id,
      author_id: user.id,
      body: parsed.data.body,
      is_staff: false,
    });
  if (messageError) {
    console.error("[support] message insert failed", messageError.message);
    return { status: "error", message: "Couldn't send your message. Retry." };
  }

  // Best-effort ops notification (email is never the source of truth).
  await sendEmail({
    to: EMAIL_INTERNAL_TO,
    subject: `Support — ${parsed.data.subject}`,
    template: "support-thread-created",
    react: InternalNotification({
      eyebrow: "Support",
      title: "New support thread",
      preview: parsed.data.subject,
      rows: [
        { label: "From", value: user.email ?? user.id },
        { label: "Subject", value: parsed.data.subject },
        { label: "Message", value: parsed.data.body.slice(0, 500) },
      ],
      footNote: "Answer it from /portal/admin/support.",
    }),
  });

  // M-60: customer confirmation in their preferred language (email only —
  // a portal notification for their own message would be noise).
  {
    const admin = tryCreateAdminClient();
    const recipient = admin
      ? await getRecipientByProfile(admin, user.id)
      : null;
    if (recipient?.email) {
      const portalPath = shipperId !== null && carrierId === null
        ? "/portal/shipper/support"
        : "/portal/carrier/support";
      const email = buildSupportConfirmationEmail(recipient.locale, {
        threadSubject: parsed.data.subject,
        portalPath,
      });
      await sendEmail({
        to: recipient.email,
        subject: email.subject,
        template: email.template,
        react: email.react,
      });
    }
  }

  return { status: "success" };
}

export async function replyToSupportThread(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = supportReplySchema.safeParse({
    thread_id: field(formData, "thread_id"),
    body: field(formData, "body"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: SIGN_IN_AGAIN };
  if (!(await checkRateLimit("support", user.id, 10))) {
    return { status: "error", message: RATE_LIMITED };
  }

  // RLS: insert succeeds only when the thread belongs to this profile.
  const { error } = await supabase.from("support_messages").insert({
    thread_id: parsed.data.thread_id,
    author_id: user.id,
    body: parsed.data.body,
    is_staff: false,
  });
  if (error) {
    console.error("[support] reply insert failed", error.message);
    return { status: "error", message: "Couldn't send your message. Retry." };
  }

  // Customer replied → thread needs staff attention again. Their session
  // can't update threads (RLS), so flip via service role, scoped to the
  // thread they just proved they can write to.
  const admin = tryCreateAdminClient();
  if (admin) {
    const { error: statusError } = await admin
      .from("support_threads")
      .update({ status: "open" })
      .eq("id", parsed.data.thread_id)
      .eq("profile_id", user.id);
    if (statusError) {
      console.error("[support] thread reopen failed", statusError.message);
    }
  }

  return { status: "success" };
}

/**
 * M-55 admin side — staff answer from the support inbox. Cookie-bound: the
 * "staff manage support messages/threads" policies authorize it, and
 * is_staff=true is legitimate here.
 */
export async function staffReplyToSupportThread(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = supportReplySchema.safeParse({
    thread_id: field(formData, "thread_id"),
    body: field(formData, "body"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: SIGN_IN_AGAIN };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || (profile.role !== "admin" && profile.role !== "dispatcher")) {
    return { status: "error", message: "Staff access required." };
  }

  const { error } = await supabase.from("support_messages").insert({
    thread_id: parsed.data.thread_id,
    author_id: user.id,
    body: parsed.data.body,
    is_staff: true,
  });
  if (error) {
    console.error("[support] staff reply failed", error.message);
    return { status: "error", message: "Couldn't send the reply. Retry." };
  }
  const { error: statusError } = await supabase
    .from("support_threads")
    .update({ status: "answered" })
    .eq("id", parsed.data.thread_id);
  if (statusError) {
    console.error("[support] thread status failed", statusError.message);
  }

  // M-60: tell the customer their thread has an answer (email + feed).
  {
    const admin = tryCreateAdminClient();
    if (admin) {
      const { data: thread } = await admin
        .from("support_threads")
        .select("profile_id, subject, carrier_id, shipper_id")
        .eq("id", parsed.data.thread_id)
        .maybeSingle();
      if (thread) {
        const recipient = await getRecipientByProfile(admin, thread.profile_id);
        if (recipient) {
          const base = thread.shipper_id !== null && thread.carrier_id === null
            ? "/portal/shipper/support"
            : "/portal/carrier/support";
          const portalPath = `${base}/${parsed.data.thread_id}`;
          const email = buildSupportReplyEmail(recipient.locale, {
            threadSubject: thread.subject,
            portalPath,
          });
          await notifyCustomer({
            recipient,
            kind: "support_reply",
            title: email.subject,
            href: portalPath,
            email,
          });
        }
      }
    }
  }
  return { status: "success" };
}

/** Staff-only: close/reopen a thread from the admin inbox. */
export async function setSupportThreadStatus(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const threadId = field(formData, "thread_id");
  const status = field(formData, "status");
  if (
    !/^[0-9a-f-]{36}$/i.test(threadId) ||
    (status !== "open" && status !== "answered" && status !== "closed")
  ) {
    return { status: "error", message: "Invalid request." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: SIGN_IN_AGAIN };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || (profile.role !== "admin" && profile.role !== "dispatcher")) {
    return { status: "error", message: "Staff access required." };
  }
  const { error } = await supabase
    .from("support_threads")
    .update({ status })
    .eq("id", threadId);
  if (error) {
    console.error("[support] status update failed", error.message);
    return { status: "error", message: "Couldn't update the thread. Retry." };
  }
  return { status: "success" };
}
