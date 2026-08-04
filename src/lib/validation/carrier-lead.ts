import { z } from "zod";
import { localeField, optionalText, phoneField } from "./shared";

/**
 * Quick lead form ("Need a dispatcher?"). Phone is the only required field —
 * matches the approved V4 form exactly (audit F-12: no email on this form, so
 * no auto-reply; internal notification only, decision Q6).
 * Select values are canonical English (DB rows stay locale-independent).
 */
export const carrierLeadSchema = z.object({
  truck_type: optionalText(40),
  trailer_type: optionalText(40),
  home_state: optionalText(40),
  truck_count: optionalText(10),
  phone: phoneField,
  locale: localeField,
});

export type CarrierLeadInput = z.infer<typeof carrierLeadSchema>;
