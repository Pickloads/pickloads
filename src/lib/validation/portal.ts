import { z } from "zod";
import { optionalPhoneField, optionalText } from "./shared";

/**
 * M-55 — carrier/shipper portal self-service schemas: contact info, dispatch
 * preferences (decision D5 self-serve set), regulated-field change requests,
 * support threads and account settings. All consumed by authenticated server
 * actions — RLS re-checks every write (defense in depth).
 */

export const contactInfoSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(2, "Enter your full name.")
    .max(120, "That entry is too long."),
  phone: optionalPhoneField,
});

export const dispatchPreferencesSchema = z.object({
  preferred_lanes: optionalText(400),
  home_time_notes: optionalText(400),
});

/** Decision D5: the regulated set stays staff-verified via change request. */
export const REGULATED_FIELDS = [
  "mc_number",
  "dot_number",
  "ein",
  "insurance",
  "factoring",
  "other",
] as const;

export type RegulatedField = (typeof REGULATED_FIELDS)[number];

export const REGULATED_FIELD_LABELS: Record<RegulatedField, string> = {
  mc_number: "MC number",
  dot_number: "USDOT number",
  ein: "EIN / tax info",
  insurance: "Insurance / COI",
  factoring: "Factoring company",
  other: "Other regulated detail",
};

export const changeRequestSchema = z.object({
  field: z.enum(REGULATED_FIELDS, { message: "Choose what needs to change." }),
  message: z
    .string()
    .trim()
    .min(10, "Describe the change (at least 10 characters).")
    .max(2000, "Keep the request under 2,000 characters."),
});

export const supportThreadSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(3, "Give your message a subject.")
    .max(140, "Keep the subject under 140 characters."),
  body: z
    .string()
    .trim()
    .min(5, "Write your message (at least 5 characters).")
    .max(5000, "Messages are capped at 5,000 characters."),
});

export const supportReplySchema = z.object({
  thread_id: z.uuid("Invalid conversation."),
  body: z
    .string()
    .trim()
    .min(2, "Write your message.")
    .max(5000, "Messages are capped at 5,000 characters."),
});

/** M-56 — shipper company settings (self-serve; nothing regulated here). */
export const shipperCompanySchema = z.object({
  company_name: z
    .string()
    .trim()
    .min(2, "Enter your company name.")
    .max(120, "That entry is too long."),
  industry: optionalText(80),
  shipping_frequency: optionalText(40),
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
  phone: optionalPhoneField,
  billing_email: z
    .union([z.literal(""), z.email("Enter a valid email address.").trim().max(254)])
    .optional()
    .transform((v) => (v ? v : null)),
});

export const accountPreferencesSchema = z.object({
  preferred_language: z.enum(["en", "es", "fr", "ru", "ht"], {
    message: "Choose a language.",
  }),
  email_load_updates: z
    .string()
    .optional()
    .transform((v) => v === "on"),
  email_document_reviews: z
    .string()
    .optional()
    .transform((v) => v === "on"),
  email_marketing: z
    .string()
    .optional()
    .transform((v) => v === "on"),
});
