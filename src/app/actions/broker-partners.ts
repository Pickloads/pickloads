"use server";

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { field } from "@/lib/forms/guard";
import { firstIssueMessage } from "@/lib/validation/shared";
import { recordAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/email/send";
import { BrokerInviteEmail } from "@/emails/BrokerInviteEmail";
import {
  resolveShipmentAccess,
  resolveStaffActor,
} from "@/lib/shipments/staff-access";
import {
  BROKER_INVITE_TTL_MS,
  acceptBrokerInviteSchema,
  brokerAgreementSchema,
  brokerInviteSchema,
  brokerPartnerSchema,
  grantBrokerShipmentSchema,
  revokeBrokerAgreementSchema,
  revokeBrokerInviteSchema,
  revokeBrokerShipmentSchema,
  verifyBrokerPartnerSchema,
} from "@/lib/validation/broker";
import type { FormState } from "@/lib/form-state";

/**
 * M-81 — the §12 broker-partner actions.
 *
 * ── THE FIVE RULES EVERY ACTION IN THIS FILE FOLLOWS ─────────────────────
 *
 *   1. **Admin gate, re-read from the session, before anything.** A server
 *      action is a public HTTP endpoint; the page that rendered its form is
 *      not a control. `adminOnly()` re-reads the profile through the
 *      COOKIE-BOUND client every time. The two per-shipment grant actions use
 *      `resolveShipmentAccess` instead, so a DISPATCHER may share a shipment
 *      they operate — §14 is dispatch's job — while everything that decides
 *      WHO a partner IS (creation, verification, invitation, account
 *      agreements) stays admin-only, which is §12's *"invited by an admin"*
 *      read literally.
 *   2. **Zod before any write**, and the schemas in
 *      `validation/broker.ts` have no `role`, no `verification_status` and no
 *      `active` field. §3's *"no public self-registration"* is a property of
 *      the schema, not a check somebody remembered to write.
 *   3. **Verification goes through `verify_broker_partner()`**, never a raw
 *      UPDATE, so the status and the `verified_by`/`verified_at` stamp move
 *      together and a verified organization with no name against it is
 *      unrepresentable.
 *   4. **Audit through the single writer.** `recordAuditEvent` only (M-69/P-4
 *      forbids anything else by lint rule). Every state change §12 cares
 *      about — invite, accept, verify, grant, revoke, agreement — writes one.
 *   5. **Refusals are values, never redirects.** These are actions, so a
 *      refusal has to be something the form can render into its
 *      `role="alert"` region.
 *
 * ── THE ACCEPT ACTION IS THE ONLY PUBLIC EXPORT ─────────────────────────
 *
 * `acceptBrokerInviteAction` runs unauthenticated, because the person
 * accepting has no account yet. It is rate-limited by IP on M-58's bucket
 * pattern, and it is the ONLY path in the product that can produce a profile
 * with `role = 'broker'`. `tests/unit/shipment-broker-permissions.test.ts`
 * enumerates the public signup schemas and asserts none of them can.
 */

const NOT_ADMIN = "Only admins can manage broker partners.";
const NO_ENV =
  "Service credentials aren't configured in this environment — nothing was changed.";
const INVALID_INVITE = "This invite link is invalid, expired, or already used.";

function ok(message?: string): FormState {
  // Conditional spread, not `message: message` — `exactOptionalPropertyTypes`
  // distinguishes "absent" from "present and undefined", and `FormState.message`
  // is optional rather than nullable.
  return message === undefined
    ? { status: "success" }
    : { status: "success", message };
}
function fail(message: string): FormState {
  return { status: "error", message };
}

type AdminSession = { userId: string; fullName: string | null };

async function adminOnly(): Promise<AdminSession | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status, full_name")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "admin" || profile.status === "suspended") {
    return null;
  }
  return { userId: user.id, fullName: profile.full_name };
}

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "https://pickloads.com";
}

/* ================================================================== *
 * 1 · The organization (§12 "attached to a broker organization")
 * ================================================================== */

/**
 * Create a broker organization.
 *
 * It is born DARK: 0017 defaults `active` to false and 0029 defaults
 * `verification_status` to `'pending'`, and this action sets neither. An
 * organization that exists is not an organization that can read anything —
 * verification is a second, deliberate act by a human who looked at the
 * vetting fields.
 */
export async function createBrokerPartnerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await adminOnly();
  if (!session) return fail(NOT_ADMIN);

  const parsed = brokerPartnerSchema.safeParse({
    company_name: field(formData, "company_name"),
    mc_number: field(formData, "mc_number"),
    dot_number: field(formData, "dot_number"),
    contact_name: field(formData, "contact_name"),
    contact_email: field(formData, "contact_email"),
    contact_phone: field(formData, "contact_phone"),
    bond_provider: field(formData, "bond_provider"),
    bond_amount_usd: field(formData, "bond_amount_usd"),
    authority_since: field(formData, "authority_since"),
    days_to_pay: field(formData, "days_to_pay"),
    notes: field(formData, "notes"),
  });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));

  const admin = tryCreateAdminClient();
  if (!admin) return fail(NO_ENV);

  const { data, error } = await admin
    .from("broker_partners")
    .insert({ ...parsed.data })
    .select("id")
    .maybeSingle();
  if (error || !data) {
    console.error("[broker] partner insert failed", error?.message);
    return fail("Couldn't create the partner organization. Retry.");
  }

  await recordAuditEvent({
    actorId: session.userId,
    action: "broker.partner_create",
    targetTable: "broker_partners",
    targetId: data.id,
    detail: {
      company_name: parsed.data.company_name,
      mc_number: parsed.data.mc_number,
      // Stated so the ledger records that it was born dark, rather than
      // leaving a reader to infer it from the absence of a verify event.
      verification_status: "pending",
      active: false,
    },
  });
  return ok("Partner created. It is unverified and reads nothing until you verify it.");
}

/**
 * §12's verification act.
 *
 * The audit event is not optional decoration — §12 requires brokers to be
 * *"verified"*, and a verification with no record of who did it and when is
 * indistinguishable from a row somebody edited in the SQL console.
 */
export async function verifyBrokerPartnerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await adminOnly();
  if (!session) return fail(NOT_ADMIN);

  const parsed = verifyBrokerPartnerSchema.safeParse({
    broker_partner_id: field(formData, "broker_partner_id"),
    verified: field(formData, "verified"),
    note: field(formData, "note"),
  });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));

  const admin = tryCreateAdminClient();
  if (!admin) return fail(NO_ENV);

  const { data, error } = await admin.rpc("verify_broker_partner", {
    p_broker_partner_id: parsed.data.broker_partner_id,
    p_actor_id: session.userId,
    p_verified: parsed.data.verified,
    p_note: parsed.data.note,
  });
  if (error) {
    console.error("[broker] verify failed", error.message);
    return fail(
      error.code === "PL404"
        ? "That partner organization no longer exists."
        : "Couldn't record the verification. Retry.",
    );
  }

  const result = (data ?? {}) as { old_status?: string; new_status?: string };
  await recordAuditEvent({
    actorId: session.userId,
    action: parsed.data.verified ? "broker.verify" : "broker.suspend",
    targetTable: "broker_partners",
    targetId: parsed.data.broker_partner_id,
    detail: {
      old_status: result.old_status ?? null,
      new_status: result.new_status ?? null,
      note: parsed.data.note,
    },
  });
  return ok(
    parsed.data.verified
      ? "Verified. The partner's users can now read the shipments you share."
      : "Suspended. Every user of this partner now reads nothing, immediately.",
  );
}

/* ================================================================== *
 * 2 · Invitations (§12 "invited by an admin")
 * ================================================================== */

export async function createBrokerInviteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await adminOnly();
  if (!session) return fail(NOT_ADMIN);

  const parsed = brokerInviteSchema.safeParse({
    broker_partner_id: field(formData, "broker_partner_id"),
    email: field(formData, "email"),
    membership_role: field(formData, "membership_role") || "owner",
  });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));

  const admin = tryCreateAdminClient();
  if (!admin) return fail(NO_ENV);

  const { data: partner } = await admin
    .from("broker_partners")
    .select("id, company_name")
    .eq("id", parsed.data.broker_partner_id)
    .maybeSingle();
  if (!partner) return fail("That partner organization no longer exists.");

  // M-58's idiom exactly: the raw token exists ONCE, inside the email; the
  // database stores only its SHA-256 hash, so a database read cannot mint a
  // working link.
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + BROKER_INVITE_TTL_MS).toISOString();

  const { data: invite, error } = await admin
    .from("broker_partner_invites")
    .insert({
      broker_partner_id: parsed.data.broker_partner_id,
      email: parsed.data.email,
      membership_role: parsed.data.membership_role,
      token_hash: tokenHash,
      invited_by: session.userId,
      expires_at: expiresAt,
    })
    .select("id")
    .maybeSingle();
  if (error || !invite) {
    console.error("[broker] invite insert failed", error?.message);
    return fail("Couldn't create the invite. Retry.");
  }

  const origin = await requestOrigin();
  await sendEmail({
    to: parsed.data.email,
    subject: "You're invited to the PickLoads partner portal",
    template: "broker-invite",
    react: BrokerInviteEmail({
      inviteUrl: `${origin}/broker-invite/${token}`,
      companyName: partner.company_name,
      invitedByName: session.fullName,
      expiresAt,
    }),
  });

  await recordAuditEvent({
    actorId: session.userId,
    action: "broker.invite",
    targetTable: "broker_partner_invites",
    targetId: invite.id,
    // Never the token or its hash (M-61's contract: identifiers and
    // decisions, never credentials).
    detail: {
      email: parsed.data.email,
      broker_partner_id: parsed.data.broker_partner_id,
      membership_role: parsed.data.membership_role,
    },
  });
  return ok("Invite sent. The link is single-use and expires in seven days.");
}

export async function revokeBrokerInviteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await adminOnly();
  if (!session) return fail(NOT_ADMIN);

  const parsed = revokeBrokerInviteSchema.safeParse({
    invite_id: field(formData, "invite_id"),
  });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));

  const admin = tryCreateAdminClient();
  if (!admin) return fail(NO_ENV);

  // `.is("accepted_at", null)` is the race guard: an invite accepted between
  // the page render and this click must NOT be marked revoked, because the
  // 0029 CHECK forbids a row holding both outcomes and because the account
  // already exists — cancelling it there is an account action, not this one.
  const { data, error } = await admin
    .from("broker_partner_invites")
    .update({ revoked_at: new Date().toISOString(), revoked_by: session.userId })
    .eq("id", parsed.data.invite_id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[broker] invite revoke failed", error.message);
    return fail("Couldn't cancel the invite. Retry.");
  }
  if (!data) return fail("That invite was already used or cancelled.");

  await recordAuditEvent({
    actorId: session.userId,
    action: "broker.invite_revoked",
    targetTable: "broker_partner_invites",
    targetId: parsed.data.invite_id,
  });
  return ok("Invite cancelled. The link no longer works.");
}

/**
 * PUBLIC accept action — the tokenized link is the credential.
 *
 * ── WHY THE ROLE IS A LITERAL AND NOT A COLUMN ──────────────────────────
 *
 * `staff_invites.role` is a column because an admin chooses between two staff
 * roles. There is only one broker role, so `broker_partner_invites` has no
 * `role` column at all and the string `'broker'` below is a literal in server
 * code. A value that is never read from anywhere cannot be forged from
 * anywhere — §3's requirement, made structural rather than validated.
 *
 * ── WHAT ACCEPTING DOES NOT DO ──────────────────────────────────────────
 *
 * It does NOT verify the organization, and it does not activate it. §12 lists
 * *"invited by an admin"* and *"verified"* as two requirements, so accepting
 * an invite into an unverified organization produces a working login that
 * reads nothing and says so. That is the honest state, and the alternative —
 * accepting an invite as implicit verification — would make the invitation
 * email the verification act.
 */
export async function acceptBrokerInviteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = acceptBrokerInviteSchema.safeParse({
    token: field(formData, "token"),
    full_name: field(formData, "full_name"),
    password: field(formData, "password"),
  });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));

  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  if (!(await checkRateLimit("broker-invite-accept", ip, 5))) {
    return fail("Too many attempts from your network. Wait a few minutes.");
  }

  const admin = tryCreateAdminClient();
  if (!admin) {
    return fail(
      "This environment isn't connected to the account service — no account was created. Contact your PickLoads admin.",
    );
  }

  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const { data: invite } = await admin
    .from("broker_partner_invites")
    .select("id, broker_partner_id, email, membership_role, expires_at, accepted_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  // ONE indistinguishable refusal for four different failures (M-73's rule):
  // a token that matches nothing, one already used, one cancelled and one
  // expired all say the same thing, so the message is not an oracle.
  if (
    !invite ||
    invite.accepted_at !== null ||
    invite.revoked_at !== null ||
    new Date(invite.expires_at).getTime() < Date.now()
  ) {
    return fail(INVALID_INVITE);
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser(
    {
      email: invite.email,
      password: parsed.data.password,
      // The invite email received the single-use link — that proves inbox
      // control, so the account is created confirmed. M-58's documented
      // judgment, unchanged; the public /create-account flows stay
      // never-auto-confirmed.
      email_confirm: true,
      user_metadata: { full_name: parsed.data.full_name },
    },
  );
  if (createError) {
    const exists = /already|registered|exists/i.test(createError.message);
    return fail(
      exists
        ? "An account with this email already exists — ask your PickLoads admin to add it to the organization instead."
        : "Couldn't create the account. Retry, or contact your PickLoads admin.",
    );
  }

  // Server-side role assignment: the ONLY path to `role = 'broker'`.
  // 0002's `trg_profiles_role_guard` keeps blocking self-promotion for every
  // end-user session; this runs as the service role, which is the point.
  const { error: roleError } = await admin
    .from("profiles")
    .update({ role: "broker", full_name: parsed.data.full_name })
    .eq("id", created.user.id);
  if (roleError) {
    console.error("[broker] role assignment failed", roleError.message);
    return fail(
      "Account created but the partner role wasn't assigned — contact your PickLoads admin.",
    );
  }

  const { error: membershipError } = await admin
    .from("broker_partner_memberships")
    .insert({
      broker_partner_id: invite.broker_partner_id,
      profile_id: created.user.id,
      role: invite.membership_role,
    });
  if (membershipError) {
    console.error("[broker] membership insert failed", membershipError.message);
    return fail(
      "Account created but it wasn't linked to the organization — contact your PickLoads admin.",
    );
  }

  // Single-use, consumed last: if anything above failed the link is still
  // usable, which is the recoverable failure mode.
  const { error: usedError } = await admin
    .from("broker_partner_invites")
    .update({ accepted_at: new Date().toISOString(), accepted_by: created.user.id })
    .eq("id", invite.id);
  if (usedError) {
    console.error("[broker] invite consume failed", usedError.message);
  }

  await recordAuditEvent({
    actorId: created.user.id,
    action: "broker.invite_accepted",
    targetTable: "broker_partner_invites",
    targetId: invite.id,
    detail: { broker_partner_id: invite.broker_partner_id },
  });
  return ok(
    "Your partner account is ready. Sign in to see the shipments PickLoads has shared with your organization.",
  );
}

/* ================================================================== *
 * 3 · §12 grant shape ONE — shipment by shipment
 * ================================================================== */

/**
 * Share ONE shipment with ONE partner organization.
 *
 * Gated by `resolveShipmentAccess` rather than `adminOnly`: §14 makes the
 * dispatcher the operator of a shipment, and sharing a shipment they run is
 * an operational act. The gate applies the §19 dispatcher scope, so a
 * dispatcher cannot share a shipment they could not open.
 *
 * The partner must be VERIFIED. Sharing with an unverified organization would
 * succeed and do nothing (`my_broker_partner_ids()` filters it out), which is
 * the worst kind of outcome: an operator who believes the customer can see the
 * BOL. Refusing loudly is the honest behaviour.
 */
export async function grantBrokerShipmentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await resolveShipmentAccess(field(formData, "shipment_id"));
  if (!access.ok) return fail(access.message);

  const parsed = grantBrokerShipmentSchema.safeParse({
    shipment_id: field(formData, "shipment_id"),
    broker_partner_id: field(formData, "broker_partner_id"),
    note: field(formData, "note"),
  });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));

  const admin = tryCreateAdminClient();
  if (!admin) return fail(NO_ENV);

  const { data: partner } = await admin
    .from("broker_partners")
    .select("id, company_name, verification_status, active")
    .eq("id", parsed.data.broker_partner_id)
    .maybeSingle();
  if (!partner) return fail("That partner organization no longer exists.");
  if (partner.verification_status !== "verified" || !partner.active) {
    return fail(
      `${partner.company_name} is not verified, so sharing would grant nothing. Verify the partner first.`,
    );
  }

  const { data, error } = await admin
    .from("broker_shipment_grants")
    .insert({
      shipment_id: access.shipmentId,
      broker_partner_id: parsed.data.broker_partner_id,
      granted_by: access.session.userId,
      note: parsed.data.note,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    // 23505 = the partial unique index: a LIVE grant already exists. That is
    // not an error the operator caused, so it is not phrased as one.
    if (error.code === "23505") {
      return fail(`${partner.company_name} already has access to this shipment.`);
    }
    console.error("[broker] grant insert failed", error.message);
    return fail("Couldn't share the shipment. Retry.");
  }

  await recordAuditEvent({
    actorId: access.session.userId,
    action: "broker.grant_shipment",
    targetTable: "broker_shipment_grants",
    targetId: data?.id ?? null,
    detail: {
      shipment_id: access.shipmentId,
      tracking_number: access.trackingNumber,
      broker_partner_id: parsed.data.broker_partner_id,
    },
  });
  return ok(`Shared with ${partner.company_name}.`);
}

export async function revokeBrokerShipmentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const access = await resolveShipmentAccess(field(formData, "shipment_id"));
  if (!access.ok) return fail(access.message);

  const parsed = revokeBrokerShipmentSchema.safeParse({
    grant_id: field(formData, "grant_id"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));

  const admin = tryCreateAdminClient();
  if (!admin) return fail(NO_ENV);

  // Scoped to THIS shipment as well as to the grant id: the gate above proved
  // access to one shipment, and a grant id from another one must not ride
  // through on it.
  const { data, error } = await admin
    .from("broker_shipment_grants")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: access.session.userId,
      revoke_reason: parsed.data.reason,
    })
    .eq("id", parsed.data.grant_id)
    .eq("shipment_id", access.shipmentId)
    .is("revoked_at", null)
    .select("id, broker_partner_id")
    .maybeSingle();
  if (error) {
    console.error("[broker] grant revoke failed", error.message);
    return fail("Couldn't revoke the share. Retry.");
  }
  if (!data) return fail("That share was already revoked.");

  await recordAuditEvent({
    actorId: access.session.userId,
    action: "broker.revoke_shipment",
    targetTable: "broker_shipment_grants",
    targetId: data.id,
    detail: {
      shipment_id: access.shipmentId,
      broker_partner_id: data.broker_partner_id,
      reason: parsed.data.reason,
    },
  });
  return ok("Access revoked. The partner can no longer open this shipment.");
}

/* ================================================================== *
 * 4 · §12 grant shape TWO — account agreement
 * ================================================================== */

/**
 * A standing agreement: one partner, one shipper account, one window.
 *
 * Admin-only, unlike the per-shipment grant. An account agreement is a
 * commercial arrangement covering freight that does not exist yet — that is a
 * different kind of decision from sharing today's load, and §12 lists it
 * beside "invited by an admin" rather than beside the dispatcher's duties.
 */
export async function createBrokerAgreementAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await adminOnly();
  if (!session) return fail(NOT_ADMIN);

  const parsed = brokerAgreementSchema.safeParse({
    broker_partner_id: field(formData, "broker_partner_id"),
    shipper_id: field(formData, "shipper_id"),
    agreement_reference: field(formData, "agreement_reference"),
    ends_at: field(formData, "ends_at"),
  });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));

  const admin = tryCreateAdminClient();
  if (!admin) return fail(NO_ENV);

  const { data: partner } = await admin
    .from("broker_partners")
    .select("id, company_name, verification_status, active")
    .eq("id", parsed.data.broker_partner_id)
    .maybeSingle();
  if (!partner) return fail("That partner organization no longer exists.");
  if (partner.verification_status !== "verified" || !partner.active) {
    return fail(
      `${partner.company_name} is not verified, so the agreement would grant nothing. Verify the partner first.`,
    );
  }

  const { data, error } = await admin
    .from("broker_account_agreements")
    .insert({
      broker_partner_id: parsed.data.broker_partner_id,
      shipper_id: parsed.data.shipper_id,
      agreement_reference: parsed.data.agreement_reference,
      // End of the chosen DAY, not its midnight: an agreement dated "through
      // the 30th" that expires at 00:00 on the 30th ends a day early, and
      // that class of off-by-one is a support call about missing freight.
      ends_at:
        parsed.data.ends_at === null
          ? null
          : `${parsed.data.ends_at}T23:59:59.999Z`,
      granted_by: session.userId,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return fail(
        `${partner.company_name} already has a live agreement for that shipper.`,
      );
    }
    console.error("[broker] agreement insert failed", error.message);
    return fail("Couldn't record the agreement. Retry.");
  }

  await recordAuditEvent({
    actorId: session.userId,
    action: "broker.agreement_create",
    targetTable: "broker_account_agreements",
    targetId: data?.id ?? null,
    detail: {
      broker_partner_id: parsed.data.broker_partner_id,
      shipper_id: parsed.data.shipper_id,
      ends_at: parsed.data.ends_at,
      agreement_reference: parsed.data.agreement_reference,
    },
  });
  return ok(
    `${partner.company_name} now sees that shipper's shipments for the agreed window.`,
  );
}

export async function revokeBrokerAgreementAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await adminOnly();
  if (!session) return fail(NOT_ADMIN);

  const parsed = revokeBrokerAgreementSchema.safeParse({
    agreement_id: field(formData, "agreement_id"),
    reason: field(formData, "reason"),
  });
  if (!parsed.success) return fail(firstIssueMessage(parsed.error));

  const admin = tryCreateAdminClient();
  if (!admin) return fail(NO_ENV);

  const { data, error } = await admin
    .from("broker_account_agreements")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: session.userId,
      revoke_reason: parsed.data.reason,
    })
    .eq("id", parsed.data.agreement_id)
    .is("revoked_at", null)
    .select("id, broker_partner_id, shipper_id")
    .maybeSingle();
  if (error) {
    console.error("[broker] agreement revoke failed", error.message);
    return fail("Couldn't revoke the agreement. Retry.");
  }
  if (!data) return fail("That agreement was already revoked.");

  await recordAuditEvent({
    actorId: session.userId,
    action: "broker.agreement_revoke",
    targetTable: "broker_account_agreements",
    targetId: data.id,
    detail: {
      broker_partner_id: data.broker_partner_id,
      shipper_id: data.shipper_id,
      reason: parsed.data.reason,
    },
  });
  return ok("Agreement revoked. Every shipment it covered is closed to the partner.");
}

/* ================================================================== *
 * 5 · Staff reads used by the admin surface
 * ================================================================== */

/**
 * The verified partners a dispatcher may share a shipment with.
 *
 * A read, not a mutation, but it lives here because it is service-role gated
 * for the same reason the writes are: `broker_partners` has no policy that
 * lets a DISPATCHER list every organization, only `is_staff()`. Using the
 * cookie-bound client would work today and break the moment §19's dispatcher
 * scoping becomes a restrictive policy (M-83), so the gate is explicit.
 */
export async function listVerifiedBrokerPartners(): Promise<
  { id: string; company_name: string }[]
> {
  const actor = await resolveStaffActor();
  if (!actor.ok) return [];
  const admin = tryCreateAdminClient();
  if (!admin) return [];
  const { data, error } = await admin
    .from("broker_partners")
    .select("id, company_name")
    .eq("active", true)
    .eq("verification_status", "verified")
    .order("company_name", { ascending: true })
    .limit(200);
  if (error) {
    console.error("[broker] partner list failed", error.message);
    return [];
  }
  return data ?? [];
}
