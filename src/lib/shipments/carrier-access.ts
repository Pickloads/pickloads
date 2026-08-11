import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { SessionProfile } from "@/lib/auth";
import { getMyCarrierId } from "@/lib/memberships";
import { logShipmentSignal } from "@/lib/shipments/observability";
import type { ShipmentStatus } from "@/lib/shipments/types";

/**
 * M-76 — the authorization gate every CARRIER shipment action passes through
 * (§3, §13, §19).
 *
 * This is `staff-access.ts`'s shape, deliberately: one function, called first
 * by every action, re-reading the session and the row rather than trusting
 * the page that rendered the form. What it is NOT is a copy — the rules are
 * different in three ways that matter, and each one is a §19 sentence:
 *
 *   | | dispatcher (`resolveShipmentAccess`) | carrier (here) |
 *   |---|---|---|
 *   | tenancy | `staff-scope.ts`, two arms | `my_carrier_ids()` via the membership helper |
 *   | refusal | "outside your assignment — ask an admin" | `not_found`, always |
 *   | reads through | cookie-bound client, staff policy | cookie-bound client, `"carrier member read shipments"` |
 *
 * ── WHY EVERY REFUSAL IS `not_found` HERE AND A MESSAGE THERE ────────────
 *
 * §3: *"No role may access another company's shipment through URL
 * manipulation, API calls or direct database requests."* A dispatcher is
 * inside the company and telling them "this exists but is not yours" leads to
 * the right next action. A carrier is a different tenant, and "this exists but
 * is not yours" ANSWERS THE QUESTION a URL manipulator is asking. So a
 * malformed id, a nonexistent id and carrier B's id all produce the same
 * `not_found` — M-74's rule for the shipper surface, applied for the same
 * reason. The attempt is still journalled as an `unauthorized_access_attempt`
 * (§26), which is where the distinction lives.
 *
 * ── TWO BOUNDS, NOT ONE ──────────────────────────────────────────────────
 *
 * The read goes through the COOKIE-BOUND client, so 0018's
 * `"carrier member read shipments"` policy applies — that is the guarantee.
 * It ALSO carries `.eq("carrier_id", myCarrierId)`, which is what makes the
 * query use `idx_shipments_carrier` and what makes a mistake visible in an
 * EXPLAIN rather than only in a penetration test. `tryCreateAdminClient` is
 * deliberately never imported into this file: a service-role convenience on
 * the carrier read path would turn a tenant boundary into an application
 * `if`.
 *
 * ── THE POLICY WAS NOT WIDENED ───────────────────────────────────────────
 *
 * `docs/modules/M-71-shipment-schema.md` is explicit: *"M-76 must not widen
 * the carrier read policy to FOR ALL."* It did not. Carriers still hold
 * SELECT and nothing else on `shipments`, `shipment_events`,
 * `shipment_parties` and `shipment_assignments`; every write in this module
 * goes through a server action that calls M-72's engine with the service
 * role, after this gate. §12 of the RLS suite asserts the policy's `cmd` is
 * still `SELECT` as a catalog fact, so a future widening fails a test rather
 * than passing a review.
 */

export const NOT_CARRIER_MESSAGE =
  "Your session expired or is not a carrier account. Sign in again.";

export const SHIPMENT_MISSING_MESSAGE =
  "That shipment is not on your board. Refresh the list — dispatch may have reassigned it.";

export const NO_CARRIER_RECORD_MESSAGE =
  "Your account isn't linked to a carrier record yet. Our team activates the link during document review — or call (908) 404-5373.";

export interface CarrierShipmentAccessGrant {
  ok: true;
  session: SessionProfile;
  carrierId: string;
  shipmentId: string;
  status: ShipmentStatus;
  trackingNumber: string;
}

export interface CarrierShipmentAccessDenied {
  ok: false;
  code: "not_carrier" | "no_carrier_record" | "not_found";
  message: string;
}

export type CarrierShipmentAccessResult =
  | CarrierShipmentAccessGrant
  | CarrierShipmentAccessDenied;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cheap shape check before any query — a scripted scan never reaches the DB. */
export function isShipmentId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export async function resolveCarrierShipmentAccess(
  shipmentId: unknown,
): Promise<CarrierShipmentAccessResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: "not_carrier", message: NOT_CARRIER_MESSAGE };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status, full_name, created_at")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "carrier" || profile.status === "suspended") {
    return { ok: false, code: "not_carrier", message: NOT_CARRIER_MESSAGE };
  }

  const session: SessionProfile = {
    userId: user.id,
    email: user.email ?? null,
    role: profile.role,
    status: profile.status,
    fullName: profile.full_name,
    createdAt: profile.created_at,
  };

  // M-57's membership helper, never `carriers.profile_id` — adding a teammate
  // must stay an INSERT rather than a code change.
  const carrierId = await getMyCarrierId(supabase);
  if (carrierId === null) {
    return {
      ok: false,
      code: "no_carrier_record",
      message: NO_CARRIER_RECORD_MESSAGE,
    };
  }

  if (!isShipmentId(shipmentId)) {
    return { ok: false, code: "not_found", message: SHIPMENT_MISSING_MESSAGE };
  }

  const { data: shipment } = await supabase
    .from("shipments")
    .select("id, status, tracking_number, carrier_id")
    .eq("id", shipmentId)
    .eq("carrier_id", carrierId)
    .maybeSingle();

  if (!shipment) {
    logShipmentSignal({
      signal: "unauthorized_access_attempt",
      code: "carrier_shipment_not_assigned",
      actorRole: "carrier",
      actorId: session.userId,
      detail:
        "carrier session requested a shipment that is not assigned to their carrier",
    });
    return { ok: false, code: "not_found", message: SHIPMENT_MISSING_MESSAGE };
  }

  return {
    ok: true,
    session,
    carrierId,
    shipmentId: shipment.id,
    status: shipment.status,
    trackingNumber: shipment.tracking_number,
  };
}

/**
 * The same gate WITHOUT a shipment — for issuing a driver link from the list,
 * and for anything else that is about the carrier rather than one row.
 */
export async function resolveCarrierActor(): Promise<
  | { ok: true; session: SessionProfile; carrierId: string }
  | CarrierShipmentAccessDenied
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: "not_carrier", message: NOT_CARRIER_MESSAGE };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status, full_name, created_at")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "carrier" || profile.status === "suspended") {
    return { ok: false, code: "not_carrier", message: NOT_CARRIER_MESSAGE };
  }
  const carrierId = await getMyCarrierId(supabase);
  if (carrierId === null) {
    return {
      ok: false,
      code: "no_carrier_record",
      message: NO_CARRIER_RECORD_MESSAGE,
    };
  }
  return {
    ok: true,
    session: {
      userId: user.id,
      email: user.email ?? null,
      role: profile.role,
      status: profile.status,
      fullName: profile.full_name,
      createdAt: profile.created_at,
    },
    carrierId,
  };
}
