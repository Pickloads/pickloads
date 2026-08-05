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

/**
 * M-69 / P-7 — LOADED rate per mile: gross ÷ `loads.miles`.
 *
 * `loads.miles` is the loaded leg only (pickup → delivery). This function
 * was called `formatRpm` and every surface labelled it "RPM" / "Avg RPM",
 * but the number a dispatcher means by RPM — and the one the
 * carrier-management playbook defines — is computed over DEADHEAD + LOADED
 * miles. The old label therefore overstated the rate on every load that
 * involved an empty leg, which is nearly all of them, on exactly the screen
 * where booking decisions get made.
 *
 * The VALUE is unchanged and deliberately so: M-69 relabels, it does not
 * silently move numbers under an operator. Use formatTrueRpm() for the real
 * figure once deadhead is captured.
 */
export function formatLoadedRpm(
  gross: number | null,
  miles: number | null,
): string {
  if (gross === null || miles === null || miles <= 0) return "—";
  return `$${(gross / miles).toFixed(2)}/mi`;
}

/**
 * M-69 / P-7 — TRUE rate per mile: gross ÷ (deadhead + loaded).
 *
 * Returns "—" when deadhead has not been captured (`loads.deadhead_miles`
 * is NULL, migration 0016). It never falls back to the loaded figure: a
 * silent fallback would make true RPM equal loaded RPM and re-create the
 * exact mislabel this fixes. `deadhead === 0` is a real, honest answer (the
 * truck was already there) and is computed normally.
 */
export function formatTrueRpm(
  gross: number | null,
  miles: number | null,
  deadheadMiles: number | null,
): string {
  if (gross === null || miles === null || deadheadMiles === null) return "—";
  const total = miles + deadheadMiles;
  if (total <= 0) return "—";
  return `$${(gross / total).toFixed(2)}/mi`;
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
