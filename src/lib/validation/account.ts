import { z } from "zod";
import { emailField, localeField, optionalText, phoneField } from "./shared";

/**
 * M-52/M-53 — public /create-account schemas.
 *
 * SECURITY (audit §6.4/§6.5): these schemas deliberately contain NO role
 * field — the branch (carrier action vs shipper action) decides the role
 * server-side, and Zod strips unknown keys, so a forged `role` in the POST
 * body can never reach the database. The signup trigger defaults to
 * 'carrier'; the shipper action promotes via the service role only.
 */

/** Directive authority-status routing (M-52). */
export const AUTHORITY_STATUSES = [
  "active", // MC authority active → straight to onboarding
  "pending", // FMCSA application filed, not yet granted → pending state
  "none", // no authority yet, needs help → new_authority funnel
  "leased_on", // running under someone else's authority → manual review
] as const;

export type AuthorityStatus = (typeof AUTHORITY_STATUSES)[number];

const passwordField = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password is too long.");

export const createCarrierAccountSchema = z
  .object({
    company_name: z
      .string()
      .trim()
      .min(2, "Enter your company name.")
      .max(120, "That entry is too long."),
    full_name: z
      .string()
      .trim()
      .min(2, "Enter your full name.")
      .max(120, "That entry is too long."),
    email: emailField,
    phone: phoneField,
    authority_status: z.enum(AUTHORITY_STATUSES, {
      message: "Choose your authority status.",
    }),
    mc_number: optionalText(20),
    dot_number: optionalText(20),
    home_state: optionalText(40),
    password: passwordField,
    locale: localeField,
  })
  .refine((v) => v.authority_status !== "active" || v.mc_number !== null, {
    message: "Enter your MC number (it's on your FMCSA authority letter).",
    path: ["mc_number"],
  });

export type CreateCarrierAccountInput = z.infer<
  typeof createCarrierAccountSchema
>;

/** M-53 — directive shipper fields (industry / frequency / regions). */
export const SHIPPING_FREQUENCIES = [
  "one_time",
  "weekly",
  "monthly",
  "seasonal",
] as const;

export const createShipperAccountSchema = z.object({
  company_name: z
    .string()
    .trim()
    .min(2, "Enter your company name.")
    .max(120, "That entry is too long."),
  full_name: z
    .string()
    .trim()
    .min(2, "Enter your full name.")
    .max(120, "That entry is too long."),
  email: emailField,
  phone: phoneField,
  industry: optionalText(80),
  shipping_frequency: z
    .enum(SHIPPING_FREQUENCIES)
    .optional()
    .catch(undefined)
    .transform((v) => v ?? null),
  /** Comma/checkbox regions → trimmed non-empty list (≤ 12 entries). */
  regions: z
    .string()
    .max(400, "That entry is too long.")
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean)
        .slice(0, 12),
    ),
  password: passwordField,
  locale: localeField,
});

export type CreateShipperAccountInput = z.infer<
  typeof createShipperAccountSchema
>;
