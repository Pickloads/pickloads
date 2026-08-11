import "server-only";

import { createClient } from "@/lib/supabase/server";
import { isStaffRole, type SessionProfile } from "@/lib/auth";
import {
  dispatcherMayActOn,
  getStaffScope,
  type StaffScope,
} from "@/lib/staff-scope";
import { logShipmentSignal } from "@/lib/shipments/observability";
import type { ShipmentStatus } from "@/lib/shipments/types";

/**
 * M-75 — the authorization gate every dispatcher server action passes through
 * (§3, §14, §19).
 *
 * ── WHY ONE GATE AND NOT AN `if` PER ACTION ───────────────────────────────
 *
 * There are fourteen §14 actions. Fourteen hand-written checks is fourteen
 * chances to write one of them slightly differently, and the one that gets it
 * wrong is not discoverable by reading — it looks exactly like the thirteen
 * that are right. So the check is a function, every action calls it first, and
 * `tests/unit/dispatcher-shipment-actions.test.ts` enumerates the exported
 * actions and asserts each one refuses an out-of-scope shipment.
 *
 * ── WHAT IT ACTUALLY CHECKS, IN ORDER ─────────────────────────────────────
 *
 *   1. **A live session with a staff role.** Not "the page rendered", not "the
 *      form was submitted from a staff page" — the session is re-read here,
 *      because a server action is a public HTTP endpoint and the page that
 *      rendered its form is not a control.
 *   2. **The shipment exists and is readable** under 0018's staff policy,
 *      through the COOKIE-BOUND client. A service-role read here would make
 *      the RLS policy decorative on the write path.
 *   3. **The dispatcher scope**, per `dispatcherMayActOn` — the same rule the
 *      board's read expression encodes. §19's *"dispatcher permissions are
 *      limited"* is a claim about writes at least as much as about reads.
 *
 * It returns the shipment's CURRENT STATUS along with the grant, because
 * every transition needs it for M-72's compare-and-swap and re-reading it in
 * the action would be a second round trip and a second chance to read a
 * different row.
 *
 * ── WHY A REFUSAL IS NOT A 404 HERE ───────────────────────────────────────
 *
 * M-74's shipper detail 404s an out-of-tenant id, because a shipper asking
 * "does this exist?" must not be answered. A dispatcher is different: they are
 * inside the company, the shipment demonstrably exists, and telling them "this
 * is outside your assignment — ask an admin" is the message that leads to the
 * right next action. The attempt is journalled as an
 * `unauthorized_access_attempt` signal either way (§26).
 */

export const NOT_STAFF_MESSAGE =
  "Your session expired or lacks staff access. Sign in again.";

export const OUT_OF_SCOPE_MESSAGE =
  "That shipment is outside your dispatcher assignment. Ask an admin to assign you the carrier, or to take the action for you.";

export const SHIPMENT_MISSING_MESSAGE = "That shipment no longer exists.";

export type StaffActorRole = "admin" | "dispatcher";

export interface ShipmentAccessGrant {
  ok: true;
  session: SessionProfile;
  scope: StaffScope;
  actorRole: StaffActorRole;
  shipmentId: string;
  status: ShipmentStatus;
  trackingNumber: string;
  shipperId: string;
  carrierId: string | null;
  dispatcherId: string | null;
}

export interface ShipmentAccessDenied {
  ok: false;
  code: "not_staff" | "not_found" | "out_of_scope";
  message: string;
}

export type ShipmentAccessResult = ShipmentAccessGrant | ShipmentAccessDenied;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cheap shape check before any query — a scripted scan never reaches the DB. */
export function isShipmentId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export async function resolveShipmentAccess(
  shipmentId: unknown,
): Promise<ShipmentAccessResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "not_staff", message: NOT_STAFF_MESSAGE };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status, full_name, created_at")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !isStaffRole(profile.role) || profile.status === "suspended") {
    return { ok: false, code: "not_staff", message: NOT_STAFF_MESSAGE };
  }

  const session: SessionProfile = {
    userId: user.id,
    email: user.email ?? null,
    role: profile.role,
    status: profile.status,
    fullName: profile.full_name,
    createdAt: profile.created_at,
  };
  const actorRole: StaffActorRole =
    profile.role === "admin" ? "admin" : "dispatcher";

  if (!isShipmentId(shipmentId)) {
    return { ok: false, code: "not_found", message: SHIPMENT_MISSING_MESSAGE };
  }

  const { data: shipment } = await supabase
    .from("shipments")
    .select("id, status, tracking_number, shipper_id, carrier_id, dispatcher_id")
    .eq("id", shipmentId)
    .maybeSingle();
  if (!shipment) {
    return { ok: false, code: "not_found", message: SHIPMENT_MISSING_MESSAGE };
  }

  const scope = await getStaffScope(supabase, session);
  if (!dispatcherMayActOn(scope, session.userId, shipment)) {
    logShipmentSignal({
      signal: "unauthorized_access_attempt",
      code: "dispatcher_out_of_scope",
      shipmentId: shipment.id,
      actorRole,
      actorId: session.userId,
      detail: "dispatcher attempted an action on an unassigned shipment",
    });
    return { ok: false, code: "out_of_scope", message: OUT_OF_SCOPE_MESSAGE };
  }

  return {
    ok: true,
    session,
    scope,
    actorRole,
    shipmentId: shipment.id,
    status: shipment.status,
    trackingNumber: shipment.tracking_number,
    shipperId: shipment.shipper_id,
    carrierId: shipment.carrier_id,
    dispatcherId: shipment.dispatcher_id,
  };
}

/**
 * The same gate WITHOUT a shipment — for creation, which has no row to scope
 * against yet. Only the staff check applies; the §2 brokerage gate is
 * `create.ts`'s.
 */
export async function resolveStaffActor(): Promise<
  | { ok: true; session: SessionProfile; scope: StaffScope; actorRole: StaffActorRole }
  | ShipmentAccessDenied
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, code: "not_staff", message: NOT_STAFF_MESSAGE };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status, full_name, created_at")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !isStaffRole(profile.role) || profile.status === "suspended") {
    return { ok: false, code: "not_staff", message: NOT_STAFF_MESSAGE };
  }

  const session: SessionProfile = {
    userId: user.id,
    email: user.email ?? null,
    role: profile.role,
    status: profile.status,
    fullName: profile.full_name,
    createdAt: profile.created_at,
  };
  return {
    ok: true,
    session,
    scope: await getStaffScope(supabase, session),
    actorRole: profile.role === "admin" ? "admin" : "dispatcher",
  };
}
