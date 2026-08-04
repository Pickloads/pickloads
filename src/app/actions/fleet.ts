"use server";

import { createClient } from "@/lib/supabase/server";
import { getMyCarrierId } from "@/lib/memberships";
import { field } from "@/lib/forms/guard";
import {
  deleteFleetSchema,
  driverSchema,
  truckSchema,
} from "@/lib/validation/fleet";
import { firstIssueMessage } from "@/lib/validation/shared";
import type { FormState } from "@/lib/form-state";

/**
 * M-55 — trucks & drivers CRUD (carrier portal).
 *
 * Everything runs on the COOKIE-BOUND server client: the 0009 "member manage
 * trucks/drivers" RLS policies (carrier_id in my_carrier_ids()) are the
 * authoritative gate — a tampered carrier_id simply matches zero rows. The
 * carrier_id itself never comes from the request: it's resolved server-side
 * through the membership helper (M-57 doctrine).
 */

const SIGN_IN_AGAIN = "Your session expired — sign in again.";
const NOT_LINKED =
  "Your account isn't linked to a carrier record yet — call (908) 404-5373.";

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

async function carrierContext(): Promise<
  { supabase: ServerSupabase; carrierId: string } | { error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: SIGN_IN_AGAIN };
  const carrierId = await getMyCarrierId(supabase);
  if (!carrierId) return { error: NOT_LINKED };
  return { supabase, carrierId };
}

export async function saveTruck(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = truckSchema.safeParse({
    id: field(formData, "id"),
    unit_number: field(formData, "unit_number"),
    equipment: field(formData, "equipment"),
    year: field(formData, "year"),
    make: field(formData, "make"),
    model: field(formData, "model"),
    vin: field(formData, "vin"),
    plate: field(formData, "plate"),
    plate_state: field(formData, "plate_state"),
    active: field(formData, "active"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const ctx = await carrierContext();
  if ("error" in ctx) return { status: "error", message: ctx.error };

  const { id, ...values } = parsed.data;
  const row = { ...values, carrier_id: ctx.carrierId };
  const { error } = id
    ? await ctx.supabase
        .from("trucks")
        .update(row)
        .eq("id", id)
        .eq("carrier_id", ctx.carrierId)
    : await ctx.supabase.from("trucks").insert(row);
  if (error) {
    console.error("[fleet] truck save failed", error.message);
    return { status: "error", message: "Couldn't save the truck. Retry." };
  }
  return { status: "success" };
}

export async function deleteTruck(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = deleteFleetSchema.safeParse({ id: field(formData, "id") });
  if (!parsed.success) return { status: "error", message: "Invalid record." };
  const ctx = await carrierContext();
  if ("error" in ctx) return { status: "error", message: ctx.error };

  const { error } = await ctx.supabase
    .from("trucks")
    .delete()
    .eq("id", parsed.data.id)
    .eq("carrier_id", ctx.carrierId);
  if (error) {
    console.error("[fleet] truck delete failed", error.message);
    return { status: "error", message: "Couldn't remove the truck. Retry." };
  }
  return { status: "success" };
}

export async function saveDriver(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = driverSchema.safeParse({
    id: field(formData, "id"),
    full_name: field(formData, "full_name"),
    phone: field(formData, "phone"),
    email: field(formData, "email"),
    cdl_number: field(formData, "cdl_number"),
    cdl_state: field(formData, "cdl_state"),
    cdl_expiry: field(formData, "cdl_expiry"),
    medical_card_expiry: field(formData, "medical_card_expiry"),
    active: field(formData, "active"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const ctx = await carrierContext();
  if ("error" in ctx) return { status: "error", message: ctx.error };

  const { id, ...values } = parsed.data;
  const row = { ...values, carrier_id: ctx.carrierId };
  const { error } = id
    ? await ctx.supabase
        .from("drivers")
        .update(row)
        .eq("id", id)
        .eq("carrier_id", ctx.carrierId)
    : await ctx.supabase.from("drivers").insert(row);
  if (error) {
    console.error("[fleet] driver save failed", error.message);
    return { status: "error", message: "Couldn't save the driver. Retry." };
  }
  return { status: "success" };
}

export async function deleteDriver(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = deleteFleetSchema.safeParse({ id: field(formData, "id") });
  if (!parsed.success) return { status: "error", message: "Invalid record." };
  const ctx = await carrierContext();
  if ("error" in ctx) return { status: "error", message: ctx.error };

  const { error } = await ctx.supabase
    .from("drivers")
    .delete()
    .eq("id", parsed.data.id)
    .eq("carrier_id", ctx.carrierId);
  if (error) {
    console.error("[fleet] driver delete failed", error.message);
    return { status: "error", message: "Couldn't remove the driver. Retry." };
  }
  return { status: "success" };
}
