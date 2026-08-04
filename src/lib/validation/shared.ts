import { z } from "zod";

/** Locale column value — never fails, defaults to "en" (arch §2 locales). */
export const localeField = z.enum(["en", "es", "fr", "ru", "ht"]).catch("en");

/** Loose US-phone shape matching the "(___) ___-____" mask promise (U-06). */
export const phoneField = z
  .string()
  .trim()
  .regex(/^[+()\-.\s\d]{7,20}$/, "Enter a valid phone number.");

export const optionalPhoneField = z
  .union([z.literal(""), phoneField])
  .optional()
  .transform((v) => (v ? v : null));

export const emailField = z
  .email("Enter a valid email address.")
  .trim()
  .max(254);

/** Optional free-text input → trimmed string or null (nullable DB columns). */
export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, "That entry is too long.")
    .optional()
    .transform((v) => (v ? v : null));
}

export function firstIssueMessage(error: z.ZodError): string {
  return (
    error.issues[0]?.message ?? "Please double-check your info and try again."
  );
}
