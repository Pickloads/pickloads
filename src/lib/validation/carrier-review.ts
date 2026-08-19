import { z } from "zod";

/**
 * M-94 — the staff manual-review decision.
 *
 * ── WHAT THIS SCHEMA CANNOT EXPRESS, ON PURPOSE ──────────────────────────
 *
 * There is no `active`, no `approved`, no `verification_status`, no
 * `risk_tier`, no `payment_status` and no `expires_at`. A reviewer resolves
 * ONE thing — whether this applicant may continue past the gate — and every
 * other piece of state either belongs to the provider (what FMCSA said), to
 * the engine (the risk tier and its reason codes) or to a later milestone
 * (payment, activation). A form field for any of them would be a way to write
 * a fact nobody established.
 *
 * `verification_status` is the sharpest of those. A dispatcher clearing an
 * applicant after an FMCSA outage has not made FMCSA answer, and letting a
 * human stamp "verified" would erase the difference between "the authority
 * confirmed this carrier" and "somebody decided it was probably fine".
 */

/**
 * The two outcomes a reviewer may reach.
 *
 * `clear` sets the pre-registration to `eligible_to_continue` — eligible to
 * PAY and upload documents, which is what that value has always meant. It is
 * not approval, it does not activate anything, and
 * `evaluateActivationEligibility()` still has to pass in full afterwards.
 */
export const REVIEW_OUTCOMES = ["clear", "refuse"] as const;
export type ReviewOutcome = (typeof REVIEW_OUTCOMES)[number];

export const carrierReviewSchema = z.object({
  pre_registration_id: z.uuid("Invalid pre-registration."),
  outcome: z.enum(REVIEW_OUTCOMES, "Choose an outcome."),
  /**
   * REQUIRED, and with a floor.
   *
   * A cleared carrier who later turns out to be a problem generates exactly
   * one question — "why did we let this through?" — and "ok" is not an answer
   * anyone can act on six months later. Twelve characters is not a quality
   * bar; it is enough to stop a reflexive keypress becoming the permanent
   * record of a decision that overrode an automated refusal.
   */
  note: z
    .string()
    .trim()
    .min(12, "Say why — this is the permanent record of the decision.")
    .max(1000, "Keep the note under 1000 characters."),
});

export type CarrierReviewInput = z.infer<typeof carrierReviewSchema>;

/**
 * M-94 — adopting a pre-M-94 `carriers` row into the gate.
 *
 * The email is the one field an applicant would have typed and the old
 * `carriers` table has no column for. The USDOT is optional here because the
 * old wizard made it optional too: many legacy rows have none, and the
 * reviewer has to be able to supply the number the carrier gives them.
 *
 * There is no `decision`, no `outcome` and no `skip_check`. Adoption RUNS the
 * pre-check; it does not stand in for it.
 */
export const legacyAdoptionSchema = z.object({
  carrier_id: z.uuid("Invalid carrier."),
  email: z.email("Enter the applicant's email address.").trim().max(254),
  usdot_number: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .max(20, "That entry is too long.")
        .refine((v) => /^\d{1,8}$/.test(v.replace(/\D+/g, "").replace(/^0+/, "")), {
          message: "Enter a valid USDOT number (digits only).",
        }),
    ])
    .optional()
    .transform((v) => {
      if (!v) return null;
      const d = v.replace(/\D+/g, "").replace(/^0+/, "");
      return d === "" ? null : d;
    }),
});

export type LegacyAdoptionInput = z.infer<typeof legacyAdoptionSchema>;
