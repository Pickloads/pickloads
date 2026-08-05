import "server-only";

import { unstable_cache } from "next/cache";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * M-69 — one server-side reader for the `company_settings` switchboard
 * (arch §9, audit F-13/F-07).
 *
 * Before this module every consumer hand-rolled the same
 * `.from("company_settings").select("value").eq("key", …)` (create-account,
 * shipper portal ×2, admin settings) and three keys the runbook tells an
 * operator to flip — `packet_downloads_live`, `testimonials_visible`, and
 * the referral promise that had no key at all — controlled nothing
 * (plan §2 C-3/C-4, defects P-2/P-3/P-6).
 *
 * Contract:
 *   * PUBLIC keys only. Every value here is already anon-readable (0002:
 *     `company_settings` has `for select using (true)`), so this reader uses
 *     a cookie-less anon client. That matters: reading it does NOT pull
 *     `cookies()` into the caller, so the 300+ statically prerendered public
 *     pages stay prerendered instead of turning dynamic.
 *   * FAIL CLOSED. A missing key, an unparseable value, a database outage or
 *     a secretless preview environment all resolve to the caller's
 *     `fallback`, which for every promise-bearing gate is `false`. An
 *     unreachable switchboard must never light up an unfulfillable promise.
 *   * Cached for SETTING_TTL_SECONDS so a flip propagates without a deploy
 *     (the switchboard's whole point) while a page render costs at most one
 *     round trip per key per window.
 */

/** How long a flag read is cached. Flip → visible within this window. */
export const SETTING_TTL_SECONDS = 60;

/**
 * Boolean switchboard keys. Adding one here is not enough — it also needs an
 * idempotent upsert migration AND a supabase/seed.sql row, or every
 * environment silently gets the fallback.
 */
export type BooleanSettingKey =
  | "brokerage_active"
  | "packet_downloads_live"
  | "referral_program_active"
  | "shipper_signup_enabled"
  | "testimonials_visible";

function publicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // The build and the e2e lane run on placeholder env by design (M-41).
  if (!url || !key || url.includes("placeholder")) return null;
  return createSupabaseClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Raw fetch of one key. `null` means "could not be read" (absent key, no
 * env, error) — distinct from a value that is genuinely `false`.
 */
const readSetting = unstable_cache(
  async (key: string): Promise<unknown> => {
    const supabase = publicClient();
    if (!supabase) return null;
    try {
      const { data, error } = await supabase
        .from("company_settings")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? data.value : null;
    } catch (err) {
      console.error(`[company-settings] read failed for "${key}"`, err);
      return null;
    }
  },
  ["company-settings"],
  { revalidate: SETTING_TTL_SECONDS, tags: ["company-settings"] },
);

/**
 * Read a boolean gate. Accepts the JSON boolean the seed writes (`false`)
 * and the string form an operator can type into the M-24 settings editor
 * (`"true"` / `"false"`), because that editor stores free text.
 */
export async function getBooleanSetting(
  key: BooleanSettingKey,
  fallback = false,
): Promise<boolean> {
  return parseBooleanSetting(await readSetting(key), fallback);
}

/**
 * Pure parser behind getBooleanSetting — exported so the gate semantics
 * (including "unreadable ⇒ fallback") are unit-testable without a database.
 */
export function parseBooleanSetting(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase().replace(/^"|"$/g, "");
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}
