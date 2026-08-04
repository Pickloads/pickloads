"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isStaffRole } from "@/lib/auth";
import type { FormState } from "@/lib/form-state";
import { LOAD_TRANSITIONS } from "@/lib/loads";

/**
 * M-30 loads server actions — staff only (Q3 security model).
 *
 * Same pattern as M-23/M-24: explicit server-side role check, then all
 * writes through the COOKIE-BOUND server client so the "staff manage loads"
 * RLS policy gates again at the DB. The service-role client is never used
 * on this surface.
 *
 * F-03: fee_pct_applied is deliberately OMITTED on insert — the DB trigger
 * snapshots the carrier's current dispatch_fee_pct and computes dispatch_fee.
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

async function staffSession(): Promise<{
  supabase: ServerSupabase;
  userId: string;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !isStaffRole(profile.role)) return null;
  return { supabase, userId: user.id };
}

const NOT_STAFF = "Your session expired or lacks staff access. Sign in again.";
const LOAD_ERROR = "Couldn't save the load. Refresh and try again.";

/* ---------------- Status machine ---------------- */

const statusSchema = z.enum([
  "booked",
  "in_transit",
  "delivered",
  "invoiced",
  "paid",
  "cancelled",
]);

export async function updateLoadStatus(
  loadId: string,
  status: string,
): Promise<{ ok: boolean; error?: string }> {
  const id = z.uuid().safeParse(loadId);
  const next = statusSchema.safeParse(status);
  if (!id.success || !next.success) {
    return { ok: false, error: "Invalid status change." };
  }
  const session = await staffSession();
  if (!session) return { ok: false, error: NOT_STAFF };

  // Read-then-write: enforce the transition map server-side.
  const { data: load } = await session.supabase
    .from("loads")
    .select("status")
    .eq("id", id.data)
    .maybeSingle();
  if (!load) return { ok: false, error: "Load not found." };
  if (!LOAD_TRANSITIONS[load.status].includes(next.data)) {
    return {
      ok: false,
      error: `Can't move a ${load.status.replace("_", " ")} load to ${next.data.replace("_", " ")}.`,
    };
  }

  const { error } = await session.supabase
    .from("loads")
    .update({ status: next.data })
    .eq("id", id.data)
    // Optimistic-concurrency guard: another dispatcher may have moved it.
    .eq("status", load.status);
  if (error) {
    console.error("[loads] status update failed", error.message);
    return { ok: false, error: LOAD_ERROR };
  }
  return { ok: true };
}

/* ---------------- Create load ---------------- */

const US_STATE = /^[A-Za-z]{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const createLoadSchema = z.object({
  carrier_id: z.uuid("Pick a carrier."),
  broker_name: optionalText(120),
  broker_mc: optionalText(20),
  origin_city: optionalText(80),
  origin_state: z
    .union([z.literal(""), z.string().regex(US_STATE, "2-letter state")])
    .optional()
    .transform((v) => (v ? v.toUpperCase() : null)),
  dest_city: optionalText(80),
  dest_state: z
    .union([z.literal(""), z.string().regex(US_STATE, "2-letter state")])
    .optional()
    .transform((v) => (v ? v.toUpperCase() : null)),
  pickup_date: z
    .union([z.literal(""), z.string().regex(DATE)])
    .optional()
    .transform((v) => (v ? v : null)),
  delivery_date: z
    .union([z.literal(""), z.string().regex(DATE)])
    .optional()
    .transform((v) => (v ? v : null)),
  equipment: optionalText(40),
  gross_rate: z
    .union([z.literal(""), z.coerce.number().min(0).max(1_000_000)])
    .optional()
    .transform((v) => (typeof v === "number" ? v : null)),
  miles: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(20_000)])
    .optional()
    .transform((v) => (typeof v === "number" ? v : null)),
});

export async function createLoad(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw: Record<string, string> = {};
  for (const key of [
    "carrier_id",
    "broker_name",
    "broker_mc",
    "origin_city",
    "origin_state",
    "dest_city",
    "dest_state",
    "pickup_date",
    "delivery_date",
    "equipment",
    "gross_rate",
    "miles",
  ]) {
    const value = formData.get(key);
    raw[key] = typeof value === "string" ? value : "";
  }
  const parsed = createLoadSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      status: "error",
      message: first ? `${first.path.join(".")}: ${first.message}` : "Check the load fields.",
    };
  }
  const load = parsed.data;

  const session = await staffSession();
  if (!session) return { status: "error", message: NOT_STAFF };

  // fee_pct_applied intentionally omitted — DB trigger snapshots it (F-03).
  const { error } = await session.supabase.from("loads").insert({
    carrier_id: load.carrier_id,
    dispatcher_id: session.userId, // dispatcher auto = current user (F-09)
    broker_name: load.broker_name,
    broker_mc: load.broker_mc,
    origin_city: load.origin_city,
    origin_state: load.origin_state,
    dest_city: load.dest_city,
    dest_state: load.dest_state,
    pickup_date: load.pickup_date,
    delivery_date: load.delivery_date,
    equipment: load.equipment,
    gross_rate: load.gross_rate,
    miles: load.miles,
  });
  if (error) {
    console.error("[loads] insert failed", error.message);
    return { status: "error", message: LOAD_ERROR };
  }
  return { status: "success" };
}
