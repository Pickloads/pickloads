import type { LoadStatus } from "@/lib/supabase/database.types";

/**
 * M-30 — load status machine + display helpers. Plain module (no
 * "use server"/"use client") so server actions, RSC pages and client
 * components all share one source of truth.
 */

/**
 * Allowed transitions (arch: booked → in_transit → delivered → invoiced →
 * paid, cancellable until money moves). `invoiced`/`paid` are normally set
 * by M-31 (Stripe invoice + webhook) but manual transitions stay allowed for
 * off-Stripe payments (check/Zelle) — see docs/modules/M-30-loads.md.
 */
export const LOAD_TRANSITIONS: Record<LoadStatus, readonly LoadStatus[]> = {
  booked: ["in_transit", "cancelled"],
  in_transit: ["delivered", "cancelled"],
  delivered: ["invoiced", "cancelled"],
  invoiced: ["paid"],
  paid: [],
  cancelled: [],
};

export const LOAD_STATUSES: readonly LoadStatus[] = [
  "booked",
  "in_transit",
  "delivered",
  "invoiced",
  "paid",
  "cancelled",
];

export const LOAD_STATUS_LABELS: Record<LoadStatus, string> = {
  booked: "Booked",
  in_transit: "In transit",
  delivered: "Delivered",
  invoiced: "Invoiced",
  paid: "Paid",
  cancelled: "Cancelled",
};

/** Badge color class (portal.css .pbadge vocabulary) per status. */
export const LOAD_STATUS_BADGE: Record<LoadStatus, string> = {
  booked: "",
  in_transit: "amber",
  delivered: "amber",
  invoiced: "amber",
  paid: "green",
  cancelled: "red",
};

export function formatMoney(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** RPM = gross / miles, the number every dispatcher argues about. */
export function formatRpm(gross: number | null, miles: number | null): string {
  if (gross === null || miles === null || miles <= 0) return "—";
  return `$${(gross / miles).toFixed(2)}/mi`;
}

export function formatLane(args: {
  origin_city: string | null;
  origin_state: string | null;
  dest_city: string | null;
  dest_state: string | null;
}): string {
  const side = (city: string | null, state: string | null) =>
    [city, state].filter(Boolean).join(", ") || "—";
  return `${side(args.origin_city, args.origin_state)} → ${side(args.dest_city, args.dest_state)}`;
}
