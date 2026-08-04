import "server-only";

import type { createClient } from "@/lib/supabase/server";

/**
 * M-55/M-57 — membership-first company lookups for the customer portals.
 *
 * The M-50 data model made `carrier_memberships` / `shipper_memberships` the
 * authoritative person↔company join (decision D4: multi-user ready in the DB,
 * single-user UI at launch). Every carrier/shipper portal query goes through
 * these helpers instead of `carriers.profile_id` so that adding a teammate
 * later is purely an INSERT — no page rewrites:
 *
 *   - RLS side: policies already use my_carrier_ids()/my_shipper_ids() (0009).
 *   - App side: these helpers resolve "my company" the same way.
 *
 * `carriers.profile_id` is kept in the schema for back-compat (M-50 backfilled
 * every claimed carrier into an owner membership) but MUST NOT be used for new
 * portal lookups — see docs/modules/M-57-membership-architecture.md.
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/** First carrier this profile belongs to (single-company UI at launch). */
export async function getMyCarrierId(
  supabase: ServerSupabase,
): Promise<string | null> {
  const { data } = await supabase
    .from("carrier_memberships")
    .select("carrier_id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.carrier_id ?? null;
}

/** First shipper this profile belongs to (single-company UI at launch). */
export async function getMyShipperId(
  supabase: ServerSupabase,
): Promise<string | null> {
  const { data } = await supabase
    .from("shipper_memberships")
    .select("shipper_id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.shipper_id ?? null;
}
