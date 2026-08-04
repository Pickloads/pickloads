"use server";

import { headers } from "next/headers";
import { getPathname } from "@/i18n/navigation";
import {
  field,
  guardPublicForm,
  SERVER_ERROR_MESSAGE,
} from "@/lib/forms/guard";
import {
  createCarrierAccountSchema,
  createShipperAccountSchema,
} from "@/lib/validation/account";
import { firstIssueMessage } from "@/lib/validation/shared";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { EMAIL_INTERNAL_TO, sendEmail } from "@/lib/email/send";
import { AccountSignupEmail } from "@/emails/AccountSignupEmail";
import type {
  CarrierSignupNext,
  SignupState,
} from "@/lib/account-state";
import type { AuthorityStatus } from "@/lib/validation/account";

/**
 * M-52 — public /create-account server actions.
 *
 * Guard stack is identical to every public write (Q3): rate limit →
 * Turnstile → Zod → service-role for related rows. The auth user itself is
 * created through the cookie-bound ANON client's signUp — the one legitimate
 * anon surface (Q3) — so Supabase sends its own email-verification link and
 * public signups are NEVER auto-confirmed (audit §6.4; the auto-confirm
 * judgment call was scoped to the in-flow onboarding wizard only).
 *
 * Roles are never client-assignable (audit §6.5): this action contains no
 * role input — the signup trigger defaults the profile to 'carrier'.
 */

const DUPLICATE_MESSAGE =
  "An account with this email already exists. Sign in instead, or use another email.";

/** Directive M-52 authority-status routing table. */
const AUTHORITY_ROUTING: Record<
  AuthorityStatus,
  {
    next: CarrierSignupNext;
    leadType: "dispatch" | "new_authority";
    tag: string;
    routingLabel: string;
  }
> = {
  active: {
    next: "onboarding",
    leadType: "dispatch",
    tag: "authority-active",
    routingLabel: "MC active → continue to onboarding wizard",
  },
  pending: {
    next: "pending",
    leadType: "dispatch",
    tag: "authority-pending",
    routingLabel: "MC application pending → account pending staff verification",
  },
  none: {
    next: "new_authority",
    leadType: "new_authority",
    tag: "new-authority",
    routingLabel: "No authority yet → new-authority funnel (full account)",
  },
  leased_on: {
    next: "review",
    leadType: "dispatch",
    tag: "leased-on-review",
    routingLabel: "Leased-on → MANUAL REVIEW (account_status_history flag)",
  },
};

async function requestMeta(): Promise<{ ip: string; origin: string }> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${proto}://${host}` : "https://pickloads.com";
  return { ip, origin };
}

export async function createCarrierAccount(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const guard = await guardPublicForm("create-account", formData);
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = createCarrierAccountSchema.safeParse({
    company_name: field(formData, "company_name"),
    full_name: field(formData, "full_name"),
    email: field(formData, "email"),
    phone: field(formData, "phone"),
    authority_status: field(formData, "authority_status"),
    mc_number: field(formData, "mc_number"),
    dot_number: field(formData, "dot_number"),
    home_state: field(formData, "home_state"),
    password: field(formData, "password"),
    locale: field(formData, "locale"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const input = parsed.data;
  const routing = AUTHORITY_ROUTING[input.authority_status];

  const admin = tryCreateAdminClient();
  if (!admin) {
    // Honest no-env state (audit §6.4): nothing was created, and the UI says
    // so — no fake "check your email".
    return {
      status: "success",
      verification: "unconfigured",
      next: routing.next,
    };
  }

  const { ip, origin } = await requestMeta();

  let userId: string;
  let verification: "sent" | "none";
  try {
    const supabase = await createClient();
    const loginPath = getPathname({ href: "/login", locale: input.locale });
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        emailRedirectTo: `${origin}${loginPath}?verified=1`,
        data: {
          full_name: input.full_name,
          preferred_language: input.locale,
        },
      },
    });
    if (error) {
      const exists = /already|registered|exists/i.test(error.message);
      return {
        status: "error",
        message: exists ? DUPLICATE_MESSAGE : SERVER_ERROR_MESSAGE,
      };
    }
    // Supabase anti-enumeration: an existing email returns a stub user with
    // no identities instead of an error.
    if (!data.user || (data.user.identities ?? []).length === 0) {
      return { status: "error", message: DUPLICATE_MESSAGE };
    }
    userId = data.user.id;
    verification = data.session ? "none" : "sent";
  } catch (err) {
    console.error("[account] carrier signUp failed", err);
    return { status: "error", message: SERVER_ERROR_MESSAGE };
  }

  try {
    // Profile row exists via on_auth_user_created; enrich it. Pending/review
    // branches park the account as 'pending' with a journaled reason.
    const pendingReason =
      input.authority_status === "pending"
        ? "MC authority application pending — staff verify before activation."
        : input.authority_status === "leased_on"
          ? "Leased-on carrier (operating under another authority) — manual review required."
          : null;

    const { error: profileError } = await admin
      .from("profiles")
      .update({
        phone: input.phone,
        company_name: input.company_name,
        ...(pendingReason ? { status: "pending" as const } : {}),
      })
      .eq("id", userId);
    if (profileError) throw new Error(profileError.message);

    if (pendingReason) {
      const { error } = await admin.from("account_status_history").insert({
        profile_id: userId,
        old_status: "active",
        new_status: "pending",
        reason: pendingReason,
      });
      if (error) console.error("[account] status history failed", error.message);
    }

    const { data: carrier, error: carrierError } = await admin
      .from("carriers")
      .insert({
        profile_id: userId,
        company_name: input.company_name,
        mc_number: input.mc_number,
        dot_number: input.dot_number,
        home_state: input.home_state,
        active: false,
      })
      .select("id")
      .single();
    if (carrierError) throw new Error(carrierError.message);

    const { error: membershipError } = await admin
      .from("carrier_memberships")
      .insert({ carrier_id: carrier.id, profile_id: userId, role: "owner" });
    if (membershipError) throw new Error(membershipError.message);

    // CRM visibility + directive funnel tagging.
    const { error: leadError } = await admin.from("carrier_leads").insert({
      lead_type: routing.leadType,
      full_name: input.full_name,
      email: input.email,
      phone: input.phone,
      mc_number: input.mc_number,
      home_state: input.home_state,
      source: "create_account",
      locale: input.locale,
      tags: [routing.tag],
      ...(input.authority_status === "leased_on"
        ? { priority: "high" as const }
        : {}),
    });
    if (leadError) console.error("[account] lead insert failed", leadError.message);

    const { error: auditError } = await admin.from("audit_events").insert({
      action: "account.signup",
      target_table: "profiles",
      target_id: userId,
      detail: {
        kind: "carrier",
        authority_status: input.authority_status,
        routed: routing.next,
      },
      ip: ip !== "unknown" ? ip : null,
    });
    if (auditError) console.error("[account] audit insert failed", auditError.message);
  } catch (err) {
    console.error("[account] carrier signup post-processing failed", err);
    return { status: "error", message: SERVER_ERROR_MESSAGE };
  }

  await sendEmail({
    to: EMAIL_INTERNAL_TO,
    subject: `Carrier account created — ${input.company_name}`,
    template: "account-signup-carrier",
    react: (
      <AccountSignupEmail
        kind="carrier"
        companyName={input.company_name}
        fullName={input.full_name}
        email={input.email}
        phone={input.phone}
        routing={AUTHORITY_ROUTING[input.authority_status].routingLabel}
        {...(input.mc_number ? { detail: `MC ${input.mc_number}` } : {})}
      />
    ),
  });

  return { status: "success", verification, next: routing.next };
}

/**
 * M-53 — shipper registration (directive fields: industry / frequency /
 * regions). Same guard stack and never-auto-confirmed signUp as the carrier
 * branch. The role promotion to 'shipper' happens strictly server-side via
 * the service role (audit §6.5 — `guard_role_change` blocks client sessions).
 * Historical quotes are NOT linked here: claiming happens post-verification
 * in the shipper portal against the Supabase-verified session email only
 * (audit §6.3 — signup input must never re-link another address's quotes).
 */
export async function createShipperAccount(
  _prev: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const guard = await guardPublicForm("create-account", formData);
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = createShipperAccountSchema.safeParse({
    company_name: field(formData, "company_name"),
    full_name: field(formData, "full_name"),
    email: field(formData, "email"),
    phone: field(formData, "phone"),
    industry: field(formData, "industry"),
    shipping_frequency: field(formData, "shipping_frequency"),
    regions: field(formData, "regions"),
    password: field(formData, "password"),
    locale: field(formData, "locale"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const input = parsed.data;

  const admin = tryCreateAdminClient();
  if (!admin) {
    return { status: "success", verification: "unconfigured" };
  }

  const { ip, origin } = await requestMeta();

  let userId: string;
  let verification: "sent" | "none";
  try {
    const supabase = await createClient();
    const loginPath = getPathname({ href: "/login", locale: input.locale });
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        emailRedirectTo: `${origin}${loginPath}?verified=1`,
        data: {
          full_name: input.full_name,
          preferred_language: input.locale,
        },
      },
    });
    if (error) {
      const exists = /already|registered|exists/i.test(error.message);
      return {
        status: "error",
        message: exists ? DUPLICATE_MESSAGE : SERVER_ERROR_MESSAGE,
      };
    }
    if (!data.user || (data.user.identities ?? []).length === 0) {
      return { status: "error", message: DUPLICATE_MESSAGE };
    }
    userId = data.user.id;
    verification = data.session ? "none" : "sent";
  } catch (err) {
    console.error("[account] shipper signUp failed", err);
    return { status: "error", message: SERVER_ERROR_MESSAGE };
  }

  try {
    // Server-side role assignment — the only path to a shipper role.
    const { error: profileError } = await admin
      .from("profiles")
      .update({
        role: "shipper",
        phone: input.phone,
        company_name: input.company_name,
      })
      .eq("id", userId);
    if (profileError) throw new Error(profileError.message);

    const { data: shipper, error: shipperError } = await admin
      .from("shippers")
      .insert({
        company_name: input.company_name,
        industry: input.industry,
        shipping_frequency: input.shipping_frequency,
        regions: input.regions.length > 0 ? input.regions : null,
        phone: input.phone,
        billing_email: input.email,
      })
      .select("id")
      .single();
    if (shipperError) throw new Error(shipperError.message);

    const { error: membershipError } = await admin
      .from("shipper_memberships")
      .insert({ shipper_id: shipper.id, profile_id: userId, role: "owner" });
    if (membershipError) throw new Error(membershipError.message);

    const { error: auditError } = await admin.from("audit_events").insert({
      action: "account.signup",
      target_table: "profiles",
      target_id: userId,
      detail: {
        kind: "shipper",
        industry: input.industry,
        shipping_frequency: input.shipping_frequency,
      },
      ip: ip !== "unknown" ? ip : null,
    });
    if (auditError) console.error("[account] audit insert failed", auditError.message);
  } catch (err) {
    console.error("[account] shipper signup post-processing failed", err);
    return { status: "error", message: SERVER_ERROR_MESSAGE };
  }

  const details = [
    input.industry ? `Industry: ${input.industry}` : null,
    input.shipping_frequency ? `Frequency: ${input.shipping_frequency}` : null,
    input.regions.length > 0 ? `Regions: ${input.regions.join(", ")}` : null,
  ].filter((d): d is string => d !== null);

  await sendEmail({
    to: EMAIL_INTERNAL_TO,
    subject: `Shipper account created — ${input.company_name}`,
    template: "account-signup-shipper",
    react: (
      <AccountSignupEmail
        kind="shipper"
        companyName={input.company_name}
        fullName={input.full_name}
        email={input.email}
        phone={input.phone}
        routing="Shipper self-signup (D1) → shipper portal after email verification"
        {...(details.length > 0 ? { detail: details.join(" · ") } : {})}
      />
    ),
  });

  return { status: "success", verification };
}
