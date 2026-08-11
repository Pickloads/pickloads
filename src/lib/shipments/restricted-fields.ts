import "server-only";

import type { createClient } from "@/lib/supabase/server";

/**
 * M-83 — the one reader of `shipment_restricted_fields()` (migration 0030 §5).
 *
 * ── WHY THIS FILE EXISTS AT ALL ───────────────────────────────────────────
 *
 * M-71 recorded residual risk **R-1**: RLS is row-level, so `margin`,
 * `gross_shipper_amount` and `carrier_pay` were in the PostgREST payload of
 * any shipment row a customer could read. M-72, M-74, M-75, M-77 and M-81 all
 * inherited it and all pointed at M-83. Its stated blocker was real — staff
 * surfaces run on the *authenticated* session, so Postgres cannot tell a
 * dispatcher from a shipper at the GRANT level.
 *
 * The resolution is not a cleverer grant. 0030 takes the four sensitive
 * columns (the financial trio plus §4's `public_access_hash`) away from
 * `authenticated` and `anon` entirely, and hands three of them back through a
 * SECURITY DEFINER function that applies the audience rule *in SQL*:
 *
 *   staff, in dispatcher scope → gross, carrier_pay, margin, internal delay
 *   the hauling carrier        → carrier_pay only, three nulls
 *   anyone else                → NO ROW
 *
 * `public_access_hash` is handed back to nobody: M-70 is unambiguous that it
 * is a credential and no DTO serializes it at any audience, staff included.
 *
 * ── WHY IT IS A SECOND ROUND TRIP AND NOT A JOIN ──────────────────────────
 *
 * Because the alternative is a view, and a view would have to re-implement
 * every policy on `shipments` — including 0030's own restrictive dispatcher
 * scope — in a second place that can drift. Two indexed lookups on a detail
 * page is a cost §25 can carry (it is one extra round trip, on a page that
 * already makes several, and never on a LIST). The list projections name none
 * of these columns and are unchanged.
 *
 * ── FAILURE IS EMPTY, NEVER LOUD ──────────────────────────────────────────
 *
 * A missing row and an error both resolve to `NO_RESTRICTED_FIELDS`. The
 * caller renders "—" for a rate it could not read, which is the honest state;
 * throwing would turn a privacy control into a 500 on a working page.
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

export interface ShipmentRestrictedFields {
  gross_shipper_amount: number | null;
  carrier_pay: number | null;
  margin: number | null;
  delay_reason_internal: string | null;
}

/** Every field null: what a caller entitled to nothing sees, and the fallback
 *  on any failure. Frozen so a caller cannot mutate the shared object. */
export const NO_RESTRICTED_FIELDS: ShipmentRestrictedFields = Object.freeze({
  gross_shipper_amount: null,
  carrier_pay: null,
  margin: null,
  delay_reason_internal: null,
});

export async function getShipmentRestrictedFields(
  supabase: ServerSupabase,
  shipmentId: string,
): Promise<ShipmentRestrictedFields> {
  const { data, error } = await supabase.rpc("shipment_restricted_fields", {
    p_shipment_id: shipmentId,
  });
  if (error) {
    // The message, not the values — a log line that echoed a margin would
    // defeat the column privilege it is reporting on.
    console.error("[shipment-restricted] read failed", error.message);
    return NO_RESTRICTED_FIELDS;
  }
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return NO_RESTRICTED_FIELDS;
  return {
    gross_shipper_amount: row.gross_shipper_amount ?? null,
    carrier_pay: row.carrier_pay ?? null,
    margin: row.margin ?? null,
    delay_reason_internal: row.delay_reason_internal ?? null,
  };
}
