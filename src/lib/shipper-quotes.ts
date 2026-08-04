import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { getMyShipperId } from "@/lib/memberships";
import type { SessionProfile } from "@/lib/auth";
import type { LeadStatus } from "@/lib/supabase/database.types";

export interface QuoteListRow {
  id: string;
  pickup_city: string | null;
  pickup_state: string | null;
  pickup_zip: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_zip: string | null;
  pickup_date: string | null;
  delivery_deadline: string | null;
  commodity: string | null;
  weight_lbs: number | null;
  equipment: string | null;
  frequency: string | null;
  status: LeadStatus;
  quoted_rate: number | null;
  created_at: string;
}

export interface ShipperQuotesResult {
  shipperId: string | null;
  quotes: QuoteListRow[];
}

/**
 * M-56 — shared shipper quote reads (overview + My Quotes pages).
 *
 * SELF-SIGNUP PATH (membership exists): one-shot claim of un-owned historical
 * quotes matching the Supabase-VERIFIED session email (audit §6.3 — never
 * signup input), then a cookie-bound read under the 0009 "member read own
 * quotes" policy.
 *
 * LEGACY PATH (staff-invited, no membership): the documented M-32
 * email-matching read (admin client, strictly `.eq("email", session.email)`).
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

const QUOTE_COLUMNS =
  "id, pickup_city, pickup_state, pickup_zip, delivery_city, delivery_state, delivery_zip, pickup_date, delivery_deadline, commodity, weight_lbs, equipment, frequency, status, quoted_rate, created_at";

export async function getShipperQuotes(
  supabase: ServerSupabase,
  session: SessionProfile,
  limit = 100,
): Promise<ShipperQuotesResult> {
  const shipperId = await getMyShipperId(supabase);

  if (shipperId) {
    const admin = session.email ? tryCreateAdminClient() : null;
    if (admin && session.email) {
      const { error: claimError } = await admin
        .from("freight_quotes")
        .update({ shipper_id: shipperId })
        .is("shipper_id", null)
        .ilike("email", session.email.replace(/[%_]/g, "\\$&"));
      if (claimError) {
        console.error("[shipper-quotes] claim failed", claimError.message);
      }
    }
    const { data } = await supabase
      .from("freight_quotes")
      .select(QUOTE_COLUMNS)
      .eq("shipper_id", shipperId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return { shipperId, quotes: data ?? [] };
  }

  // Legacy staff-invited account.
  const admin = session.email ? tryCreateAdminClient() : null;
  if (admin && session.email) {
    const { data } = await admin
      .from("freight_quotes")
      .select(QUOTE_COLUMNS)
      .eq("email", session.email)
      .order("created_at", { ascending: false })
      .limit(limit);
    return { shipperId: null, quotes: data ?? [] };
  }
  return { shipperId: null, quotes: [] };
}

/** Shipper-facing labels for the internal lead_status pipeline (M-32). */
export const QUOTE_STATUS: Partial<
  Record<LeadStatus, { label: string; badge: string; stage: number }>
> = {
  new: { label: "Received", badge: "amber", stage: 0 },
  call: { label: "In review", badge: "amber", stage: 1 },
  qualified: { label: "In review", badge: "amber", stage: 1 },
  appointment: { label: "In review", badge: "amber", stage: 1 },
  agreement: { label: "Quoted", badge: "green", stage: 2 },
  waiting_documents: { label: "Quoted", badge: "green", stage: 2 },
  active: { label: "Booked", badge: "green", stage: 3 },
  inactive: { label: "Closed", badge: "", stage: -1 },
  lost: { label: "Closed", badge: "", stage: -1 },
};

/** The shipper-facing pipeline stages, in order (status timeline). */
export const QUOTE_STAGES = ["Received", "In review", "Quoted", "Booked"] as const;
