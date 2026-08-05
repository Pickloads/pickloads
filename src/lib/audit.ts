import "server-only";

import { headers } from "next/headers";
import { tryCreateAdminClient } from "@/lib/supabase/admin";

/**
 * M-61 — one writer for the `audit_events` ledger (audit §6.2).
 *
 * Before this module every mutating staff action hand-rolled its own insert
 * (M-58 pattern) and three sensitive actions had no journal entry at all
 * (document review, company-settings edits, invoice generation) — see
 * docs/SECURITY-REVIEW.md for the coverage table.
 *
 * Contract:
 *   * service-role only — 0009 grants staff SELECT on audit_events and NO
 *     insert policy to anyone, so a browser session can never forge a row
 *     (asserted by the RLS suite, both for staff and admin sessions);
 *   * best effort — a failed journal write is logged loudly but never rolls
 *     back the action the operator already performed;
 *   * never carries secrets. `detail` is for identifiers and decisions
 *     (status, reason, document type); never tokens, EIN plaintext, signed
 *     URLs or file contents.
 */

export interface AuditEventInput {
  actorId: string | null;
  action: string;
  targetTable?: string | null;
  targetId?: string | null;
  detail?: Record<string, unknown> | null;
}

async function callerIp(): Promise<string | null> {
  try {
    const h = await headers();
    return (
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      null
    );
  } catch {
    return null;
  }
}

export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  const admin = tryCreateAdminClient();
  if (!admin) return; // secretless dev/preview — nothing to journal against
  const { error } = await admin.from("audit_events").insert({
    actor_id: input.actorId,
    action: input.action,
    target_table: input.targetTable ?? null,
    target_id: input.targetId ?? null,
    detail: (input.detail ?? null) as never,
    ip: await callerIp(),
  });
  if (error) {
    console.error(`[audit] ${input.action} journal failed`, error.message);
  }
}
