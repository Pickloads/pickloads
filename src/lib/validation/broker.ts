import { z } from "zod";

import {
  emailField,
  optionalPhoneField,
  optionalText,
} from "@/lib/validation/shared";

/**
 * M-81 — broker-partner admin and invitation schemas (§3, §12).
 *
 * ── THE §3 GUARANTEE, RESTATED AS A SCHEMA PROPERTY ──────────────────────
 *
 * §3: *"Do not allow public self-registration as a broker partner without
 * admin approval."* M-52/M-53 made the equivalent guarantee for carriers and
 * shippers by leaving `role` out of the schema entirely — Zod strips unknown
 * keys, so a forged `role` in the POST body cannot reach the database
 * (`tests/unit/account.test.ts`, the "strips a forged role key" cases).
 *
 * The same discipline applies here and one step further: **no schema in this
 * file has a `role` field, a `verification_status` field, an `active` field
 * or a `broker_partner_id` field on the public path.** The invitee supplies a
 * name and a password; the ORGANIZATION they join and the ROLE they receive
 * come from the invite row the admin created, which is looked up by token
 * hash server-side. There is no input a browser can send that names either
 * one.
 *
 * `tests/unit/shipment-broker-permissions.test.ts` asserts every one of those
 * absences, including forged `role: "broker"` against the two PUBLIC signup
 * schemas — because the strongest statement of "no public signup path reaches
 * the broker role" is a test over the schemas that public signup actually
 * uses.
 */

/* ------------------------------------------------------------------ *
 * Admin: create / edit a broker organization (§12 + plan §9.3 vetting)
 * ------------------------------------------------------------------ */

export const brokerPartnerSchema = z.object({
  company_name: z
    .string()
    .trim()
    .min(2, "Enter the partner's company name.")
    .max(160, "That entry is too long."),
  mc_number: optionalText(20),
  dot_number: optionalText(20),
  contact_name: optionalText(120),
  contact_email: z
    .union([z.literal(""), emailField])
    .optional()
    .transform((v) => (v ? v : null)),
  contact_phone: optionalPhoneField,
  /* Plan §9.3's vetting checklist. Recorded, never scored (§30). */
  bond_provider: optionalText(160),
  bond_amount_usd: z
    .union([z.literal(""), z.coerce.number().min(0).max(100_000_000)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  authority_since: z
    .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")])
    .optional()
    .transform((v) => (v ? v : null)),
  days_to_pay: z
    .union([z.literal(""), z.coerce.number().int().min(0).max(365)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  notes: optionalText(4000),
});

export type BrokerPartnerInput = z.infer<typeof brokerPartnerSchema>;

const uuidField = z.uuid("That record id is not valid.");

/* ------------------------------------------------------------------ *
 * Admin: verification (§12 "verified")
 * ------------------------------------------------------------------ */

export const verifyBrokerPartnerSchema = z.object({
  broker_partner_id: uuidField,
  /* A checkbox, so an unchecked box is an explicit "suspend", never a
     silent no-op. The form posts the value on both paths. */
  verified: z.enum(["true", "false"]).transform((v) => v === "true"),
  note: optionalText(500),
});

/* ------------------------------------------------------------------ *
 * Admin: invitations (§12 "invited by an admin")
 * ------------------------------------------------------------------ */

export const brokerInviteSchema = z.object({
  broker_partner_id: uuidField,
  email: emailField,
  membership_role: z
    .enum(["owner", "member"], { message: "Choose a membership role." })
    .default("owner"),
});

export const revokeBrokerInviteSchema = z.object({
  invite_id: uuidField,
});

/**
 * The PUBLIC accept action's input.
 *
 * Exactly M-58's three fields and no fourth. The token is the credential; the
 * organization and the role are read from the invite row. A `broker_partner_id`
 * here would be a value the browser could choose, which is the whole shape §3
 * forbids.
 */
export const acceptBrokerInviteSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/, "This invite link is invalid."),
  full_name: z
    .string()
    .trim()
    .min(2, "Enter your full name.")
    .max(120, "That entry is too long."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(72, "Password is too long."),
});

/* ------------------------------------------------------------------ *
 * Admin/dispatcher: §12's two grant shapes
 * ------------------------------------------------------------------ */

export const grantBrokerShipmentSchema = z.object({
  shipment_id: uuidField,
  broker_partner_id: uuidField,
  note: optionalText(500),
});

export const revokeBrokerShipmentSchema = z.object({
  grant_id: uuidField,
  reason: optionalText(500),
});

export const brokerAgreementSchema = z.object({
  broker_partner_id: uuidField,
  shipper_id: uuidField,
  agreement_reference: optionalText(160),
  ends_at: z
    .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")])
    .optional()
    .transform((v) => (v ? v : null)),
});

export const revokeBrokerAgreementSchema = z.object({
  agreement_id: uuidField,
  reason: optionalText(500),
});

/** §12's invitations expire; seven days matches M-58's staff link. */
export const BROKER_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** §25: the admin list is bounded like every other list in the product. */
export const BROKER_PARTNER_PAGE_SIZE = 50;
