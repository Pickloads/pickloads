import { z } from "zod";
import { emailField, optionalPhoneField, optionalText } from "./shared";

/**
 * M-55 — trucks & drivers CRUD schemas (carrier portal, RLS-scoped writes).
 * Equipment stays in lock-step with the 8 public equipment slugs
 * (src/content/equipment.ts) — same display labels the loads board uses.
 */

export const FLEET_EQUIPMENT = [
  "Dry Van",
  "Reefer",
  "Flatbed",
  "Step Deck",
  "Power Only",
  "Hot Shot",
  "Box Truck",
  "Sprinter Van",
] as const;

export type FleetEquipment = (typeof FLEET_EQUIPMENT)[number];

const uuidField = z.uuid("Invalid record.");

/** Present-or-null uuid (empty string → null → INSERT instead of UPDATE). */
const optionalUuid = z
  .union([z.literal(""), uuidField])
  .optional()
  .transform((v) => (v ? v : null));

const yearField = z
  .string()
  .optional()
  .transform((v) => {
    const digits = (v ?? "").trim();
    if (!/^\d{4}$/.test(digits)) return null;
    return Number(digits);
  })
  .refine((v) => v === null || (v >= 1980 && v <= 2030), {
    message: "Truck year must be between 1980 and 2030.",
  });

/** Optional ISO date (native <input type="date">) → string | null. */
const optionalDate = z
  .union([z.literal(""), z.iso.date("Enter a valid date.")])
  .optional()
  .transform((v) => (v ? v : null));

export const truckSchema = z.object({
  id: optionalUuid,
  unit_number: optionalText(20),
  equipment: z.enum(FLEET_EQUIPMENT, { message: "Choose the equipment type." }),
  year: yearField,
  make: optionalText(40),
  model: optionalText(40),
  vin: optionalText(20),
  plate: optionalText(12),
  plate_state: optionalText(20),
  active: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
});

export type TruckInput = z.infer<typeof truckSchema>;

export const driverSchema = z.object({
  id: optionalUuid,
  full_name: z
    .string()
    .trim()
    .min(2, "Enter the driver's full name.")
    .max(120, "That entry is too long."),
  phone: optionalPhoneField,
  email: z
    .union([z.literal(""), emailField])
    .optional()
    .transform((v) => (v ? v : null)),
  cdl_number: optionalText(24),
  cdl_state: optionalText(20),
  cdl_expiry: optionalDate,
  medical_card_expiry: optionalDate,
  active: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
});

export type DriverInput = z.infer<typeof driverSchema>;

export const deleteFleetSchema = z.object({ id: uuidField });
