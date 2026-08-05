"use server";

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { field } from "@/lib/forms/guard";
import {
  acceptInviteSchema,
  accountStatusSchema,
  assignDispatcherSchema,
  staffInviteSchema,
} from "@/lib/validation/staff";
import { firstIssueMessage } from "@/lib/validation/shared";
import { EMAIL_INTERNAL_TO, sendEmail } from "@/lib/email/send";
import { AccountStatusEmail } from "@/emails/AccountStatusEmail";
import { buildCarrierApprovedEmail } from "@/emails/customer-templates";
import { getCarrierOwnerRecipient, notifyCustomer } from "@/lib/notify";
import { z } from "zod";
import { StaffInviteEmail } from "@/emails/StaffInviteEmail";
import { InternalNotification } from "@/emails/InternalNotification";
import type { FormState } from "@/lib/form-state";
import { recordAuditEvent } from "@/lib/audit";

/**
 * M-58 — admin account management. Every mutation: explicit ADMIN gate
 * (dispatchers never manage accounts) → Zod → service-role write →
 * `account_status_history` / `audit_events` journaling → customer email +
 * in-portal notification. Invite tokens are stored as SHA-256 hashes only,
 * single-use and expiring; the accept action assigns the role via the
 * service role (guard_role_change keeps blocking self-promotion).
 */

const NOT_ADMIN = "Only admins can manage accounts.";
const NO_ENV =
  "Service credentials aren't configured in this environment — nothing was changed.";

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

async function adminSession(): Promise<
  { supabase: ServerSupabase; userId: string; fullName: string | null } | null
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin") return null;
  return { supabase, userId: user.id, fullName: profile.full_name };
}

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "https://pickloads.com";
}

/* ---------------- Approve / suspend / reactivate ---------------- */

export async function setAccountStatus(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = accountStatusSchema.safeParse({
    profile_id: field(formData, "profile_id"),
    action: field(formData, "action"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const session = await adminSession();
  if (!session) return { status: "error", message: NOT_ADMIN };
  if (parsed.data.profile_id === session.userId) {
    return { status: "error", message: "You can't change your own account status." };
  }
  const admin = tryCreateAdminClient();
  if (!admin) return { status: "error", message: NO_ENV };

  const { data: target } = await admin
    .from("profiles")
    .select("id, role, status, full_name")
    .eq("id", parsed.data.profile_id)
    .maybeSingle();
  if (!target) return { status: "error", message: "User not found." };
  if (target.role === "admin") {
    return {
      status: "error",
      message: "Admin accounts can't be changed here — do it in the database with a second admin present.",
    };
  }

  const newStatus = parsed.data.action === "suspend" ? "suspended" : "active";
  if (target.status === newStatus) {
    return { status: "error", message: `Account is already ${newStatus}.` };
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({ status: newStatus })
    .eq("id", target.id);
  if (updateError) {
    console.error("[staff] status update failed", updateError.message);
    return { status: "error", message: "Couldn't update the account. Retry." };
  }

  const { error: historyError } = await admin
    .from("account_status_history")
    .insert({
      profile_id: target.id,
      old_status: target.status,
      new_status: newStatus,
      reason: parsed.data.reason,
      changed_by: session.userId,
    });
  if (historyError) {
    console.error("[staff] history insert failed", historyError.message);
  }
  await recordAuditEvent({
    actorId: session.userId,
    action: parsed.data.action === "suspend" ? "user.suspend" : "user.activate",
    targetTable: "profiles",
    targetId: target.id,
    detail: { reason: parsed.data.reason, old_status: target.status },
  });

  // In-portal notification (visible next sign-in when reactivated).
  const { error: notifyError } = await admin.from("notifications").insert({
    profile_id: target.id,
    kind: "account_status",
    title:
      newStatus === "active"
        ? "Your account is active"
        : "Your account was suspended",
    body: parsed.data.reason,
  });
  if (notifyError) {
    console.error("[staff] notification insert failed", notifyError.message);
  }

  // Customer email (auth.users holds the address).
  const { data: authUser } = await admin.auth.admin.getUserById(target.id);
  const email = authUser?.user?.email;
  if (email) {
    await sendEmail({
      to: email,
      subject:
        newStatus === "active"
          ? "Your PickLoads account is active"
          : "Your PickLoads account has been suspended",
      template: "account-status-change",
      react: AccountStatusEmail({
        fullName: target.full_name,
        status: newStatus,
        reason: parsed.data.reason,
      }),
    });
  }

  return { status: "success" };
}

/* ---------------- Carrier activation (M-60) ---------------- */

const carrierActiveSchema = z.object({
  carrier_id: z.uuid("Invalid carrier."),
  active: z.enum(["1", "0"], { message: "Invalid action." }),
});

/**
 * Flip `carriers.active` — the compliance go/no-go that the onboarding
 * checklist, insurance cron and loads matching key off. Admin-only (same
 * bar as account status). Activation (false→true) sends the directive's
 * "carrier approved" email + portal notification to the owner.
 */
export async function setCarrierActive(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = carrierActiveSchema.safeParse({
    carrier_id: field(formData, "carrier_id"),
    active: field(formData, "active"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const session = await adminSession();
  if (!session) return { status: "error", message: NOT_ADMIN };
  const admin = tryCreateAdminClient();
  if (!admin) return { status: "error", message: NO_ENV };

  const makeActive = parsed.data.active === "1";
  const { data: carrier, error } = await admin
    .from("carriers")
    .update({ active: makeActive })
    .eq("id", parsed.data.carrier_id)
    .neq("active", makeActive)
    .select("id, company_name")
    .maybeSingle();
  if (error) {
    console.error("[staff] carrier activation failed", error.message);
    return { status: "error", message: "Couldn't update the carrier. Retry." };
  }
  if (!carrier) {
    return { status: "error", message: "Carrier is already in that state." };
  }

  await recordAuditEvent({
    actorId: session.userId,
    action: makeActive ? "carrier.activate" : "carrier.deactivate",
    targetTable: "carriers",
    targetId: carrier.id,
    detail: { company_name: carrier.company_name },
  });

  if (makeActive) {
    const recipient = await getCarrierOwnerRecipient(admin, carrier.id);
    if (recipient) {
      const email = buildCarrierApprovedEmail(recipient.locale, {
        companyName: carrier.company_name,
      });
      await notifyCustomer({
        recipient,
        kind: "carrier_approved",
        title: email.subject,
        href: "/portal/carrier",
        email,
      });
    }
  }

  return { status: "success" };
}

/* ---------------- Dispatcher ↔ carrier assignment ---------------- */

export async function assignDispatcher(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = assignDispatcherSchema.safeParse({
    carrier_id: field(formData, "carrier_id"),
    dispatcher_id: field(formData, "dispatcher_id"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const session = await adminSession();
  if (!session) return { status: "error", message: NOT_ADMIN };

  if (parsed.data.dispatcher_id) {
    const { data: dispatcher } = await session.supabase
      .from("profiles")
      .select("id, role")
      .eq("id", parsed.data.dispatcher_id)
      .maybeSingle();
    if (!dispatcher || (dispatcher.role !== "dispatcher" && dispatcher.role !== "admin")) {
      return { status: "error", message: "Pick a staff dispatcher." };
    }
  }

  // Cookie-bound: "staff manage carriers" RLS re-checks the role.
  const { error } = await session.supabase
    .from("carriers")
    .update({ assigned_dispatcher_id: parsed.data.dispatcher_id })
    .eq("id", parsed.data.carrier_id);
  if (error) {
    console.error("[staff] dispatcher assign failed", error.message);
    return { status: "error", message: "Couldn't save the assignment. Retry." };
  }

  await recordAuditEvent({
    actorId: session.userId,
    action: "carrier.assign_dispatcher",
    targetTable: "carriers",
    targetId: parsed.data.carrier_id,
    detail: { dispatcher_id: parsed.data.dispatcher_id },
  });
  return { status: "success" };
}

/* ---------------- Staff invites (S-04 in-app) ---------------- */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createStaffInvite(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = staffInviteSchema.safeParse({
    email: field(formData, "email"),
    role: field(formData, "role"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const session = await adminSession();
  if (!session) return { status: "error", message: NOT_ADMIN };
  const admin = tryCreateAdminClient();
  if (!admin) return { status: "error", message: NO_ENV };

  // Raw token exists only in the email; DB stores the hash.
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  const { error } = await admin.from("staff_invites").insert({
    email: parsed.data.email,
    role: parsed.data.role,
    token_hash: tokenHash,
    invited_by: session.userId,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("[staff] invite insert failed", error.message);
    return { status: "error", message: "Couldn't create the invite. Retry." };
  }

  const origin = await requestOrigin();
  await sendEmail({
    to: parsed.data.email,
    subject: "You're invited to the PickLoads dispatch desk",
    template: "staff-invite",
    react: StaffInviteEmail({
      inviteUrl: `${origin}/invite/${token}`,
      role: parsed.data.role,
      invitedByName: session.fullName,
      expiresAt,
    }),
  });

  await recordAuditEvent({
    actorId: session.userId,
    action: "staff.invite",
    targetTable: "staff_invites",
    detail: { email: parsed.data.email, role: parsed.data.role },
  });
  return { status: "success" };
}

/** Public accept action — the tokenized link is the credential. */
export async function acceptStaffInvite(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = acceptInviteSchema.safeParse({
    token: field(formData, "token"),
    full_name: field(formData, "full_name"),
    password: field(formData, "password"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }

  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  if (!(await checkRateLimit("invite-accept", ip, 5))) {
    return {
      status: "error",
      message: "Too many attempts from your network. Wait a few minutes.",
    };
  }

  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      status: "error",
      message:
        "This environment isn't connected to the account service — no account was created. Contact your admin.",
    };
  }

  const tokenHash = createHash("sha256")
    .update(parsed.data.token)
    .digest("hex");
  const { data: invite } = await admin
    .from("staff_invites")
    .select("id, email, role, expires_at, accepted_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  const INVALID = "This invite link is invalid, expired, or already used.";
  if (!invite || invite.accepted_at !== null) {
    return { status: "error", message: INVALID };
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return { status: "error", message: INVALID };
  }

  // The invite email received the single-use link — that proves inbox
  // control, so the account is created confirmed (documented judgment; the
  // public /create-account flows stay never-auto-confirmed).
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email: invite.email,
      password: parsed.data.password,
      email_confirm: true,
      user_metadata: { full_name: parsed.data.full_name },
    });
  if (createError) {
    const exists = /already|registered|exists/i.test(createError.message);
    return {
      status: "error",
      message: exists
        ? "An account with this email already exists — ask your admin to promote it instead."
        : "Couldn't create the account. Retry, or contact your admin.",
    };
  }

  // Server-side role assignment (the only path to a staff role, S-04).
  const { error: roleError } = await admin
    .from("profiles")
    .update({ role: invite.role, full_name: parsed.data.full_name })
    .eq("id", created.user.id);
  if (roleError) {
    console.error("[staff] role assignment failed", roleError.message);
    return { status: "error", message: "Account created but role assignment failed — contact your admin." };
  }

  const { error: usedError } = await admin
    .from("staff_invites")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id);
  if (usedError) {
    console.error("[staff] invite consume failed", usedError.message);
  }

  // M-69/P-4: `ip` is no longer passed explicitly — recordAuditEvent()
  // derives it from the same x-forwarded-for/x-real-ip headers in the same
  // request, so the stored value is unchanged.
  await recordAuditEvent({
    actorId: created.user.id,
    action: "staff.invite_accepted",
    targetTable: "staff_invites",
    targetId: invite.id,
    detail: { role: invite.role },
  });

  await sendEmail({
    to: EMAIL_INTERNAL_TO,
    subject: `Staff invite accepted — ${invite.email} (${invite.role})`,
    template: "staff-invite-accepted",
    react: InternalNotification({
      eyebrow: "Staff",
      title: "Staff invite accepted",
      preview: `${invite.email} joined as ${invite.role}`,
      rows: [
        { label: "Email", value: invite.email },
        { label: "Role", value: invite.role },
        { label: "Name", value: parsed.data.full_name },
      ],
    }),
  });

  return { status: "success" };
}
