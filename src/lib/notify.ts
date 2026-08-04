import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/send";
import { resolveEmailLocale, type EmailLocale } from "@/emails/i18n";
import type { BuiltEmail } from "@/emails/i18n";

/**
 * M-60 — customer notification fan-out. One call = in-portal notification
 * row + localized email + email_log journal (inside sendEmail). Everything
 * is best-effort: a notification failure never fails the calling action
 * (the business write is already committed) — it logs loudly instead.
 */

type AdminClient = SupabaseClient<Database>;

export interface Recipient {
  profileId: string;
  email: string | null;
  locale: EmailLocale;
  fullName: string | null;
}

/**
 * Resolve a profile into an email recipient: address from the auth admin
 * API (auth.users is the source of truth — profiles carries no email),
 * language from profiles.preferred_language.
 */
export async function getRecipientByProfile(
  admin: AdminClient,
  profileId: string,
): Promise<Recipient | null> {
  const [{ data: authUser }, { data: profile }] = await Promise.all([
    admin.auth.admin.getUserById(profileId),
    admin
      .from("profiles")
      .select("preferred_language, full_name")
      .eq("id", profileId)
      .maybeSingle(),
  ]);
  if (!authUser?.user) return null;
  return {
    profileId,
    email: authUser.user.email ?? null,
    locale: resolveEmailLocale(profile?.preferred_language),
    fullName: profile?.full_name ?? null,
  };
}

/**
 * Owner profile of a carrier (M-57 doctrine: owner membership first,
 * `carriers.profile_id` as the legacy fallback for pre-membership rows).
 */
export async function getCarrierOwnerRecipient(
  admin: AdminClient,
  carrierId: string,
): Promise<Recipient | null> {
  const { data: membership } = await admin
    .from("carrier_memberships")
    .select("profile_id")
    .eq("carrier_id", carrierId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  let profileId = membership?.profile_id ?? null;
  if (!profileId) {
    const { data: carrier } = await admin
      .from("carriers")
      .select("profile_id")
      .eq("id", carrierId)
      .maybeSingle();
    profileId = carrier?.profile_id ?? null;
  }
  if (!profileId) return null;
  return getRecipientByProfile(admin, profileId);
}

/** Owner profile of a shipper (membership model only — no legacy column). */
export async function getShipperOwnerRecipient(
  admin: AdminClient,
  shipperId: string,
): Promise<Recipient | null> {
  const { data: membership } = await admin
    .from("shipper_memberships")
    .select("profile_id")
    .eq("shipper_id", shipperId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!membership?.profile_id) return null;
  return getRecipientByProfile(admin, membership.profile_id);
}

export interface NotifyArgs {
  recipient: Recipient;
  /** notifications.kind, e.g. "document_reviewed". */
  kind: string;
  /** Localized notification title/body for the portal feed. */
  title: string;
  body?: string | null;
  /** Portal path for the feed row, e.g. "/portal/carrier/documents". */
  href?: string | null;
  /** Localized email (from src/emails/customer-templates). Omit = feed only. */
  email?: BuiltEmail | null;
  leadId?: string;
  quoteId?: string;
}

/** Write the portal notification row, then send the email. Best-effort. */
export async function notifyCustomer(args: NotifyArgs): Promise<void> {
  const admin = tryCreateAdminClient();
  if (admin) {
    const { error } = await admin.from("notifications").insert({
      profile_id: args.recipient.profileId,
      kind: args.kind,
      title: args.title,
      body: args.body ?? null,
      href: args.href ?? null,
    });
    if (error) {
      console.error("[notify] notification insert failed", error.message);
    }
  } else {
    console.warn("[notify] no service key — notification row skipped");
  }

  if (args.email && args.recipient.email) {
    await sendEmail({
      to: args.recipient.email,
      subject: args.email.subject,
      template: args.email.template,
      react: args.email.react,
      ...(args.leadId ? { leadId: args.leadId } : {}),
      ...(args.quoteId ? { quoteId: args.quoteId } : {}),
    });
  }
}
