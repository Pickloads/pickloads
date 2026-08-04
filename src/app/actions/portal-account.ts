"use server";

import { createClient } from "@/lib/supabase/server";
import { field } from "@/lib/forms/guard";
import { accountPreferencesSchema } from "@/lib/validation/portal";
import { firstIssueMessage } from "@/lib/validation/shared";
import type { FormState } from "@/lib/form-state";

/**
 * M-55 — account settings shared by the carrier AND shipper portals:
 * preferred language (profiles.preferred_language, "own profile update" RLS)
 * and email preferences (user_preferences upsert under its own-row policies).
 * Password changes never pass through here — they run on the browser client
 * against Supabase Auth directly (same as M-42 reset).
 */

const SIGN_IN_AGAIN = "Your session expired — sign in again.";

export async function updateAccountPreferences(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = accountPreferencesSchema.safeParse({
    preferred_language: field(formData, "preferred_language"),
    email_load_updates: field(formData, "email_load_updates"),
    email_document_reviews: field(formData, "email_document_reviews"),
    email_marketing: field(formData, "email_marketing"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: SIGN_IN_AGAIN };

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ preferred_language: parsed.data.preferred_language })
    .eq("id", user.id);
  if (profileError) {
    console.error("[account] language update failed", profileError.message);
    return { status: "error", message: "Couldn't save your settings. Retry." };
  }

  const { error: prefError } = await supabase.from("user_preferences").upsert({
    profile_id: user.id,
    email_load_updates: parsed.data.email_load_updates,
    email_document_reviews: parsed.data.email_document_reviews,
    email_marketing: parsed.data.email_marketing,
  });
  if (prefError) {
    console.error("[account] preferences upsert failed", prefError.message);
    return { status: "error", message: "Couldn't save your settings. Retry." };
  }
  return { status: "success" };
}

/** Mark every unread notification read (cookie-bound, own-rows policy). */
export async function markAllNotificationsRead(): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: SIGN_IN_AGAIN };

  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("profile_id", user.id)
    .is("read_at", null);
  if (error) {
    console.error("[account] mark read failed", error.message);
    return { status: "error", message: "Couldn't update notifications. Retry." };
  }
  return { status: "success" };
}
