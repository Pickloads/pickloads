import { z } from "zod";
import { emailField } from "./shared";

/** M-58 — admin account-management schemas. */

export const accountStatusSchema = z
  .object({
    profile_id: z.uuid("Invalid user."),
    action: z.enum(["approve", "suspend", "reactivate"], {
      message: "Invalid action.",
    }),
    reason: z
      .string()
      .trim()
      .max(500, "Keep the reason under 500 characters.")
      .optional()
      .transform((v) => (v ? v : null)),
  })
  .refine((v) => v.action !== "suspend" || v.reason !== null, {
    message: "A suspension needs a reason — the customer will ask why.",
    path: ["reason"],
  });

export const assignDispatcherSchema = z.object({
  carrier_id: z.uuid("Invalid carrier."),
  /** Empty string = unassign. */
  dispatcher_id: z
    .union([z.literal(""), z.uuid("Invalid dispatcher.")])
    .transform((v) => (v ? v : null)),
});

/** Only the two staff roles are invitable (DB CHECK mirrors this). */
export const staffInviteSchema = z.object({
  email: emailField,
  role: z.enum(["admin", "dispatcher"], { message: "Choose a staff role." }),
});

export const acceptInviteSchema = z.object({
  token: z
    .string()
    .regex(/^[0-9a-f]{64}$/, "This invite link is invalid."),
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

export const USERS_PAGE_SIZE = 50;
export const AUDIT_PAGE_SIZE = 50;

export function parsePage(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : 1;
}
