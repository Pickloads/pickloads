import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { maskEmail } from "@/lib/newsletter-unsubscribe";
import {
  normalizeSuppressionEmail,
  type NotificationPreferences,
} from "@/lib/shipments/notification-rules";

/**
 * M-79 — §17's *"respect user preferences"*, and the honest opt-out behind it.
 *
 * ── THE PRECEDENT THIS FOLLOWS ────────────────────────────────────────────
 *
 * M-69/P-1 built the newsletter opt-out and argued its semantics at length:
 * idempotent, never a GET side effect, token-only in the URL, honest when the
 * service key is missing. Every one of those arguments applies unchanged to a
 * shipment-notification opt-out, so the semantics are reused verbatim rather
 * than re-derived — including `maskEmail`, imported from that module instead
 * of copied.
 *
 * What is DIFFERENT, and deliberately so:
 *
 *   * TWO writes, not one. The preference boolean stops mail to the ACCOUNT;
 *     the `notification_suppressions` row stops mail to the ADDRESS. A shared
 *     receiving mailbox (`dock@acme.com`) that lands on a shipper's profile
 *     needs the second, and a customer who changes their account address needs
 *     the first. Opting out writes both; the worker refuses on either.
 *   * NO `List-Unsubscribe` header. `src/lib/email/send.ts` restricts the
 *     RFC 8058 pair to MARKETING-class sends (M-69's own rule) and shipment
 *     notifications are transactional mail about freight the recipient is
 *     paying for. The opt-out is a visible link in every one of the eleven
 *     templates instead — reachable without a login, and reachable from the
 *     message that prompted the wish to stop.
 */

type AdminClient = SupabaseClient<Database>;

/* ------------------------------------------------------------------ *
 * Reads used by the worker
 * ------------------------------------------------------------------ */

/**
 * The two booleans plus the opt-out token for one profile.
 *
 * A MISSING ROW is not an error and not a refusal: it means the account never
 * opened its preferences, and `allowsChannel` resolves that to "receive".
 * 0026's enqueue function creates the row, so in practice a queued
 * notification always has one — this stays total anyway, because a helper that
 * throws on a missing preference row would turn a cosmetic gap into a silent
 * outage.
 */
export async function readNotificationPreferences(
  admin: AdminClient,
  profileId: string,
): Promise<{ prefs: NotificationPreferences; token: string | null }> {
  const { data } = await admin
    .from("user_preferences")
    .select("email_shipment_updates, inapp_shipment_updates, notification_token")
    .eq("profile_id", profileId)
    .maybeSingle();
  return {
    prefs: {
      emailShipmentUpdates: data?.email_shipment_updates ?? null,
      inappShipmentUpdates: data?.inapp_shipment_updates ?? null,
    },
    token: data?.notification_token ?? null,
  };
}

/**
 * Is this ADDRESS opted out of shipment notifications?
 *
 * Fails CLOSED on an unreadable table: an error here returns `true`
 * (suppressed), because the failure mode of a false negative is mailing
 * somebody who asked us not to, and the failure mode of a false positive is a
 * retry. Those are not equally bad.
 */
export async function isAddressSuppressed(
  admin: AdminClient,
  email: string,
): Promise<boolean> {
  const normalized = normalizeSuppressionEmail(email);
  if (normalized === "") return true;
  const { data, error } = await admin
    .from("notification_suppressions")
    .select("email")
    .eq("email", normalized)
    .eq("scope", "shipment")
    .maybeSingle();
  if (error) {
    console.error("[notify] suppression lookup failed", error.message);
    return true;
  }
  return data !== null;
}

/* ------------------------------------------------------------------ *
 * The tokenized opt-out surface
 * ------------------------------------------------------------------ */

export interface OptOutLookup {
  /** Masked for display; the full address is never rendered from a token. */
  maskedEmail: string;
  alreadyOptedOut: boolean;
}

export type OptOutOutcome =
  | "opted_out"
  | "already"
  | "invalid"
  | "unavailable";

/** True when the outcome means "this address will not be mailed". */
export function isOptOutSuccess(outcome: OptOutOutcome): boolean {
  return outcome === "opted_out" || outcome === "already";
}

/** UUID shape only — a token that cannot be a token is refused before a query. */
export function normalizeNotificationToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
    value,
  )
    ? value
    : null;
}

/**
 * READ-ONLY. Safe to call from a GET render, which is what makes the
 * "corporate link scanner prefetches every URL in the email" case harmless —
 * the same reasoning M-69 documented for the newsletter.
 */
export async function lookupNotificationOptOut(
  rawToken: unknown,
): Promise<OptOutLookup | "invalid" | "unavailable"> {
  const token = normalizeNotificationToken(rawToken);
  if (!token) return "invalid";

  const admin = tryCreateAdminClient();
  if (!admin) return "unavailable";

  try {
    const { data, error } = await admin
      .from("user_preferences")
      .select("profile_id, email_shipment_updates")
      .eq("notification_token", token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return "invalid";

    const { data: authUser } = await admin.auth.admin.getUserById(
      data.profile_id,
    );
    const email = authUser?.user?.email ?? null;
    return {
      // No account address (deleted user, service profile) still gets a page
      // that works: the opt-out is about the preference row, and refusing to
      // render because we cannot pretty-print an address would be absurd.
      maskedEmail: email ? maskEmail(email) : "•••",
      alreadyOptedOut: data.email_shipment_updates === false,
    };
  } catch (err) {
    console.error("[notify] opt-out lookup failed", err);
    return "unavailable";
  }
}

/**
 * WRITE. Only ever reached from a POST.
 *
 * Both writes, in the order that fails safe: the ADDRESS suppression first,
 * then the account preference. If the second fails, the address is already
 * suppressed and the worker already refuses — the customer's wish is honoured
 * even though the page reports a problem. The reverse order would leave a
 * window where the preference says "no" but a second address on the same
 * account still receives.
 */
export async function applyNotificationOptOut(
  rawToken: unknown,
): Promise<OptOutOutcome> {
  const token = normalizeNotificationToken(rawToken);
  if (!token) return "invalid";

  const admin = tryCreateAdminClient();
  if (!admin) return "unavailable";

  try {
    const { data, error } = await admin
      .from("user_preferences")
      .select("profile_id, email_shipment_updates")
      .eq("notification_token", token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return "invalid";

    const { data: authUser } = await admin.auth.admin.getUserById(
      data.profile_id,
    );
    const email = authUser?.user?.email ?? null;
    if (email) {
      const { error: suppressError } = await admin
        .from("notification_suppressions")
        .upsert(
          {
            email: normalizeSuppressionEmail(email),
            scope: "shipment",
            reason: "customer opt-out via tokenized link",
          },
          { onConflict: "email,scope" },
        );
      if (suppressError) throw new Error(suppressError.message);
    }

    if (data.email_shipment_updates === false) return "already";

    const { error: updateError } = await admin
      .from("user_preferences")
      .update({ email_shipment_updates: false })
      .eq("profile_id", data.profile_id);
    if (updateError) throw new Error(updateError.message);
    return "opted_out";
  } catch (err) {
    console.error("[notify] opt-out failed", err);
    return "unavailable";
  }
}

/**
 * Re-subscribe. Not a link in an email — reachable only from the page a
 * customer just used to opt out, so an accidental click is reversible in the
 * same breath without a second credential being mailed anywhere.
 */
export async function revokeNotificationOptOut(
  rawToken: unknown,
): Promise<OptOutOutcome> {
  const token = normalizeNotificationToken(rawToken);
  if (!token) return "invalid";

  const admin = tryCreateAdminClient();
  if (!admin) return "unavailable";

  try {
    const { data, error } = await admin
      .from("user_preferences")
      .select("profile_id, email_shipment_updates")
      .eq("notification_token", token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return "invalid";

    const { data: authUser } = await admin.auth.admin.getUserById(
      data.profile_id,
    );
    const email = authUser?.user?.email ?? null;
    if (email) {
      const { error: deleteError } = await admin
        .from("notification_suppressions")
        .delete()
        .eq("email", normalizeSuppressionEmail(email))
        .eq("scope", "shipment");
      if (deleteError) throw new Error(deleteError.message);
    }

    const { error: updateError } = await admin
      .from("user_preferences")
      .update({ email_shipment_updates: true })
      .eq("profile_id", data.profile_id);
    if (updateError) throw new Error(updateError.message);
    return "opted_out";
  } catch (err) {
    console.error("[notify] opt-in failed", err);
    return "unavailable";
  }
}
