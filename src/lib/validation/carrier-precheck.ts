import { z } from "zod";
import { emailField, localeField } from "./shared";

/**
 * M-94 §2 — the public carrier pre-check form.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────
 *
 * EIN, home state, factoring company, insurance expiry, phone, password. §2
 * says "do NOT collect unnecessary sensitive information here", and this
 * screen runs BEFORE anything is verified and BEFORE any account exists —
 * which means every field on it is a field an anonymous stranger can post at
 * us five times per ten minutes. The only inputs are the three the FMCSA
 * check actually consumes, plus the address we need to reach an applicant
 * whose file goes to manual review.
 *
 * ── NORMALISATION HAPPENS HERE, COMPARISON HAPPENS IN M-93 ───────────────
 *
 * The transforms below only put the submitted values into the canonical
 * shape M-93 expects (`normalizeRegistrationNumber` — digits, leading zeros
 * stripped). They never decide anything. The entered strings are preserved
 * separately and stored verbatim, because 0032's whole evidence model rests
 * on "what they typed" and "what FMCSA returned" being two different columns.
 */

/** Digits only, leading zeros stripped — the M-93 canonical form. */
function digits(raw: string): string {
  return raw.replace(/\D+/g, "").replace(/^0+/, "");
}

/**
 * USDOT.
 *
 * REQUIRED, because it is the lookup key: without it there is no FMCSA record
 * to check and the screen has nothing to do. Length is bounded at 8 digits —
 * FMCSA's issued range is well below that today and an unbounded field is a
 * free-text field with a numeric costume.
 */
export const usdotField = z
  .string()
  .trim()
  .min(1, "Enter your USDOT number.")
  .max(20, "That entry is too long.")
  .transform(digits)
  .refine((v) => v.length >= 1 && v.length <= 8, {
    message: "Enter a valid USDOT number (digits only).",
  });

/**
 * MC.
 *
 * OPTIONAL, and that is a decision worth stating: §2 asks for it and §6 makes
 * the MC↔USDOT relationship non-negotiable, but §7 also forbids automatically
 * rejecting legitimate carriers unless an existing M-93 rule requires it — and
 * a purely intrastate or exempt carrier legitimately holds no MC docket at
 * all. M-93 already has the right answer for that case: `matchDocketRelationship`
 * returns `unavailable`, the risk engine records `MC_NOT_PROVIDED` /
 * `MC_DOT_RELATIONSHIP_UNVERIFIED` and routes to MANUAL_REVIEW.
 *
 * So a blank MC costs the applicant a human review; it does not refuse them at
 * the form, which is a verdict this screen has no basis to reach. A SUBMITTED
 * MC is still checked with full prefix-aware strictness — FF and MX never
 * satisfy it (§6).
 *
 * "MC123456", "MC-123456", "mc 123456" and "123456" are the same docket.
 */
export const mcField = z
  .union([
    z.literal(""),
    z
      .string()
      .trim()
      .max(20, "That entry is too long.")
      .refine((v) => /^(mc[\s-]?)?\d{1,8}$/i.test(v.trim()), {
        message: "Enter a valid MC number, e.g. MC-123456.",
      }),
  ])
  .optional()
  .transform((v) => {
    if (!v) return null;
    const d = digits(v);
    return d === "" ? null : d;
  });

export const carrierPrecheckSchema = z.object({
  legal_name: z
    .string()
    .trim()
    .min(2, "Enter your legal company name.")
    .max(120, "That entry is too long."),
  usdot_number: usdotField,
  mc_number: mcField,
  email: emailField,
  locale: localeField,
});

export type CarrierPrecheckInput = z.infer<typeof carrierPrecheckSchema>;
