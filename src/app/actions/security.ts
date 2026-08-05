"use server";

import { z } from "zod";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionProfile, isStaffRole } from "@/lib/auth";

/**
 * M-61 — security journal entries raised from the client MFA surface.
 *
 * The factor itself is created by Supabase Auth against the caller's own
 * user, so there is nothing for the app to authorize; what the app owes the
 * operator is a trail. This action re-derives the session server-side (the
 * client argument is never trusted for identity) and writes one audit row.
 */

const eventSchema = z.enum(["enrolled", "verified"]);

export async function recordMfaEnrollment(kind: string): Promise<void> {
  const parsed = eventSchema.safeParse(kind);
  if (!parsed.success) return;

  const session = await getSessionProfile();
  if (!session || !isStaffRole(session.role)) return;

  await recordAuditEvent({
    actorId: session.userId,
    action: parsed.data === "enrolled" ? "staff.mfa_enrolled" : "staff.mfa_verified",
    targetTable: "profiles",
    targetId: session.userId,
    detail: { role: session.role },
  });
}
