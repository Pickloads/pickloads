import { z } from "zod";
import { localeField, optionalText, phoneField } from "./shared";

/**
 * Quick lead form ("Need a dispatcher?") + M-26 New Authority funnel.
 * Phone is the only required field — matches the approved V4 form exactly
 * (audit F-12: no auto-reply; internal notification only, decision Q6).
 * Select values are canonical English (DB rows stay locale-independent).
 * M-26: `lead_type` distinguishes the /start-your-trucking-company funnel
 * (defaults to `dispatch`, never fails); name/email are optional extras
 * collected there.
 */
export const carrierLeadSchema = z.object({
  lead_type: z.enum(["dispatch", "new_authority"]).catch("dispatch"),
  full_name: optionalText(120),
  email: z
    .union([z.literal(""), z.email("Enter a valid email address.").max(254)])
    .optional()
    .transform((v) => (v ? v : null)),
  truck_type: optionalText(40),
  trailer_type: optionalText(40),
  home_state: optionalText(40),
  truck_count: optionalText(10),
  /** M-26 only: self-reported launch stage — journaled as a lead_activities
   *  note, NOT a carrier_leads column (schema is final). */
  stage: optionalText(60),
  phone: phoneField,
  locale: localeField,
});

export type CarrierLeadInput = z.infer<typeof carrierLeadSchema>;
