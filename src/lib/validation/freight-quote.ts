import { z } from "zod";
import {
  emailField,
  localeField,
  optionalPhoneField,
  optionalText,
} from "./shared";

const zipField = z
  .union([z.literal(""), z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Enter a 5-digit ZIP code.")])
  .optional()
  .transform((v) => (v ? v : null));

/** "42,000" → 42000; empty/garbage → null; sanity-capped at 80k lbs gross. */
const weightField = z
  .string()
  .optional()
  .transform((v) => {
    const digits = (v ?? "").replace(/[,\s]/g, "");
    if (!/^\d+$/.test(digits)) return null;
    return Number(digits);
  })
  .refine((v) => v === null || (v > 0 && v <= 80000), {
    message: "Weight must be between 1 and 80,000 lbs.",
  });

/** U-06: pickup date can't be in the past (UTC-day granularity). */
const pickupDateField = z
  .union([z.literal(""), z.iso.date("Enter a valid pickup date.")])
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || v >= new Date().toISOString().slice(0, 10), {
    message: "Pickup date can't be in the past.",
  });

export const freightQuoteSchema = z.object({
  pickup_zip: zipField,
  delivery_zip: zipField,
  pickup_date: pickupDateField,
  commodity: optionalText(120),
  weight_lbs: weightField,
  pallets: optionalText(60),
  equipment: optionalText(40),
  frequency: optionalText(40),
  company_name: optionalText(120),
  email: emailField,
  phone: optionalPhoneField,
  locale: localeField,
});

export type FreightQuoteInput = z.infer<typeof freightQuoteSchema>;
