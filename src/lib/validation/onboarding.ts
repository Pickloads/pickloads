import { z } from "zod";
import { emailField, localeField, optionalText, phoneField } from "./shared";

/**
 * M-20 become-a-carrier wizard schemas.
 * Step 1 — company info. EIN is optional (many owner-operators use SSN with
 * their factoring company and provide the W-9 instead); when present it is
 * encrypted before storage (S-01, src/lib/crypto.ts).
 */
export const onboardingInfoSchema = z.object({
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
  mc_number: optionalText(20),
  dot_number: optionalText(20),
  home_state: optionalText(40),
  factoring_company: optionalText(120),
  ein: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .regex(/^\d{2}-?\d{7}$/, "EIN format: 12-3456789"),
    ])
    .optional()
    .transform((v) => (v ? v : null)),
  insurance_expiry: z
    .union([
      z.literal(""),
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date."),
    ])
    .optional()
    .transform((v) => (v ? v : null)),
  locale: localeField,
});

export type OnboardingInfoInput = z.infer<typeof onboardingInfoSchema>;

/** Step 2 — server-side upload request validation (S-03). */
export const DOC_TYPES = ["mc_authority", "coi", "w9", "voided_check"] as const;

/** M-25 portal replacements accept two extra types beyond the wizard four. */
export const UPLOADABLE_DOC_TYPES = [...DOC_TYPES, "noa", "other"] as const;

export const uploadRequestSchema = z.object({
  carrier_id: z.uuid("Invalid onboarding session."),
  doc_type: z.enum(UPLOADABLE_DOC_TYPES),
});

/** Step 4 — account creation. */
export const onboardingAccountSchema = z.object({
  carrier_id: z.uuid("Invalid onboarding session."),
  email: emailField,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(72, "Password is too long."),
  full_name: z.string().trim().min(2).max(120),
  phone: phoneField,
  company_name: z.string().trim().min(2).max(120),
  esign_consent: z.literal("on", "ESIGN consent is required."),
  locale: localeField,
});
