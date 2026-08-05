import "server-only";

import { tryCreateAdminClient } from "@/lib/supabase/admin";
import {
  normalizeUnsubscribeToken,
  type UnsubscribeOutcome,
} from "@/lib/newsletter";

/**
 * M-69 / P-1 — the single place `subscribers.unsubscribed_at` is written.
 *
 * Shared by the human page's server action and the RFC 8058 one-click route
 * handler so both honour identical semantics:
 *
 *   * IDEMPOTENT. A second (third, hundredth) request for an already
 *     unsubscribed address returns `already`, which callers treat as
 *     success. Mailbox providers retry one-click POSTs and corporate link
 *     scanners replay them; a 4xx/"error" on repeat would look like a broken
 *     opt-out to a compliance auditor and to the provider's reputation
 *     scoring alike.
 *   * NEVER unsubscribes on a bare GET. Scanners (Outlook Safe Links,
 *     Proofpoint, Barracuda) prefetch every URL in an email; a GET-side
 *     effect silently unsubscribes people who never clicked. The GET page
 *     only READS, and the state change requires a POST.
 *   * Token-only. The URL carries no email address, so the endpoint answers
 *     nothing about whether an address is on the list.
 *   * Honest without env. No service-role key ⇒ `unavailable`, surfaced as a
 *     "we couldn't reach the list right now, mail support@" state — never a
 *     fake success that leaves a real address subscribed.
 */

export interface UnsubscribeLookup {
  /** Masked for display; the full address is never rendered from a token. */
  maskedEmail: string;
  alreadyUnsubscribed: boolean;
}

/**
 * Show enough of the address that the recipient recognises which of their
 * mailboxes is being removed, without turning a leaked/forwarded link into
 * an address disclosure.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, 1);
  const tail = local.length > 2 ? local.slice(-1) : "";
  return `${head}${"•".repeat(Math.max(1, local.length - 1 - tail.length))}${tail}@${domain}`;
}

/**
 * READ-ONLY. Safe to call from a GET render — this is what makes the
 * "scanner prefetches the link" case harmless.
 */
export async function lookupUnsubscribe(
  rawToken: unknown,
): Promise<UnsubscribeLookup | "invalid" | "unavailable"> {
  const token = normalizeUnsubscribeToken(rawToken);
  if (!token) return "invalid";

  const admin = tryCreateAdminClient();
  if (!admin) return "unavailable";

  try {
    const { data, error } = await admin
      .from("subscribers")
      .select("email, unsubscribed_at")
      .eq("unsubscribe_token", token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return "invalid";
    return {
      maskedEmail: maskEmail(data.email),
      alreadyUnsubscribed: data.unsubscribed_at !== null,
    };
  } catch (err) {
    console.error("[newsletter] unsubscribe lookup failed", err);
    return "unavailable";
  }
}

/** WRITE. Only ever reached from a POST (server action or one-click route). */
export async function applyUnsubscribe(
  rawToken: unknown,
): Promise<UnsubscribeOutcome> {
  const token = normalizeUnsubscribeToken(rawToken);
  if (!token) return "invalid";

  const admin = tryCreateAdminClient();
  if (!admin) return "unavailable";

  try {
    const { data, error } = await admin
      .from("subscribers")
      .select("id, unsubscribed_at")
      .eq("unsubscribe_token", token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return "invalid";
    if (data.unsubscribed_at) return "already";

    const { error: updateError } = await admin
      .from("subscribers")
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq("id", data.id);
    if (updateError) throw new Error(updateError.message);
    return "unsubscribed";
  } catch (err) {
    console.error("[newsletter] unsubscribe failed", err);
    return "unavailable";
  }
}
