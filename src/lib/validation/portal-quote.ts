import { z } from "zod";
import { optionalText, phoneField } from "./shared";

/**
 * M-56 — the in-portal professional quote form (directive field set), far
 * stricter than the public zip-to-zip teaser: full facilities, dates,
 * dims/temp/hazmat, instructions and contact. Server-validated only — the
 * insert runs through the shipper-portal action (service role after a
 * verified membership), never from the client.
 */

const zipRequired = z
  .string()
  .trim()
  .regex(/^\d{5}(-\d{4})?$/, "Enter a 5-digit ZIP code.");

const stateRequired = z
  .string()
  .trim()
  .min(2, "Enter the state.")
  .max(40, "That entry is too long.");

const cityRequired = z
  .string()
  .trim()
  .min(2, "Enter the city.")
  .max(80, "That entry is too long.");

/** Optional bounded integer from text input (empty/garbage → null). */
function optionalInt(min: number, max: number, message: string) {
  return z
    .string()
    .optional()
    .transform((v) => {
      const digits = (v ?? "").trim().replace(/[,\s]/g, "");
      if (!/^-?\d+$/.test(digits)) return null;
      return Number(digits);
    })
    .refine((v) => v === null || (v >= min && v <= max), { message });
}

const isoDate = (message: string) =>
  z
    .union([z.literal(""), z.iso.date(message)])
    .optional()
    .transform((v) => (v ? v : null));

export const QUOTE_EQUIPMENT = [
  "Dry Van",
  "Reefer",
  "Flatbed",
  "Step Deck",
  "Power Only",
  "Hot Shot",
  "Box Truck",
  "Sprinter Van",
  "Not sure — recommend one",
] as const;

export const QUOTE_FREQUENCIES = [
  "One-time shipment",
  "Weekly",
  "Monthly",
  "Seasonal",
] as const;

export const portalQuoteSchema = z
  .object({
    pickup_company: optionalText(120),
    pickup_address: optionalText(160),
    pickup_city: cityRequired,
    pickup_state: stateRequired,
    pickup_zip: zipRequired,
    delivery_company: optionalText(120),
    delivery_address: optionalText(160),
    delivery_city: cityRequired,
    delivery_state: stateRequired,
    delivery_zip: zipRequired,
    pickup_date: isoDate("Enter a valid pickup date.").refine(
      (v) => v === null || v >= new Date().toISOString().slice(0, 10),
      { message: "Pickup date can't be in the past." },
    ),
    delivery_deadline: isoDate("Enter a valid delivery deadline."),
    commodity: z
      .string()
      .trim()
      .min(2, "Tell us what's shipping.")
      .max(120, "That entry is too long."),
    weight_lbs: z
      .string()
      .optional()
      .transform((v) => {
        const digits = (v ?? "").replace(/[,\s]/g, "");
        if (!/^\d+$/.test(digits)) return null;
        return Number(digits);
      })
      .refine((v) => v === null || (v > 0 && v <= 80000), {
        message: "Weight must be between 1 and 80,000 lbs.",
      }),
    pallets: optionalText(60),
    dims_l_in: optionalInt(1, 700, "Length must be 1–700 inches."),
    dims_w_in: optionalInt(1, 120, "Width must be 1–120 inches."),
    dims_h_in: optionalInt(1, 120, "Height must be 1–120 inches."),
    equipment: z.enum(QUOTE_EQUIPMENT, { message: "Choose the equipment." }),
    temp_controlled: z
      .string()
      .optional()
      .transform((v) => v === "on"),
    temp_min_f: optionalInt(-80, 120, "Temperature must be -80–120 °F."),
    temp_max_f: optionalInt(-80, 120, "Temperature must be -80–120 °F."),
    hazmat: z
      .string()
      .optional()
      .transform((v) => v === "on"),
    frequency: z.enum(QUOTE_FREQUENCIES, {
      message: "Choose the shipping frequency.",
    }),
    special_instructions: optionalText(1000),
    contact_name: z
      .string()
      .trim()
      .min(2, "Who should we call about this shipment?")
      .max(120, "That entry is too long."),
    phone: phoneField,
  })
  .refine(
    (v) =>
      v.pickup_date === null ||
      v.delivery_deadline === null ||
      v.delivery_deadline >= v.pickup_date,
    {
      message: "The delivery deadline can't be before the pickup date.",
      path: ["delivery_deadline"],
    },
  )
  .refine(
    (v) =>
      v.temp_min_f === null || v.temp_max_f === null || v.temp_min_f <= v.temp_max_f,
    {
      message: "Minimum temperature can't exceed the maximum.",
      path: ["temp_max_f"],
    },
  );

export type PortalQuoteInput = z.infer<typeof portalQuoteSchema>;
