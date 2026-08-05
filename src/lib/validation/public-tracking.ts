import { z } from "zod";

/**
 * M-73 — the `/track` lookup input (§4's two factors).
 *
 * DELIBERATELY PERMISSIVE ON SHAPE. The only things rejected here are an
 * empty field and an absurd length; a well-formed-but-wrong number and a
 * malformed one both continue into the lookup and both come back as the SAME
 * refusal.
 *
 * That is not laziness, it is §19's "prevents enumeration". If Zod rejected
 * `PL-1999-000001` with "that isn't a PickLoads tracking number" while
 * `PL-2026-000101` came back with "no shipment matches", the two messages
 * would together confirm which YEARS are live — and the year is a quarter of
 * the search space. One refusal for every wrong input is the only version of
 * this page that leaks nothing.
 *
 * The bounds exist so a script cannot post a megabyte into the access ledger:
 * 64 characters is generous against a canonical 14, and the lookup truncates
 * again before writing.
 *
 * Messages are English fallbacks in the `FormState` idiom every public form
 * uses; the page renders the localized `shipment.error.*` string and only
 * falls back to these if a catalogue entry is ever missing.
 */
export const publicTrackingLookupSchema = z.object({
  tracking_number: z
    .string()
    .trim()
    .min(1, "Enter your PickLoads tracking number.")
    .max(64, "That tracking number is too long."),
  secondary: z
    .string()
    .trim()
    .min(1, "Enter the delivery ZIP code or access code.")
    .max(64, "That verification value is too long."),
});

export type PublicTrackingLookupInput = z.infer<
  typeof publicTrackingLookupSchema
>;
