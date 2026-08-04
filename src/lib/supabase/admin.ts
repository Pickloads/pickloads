import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Service-role client — BYPASSES RLS. Decision Q3: this is the ONLY write
 * path for public-form data (leads, quotes, contact, newsletter), used
 * strictly server-side AFTER Zod + Turnstile + rate-limit checks.
 *
 * `import "server-only"` makes any client-bundle import a build error.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
