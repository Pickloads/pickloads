import { z } from "zod";
import type { QuoteStage } from "@/emails/customer-templates";
import type { LeadStatus } from "@/lib/supabase/database.types";

/**
 * M-60 — staff freight-quote management. `freight_quotes.status` reuses the
 * CRM `lead_status` enum (M-32); the shipper-facing timeline maps it to
 * Received → In review → Quoted → Booked (src/lib/shipper-quotes.ts).
 */

export const LEAD_STATUSES = [
  "new",
  "call",
  "qualified",
  "appointment",
  "agreement",
  "waiting_documents",
  "active",
  "inactive",
  "lost",
] as const;

export const updateQuoteSchema = z.object({
  quote_id: z.uuid("Invalid quote."),
  status: z.enum(LEAD_STATUSES, { message: "Invalid status." }),
  /** Empty string = leave/clear the rate. */
  quoted_rate: z
    .union([z.literal(""), z.coerce.number().positive().max(1_000_000)])
    .transform((v) => (v === "" ? null : v)),
});

/** lead_status → shipper-visible stage (mirror of QUOTE_STATUS in
 *  src/lib/shipper-quotes.ts — unit-pinned in tests/unit/quotes.test.ts). */
export const QUOTE_STAGE_MAP: Record<LeadStatus, QuoteStage> = {
  new: "received",
  call: "in_review",
  qualified: "in_review",
  appointment: "in_review",
  agreement: "quoted",
  waiting_documents: "quoted",
  active: "booked",
  inactive: "closed",
  lost: "closed",
};
