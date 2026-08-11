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

/**
 * M-81 — first broker organization this profile belongs to.
 *
 * The third sibling, and the one that is NOT an authorization check. 0018's
 * `"own broker partner memberships"` policy returns the membership row whether
 * or not the organization is verified, so this answers *"was this person
 * invited?"* and never *"may they read anything?"* — that second question is
 * `my_broker_partner_ids()`'s, and every policy asks it.
 *
 * The distinction is load-bearing: §12 requires an unverified partner to read
 * nothing, and the portal still has to tell them WHY rather than render an
 * empty table that looks like a bug. `getBrokerPartnerState()` in
 * `src/lib/shipments/broker-access.ts` is what combines the two.
 */
export async function getMyBrokerPartnerId(
  supabase: ServerSupabase,
): Promise<string | null> {
  const { data } = await supabase
    .from("broker_partner_memberships")
    .select("broker_partner_id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.broker_partner_id ?? null;
}
