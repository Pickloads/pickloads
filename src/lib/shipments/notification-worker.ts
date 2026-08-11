import "server-only";

import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { getRecipientByProfile, notifyCustomer } from "@/lib/notify";
import { sendEmail } from "@/lib/email/send";
import {
  isAddressSuppressed,
  readNotificationPreferences,
} from "@/lib/notification-preferences";
import {
  SHIPMENT_EMAIL_BUILDERS,
  inAppCopy,
} from "@/emails/shipment-templates";
import {
  decideSend,
  retryDelaySeconds,
  SHIPMENT_NOTIFICATION_MAP,
} from "@/lib/shipments/notification-rules";
import {
  claimShipmentNotifications,
  harvestShipmentNotifications,
  reportNotificationFailure,
  settleShipmentNotification,
  type ClaimedNotification,
  type SettlementOutcome,
} from "@/lib/shipments/notification-queue";

/**
 * M-79 — the background worker. §25's *"background notification processing
 * architecture prepared"*, which `docs/FINAL-IMPLEMENTATION-PLAN.md` §4
 * records the audit as having silently downgraded to two retry columns.
 *
 * ── THE LOOP, IN ORDER ────────────────────────────────────────────────────
 *
 *   1. HARVEST — map new `shipment_events` (and shipper `invoices`) onto queue
 *      rows, idempotently. One SQL call.
 *   2. CLAIM — take a bounded batch, marking each `sending` under a lock.
 *   3. DELIVER — per row: resolve the recipient, re-check preferences and the
 *      address suppression, build the localized template, send.
 *   4. SETTLE — write the append-only attempt row and move the queue row to
 *      sent / suppressed / retry-with-backoff / dead.
 *
 * ── WHAT IT REUSES ────────────────────────────────────────────────────────
 *
 * Delivery itself is M-60's, unchanged: `getRecipientByProfile` resolves the
 * address and the locale, `sendEmail` transmits and journals `email_log`, and
 * `notifyCustomer` writes the in-app feed row. This module adds durability
 * around them and nothing else. M-60's inline fan-out keeps serving every
 * non-shipment flow exactly as it did before this module existed.
 *
 * ── WHY PREFERENCES ARE CHECKED TWICE ─────────────────────────────────────
 *
 * The harvest checks them so an opted-out customer leaves no backlog. The
 * worker checks them again because that is the AUTHORITATIVE moment: a
 * customer who opts out while a row sits in the queue must not receive the row
 * that was already enqueued. §17 says "respect user preferences", not "respect
 * the preferences that were in force when we decided to write to you".
 *
 * ── WHY A SUPPRESSED ROW IS A SUCCESS ─────────────────────────────────────
 *
 * It settles as `suppressed`, a TERMINAL state, and is never retried. An
 * opt-out that showed up as a failure would be retried five times, would
 * appear on every failure dashboard, and would make an honoured request look
 * like an outage.
 */

/* ------------------------------------------------------------------ *
 * Result shape
 * ------------------------------------------------------------------ */

export interface WorkerRunSummary {
  ok: boolean;
  harvested: { scanned: number; enqueued: number };
  claimed: number;
  sent: number;
  suppressed: number;
  failed: number;
  dead: number;
  /** Non-fatal problems, already redacted. Surfaced for the route's JSON. */
  notes: string[];
}

const EMPTY: WorkerRunSummary = {
  ok: false,
  harvested: { scanned: 0, enqueued: 0 },
  claimed: 0,
  sent: 0,
  suppressed: 0,
  failed: 0,
  dead: 0,
  notes: [],
};

export const WORKER_BATCH = 25;

/* ------------------------------------------------------------------ *
 * One row
 * ------------------------------------------------------------------ */

interface DeliveryDecision {
  outcome: SettlementOutcome;
  providerMessageId: string | null;
  error: string | null;
}

/**
 * Deliver one claimed notification. NEVER THROWS — an exception here would
 * abandon the row in `sending` until the lock TTL, and the whole point of the
 * queue is that a failure is a recorded fact rather than a lost one.
 */
async function deliver(
  row: ClaimedNotification,
): Promise<DeliveryDecision> {
  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      outcome: "failed",
      providerMessageId: null,
      error: "service credentials unavailable",
    };
  }

  try {
    const recipient = await getRecipientByProfile(admin, row.recipientProfileId);
    if (!recipient) {
      // The profile is gone. Not a transient failure and not worth five
      // retries — there is nobody to write to and there never will be.
      return {
        outcome: "skipped",
        providerMessageId: null,
        error: "recipient profile no longer exists",
      };
    }

    const { prefs, token } = await readNotificationPreferences(
      admin,
      row.recipientProfileId,
    );
    const suppressed =
      row.channel === "email" && recipient.email
        ? await isAddressSuppressed(admin, recipient.email)
        : false;

    const decision = decideSend({
      channel: row.channel,
      prefs,
      email: recipient.email,
      addressSuppressed: suppressed,
    });
    if (!decision.send) {
      return {
        outcome: "suppressed",
        providerMessageId: null,
        error: decision.reason,
      };
    }

    if (row.channel === "in_app") {
      const copy = inAppCopy(
        recipient.locale,
        row.event,
        row.payload.tracking_number,
      );
      const result = await notifyCustomer({
        recipient,
        // The feed vocabulary has ONE definition (notification-rules.ts) and
        // is read from it rather than restated here.
        kind: SHIPMENT_NOTIFICATION_MAP[row.event].inAppKind,
        title: copy.title,
        body: copy.body,
        href: `/portal/shipper/shipments/${row.shipmentId}`,
      });
      return result.notification === "written"
        ? { outcome: "sent", providerMessageId: null, error: null }
        : {
            outcome: "failed",
            providerMessageId: null,
            error: `in-app write ${result.notification}`,
          };
    }

    const built = SHIPMENT_EMAIL_BUILDERS[row.event]({
      locale: recipient.locale,
      payload: row.payload,
      optOutToken: token,
    });
    const sent = await sendEmail({
      to: recipient.email as string,
      subject: built.subject,
      template: built.template,
      react: built.react,
    });

    if (sent.status === "sent") {
      return {
        outcome: "sent",
        providerMessageId: sent.providerMessageId,
        error: null,
      };
    }
    if (sent.status === "skipped") {
      // No RESEND_API_KEY. Nothing was transmitted, so `sent` would be a lie —
      // but retrying five times against a key that is still not there is
      // noise. Terminal, and the attempt row says exactly why.
      return {
        outcome: "skipped",
        providerMessageId: null,
        error: "email provider not configured",
      };
    }
    return {
      outcome: "failed",
      providerMessageId: sent.providerMessageId,
      error: sent.error,
    };
  } catch (err) {
    return {
      outcome: "failed",
      providerMessageId: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

/**
 * One worker pass: harvest, then process one bounded batch.
 *
 * BOUNDED on purpose (§25). A serverless invocation has a wall clock, and a
 * worker that tries to drain an unbounded backlog times out and settles
 * nothing — leaving every claimed row to the lock TTL. Twenty-five rows per
 * run, and the next run takes the next twenty-five.
 */
export async function runNotificationWorker(
  batch: number = WORKER_BATCH,
): Promise<WorkerRunSummary> {
  const summary: WorkerRunSummary = { ...EMPTY, notes: [] };

  const harvest = await harvestShipmentNotifications();
  if (harvest.ok) {
    summary.harvested = { scanned: harvest.scanned, enqueued: harvest.enqueued };
  } else {
    summary.notes.push(`harvest ${harvest.code}`);
    if (harvest.code === "not_configured") return summary;
  }

  const claimed = await claimShipmentNotifications(batch);
  if (!claimed.ok) {
    summary.notes.push(`claim ${claimed.code}`);
    return summary;
  }
  summary.claimed = claimed.rows.length;

  for (const row of claimed.rows) {
    const decision = await deliver(row);
    const retryAfter =
      decision.outcome === "failed" ? retryDelaySeconds(row.attempts) : null;

    if (decision.outcome === "failed") {
      summary.failed += 1;
      if (retryAfter === null) summary.dead += 1;
      // §26's named signal. The `detail` goes through M-72's redactor, so a
      // provider error string carrying a bearer token is dropped whole.
      reportNotificationFailure({
        code: `deliver:${row.event}:${row.channel}`,
        shipmentId: row.shipmentId,
        trackingNumber: row.payload.tracking_number ?? null,
        detail: decision.error,
      });
    } else if (decision.outcome === "sent") {
      summary.sent += 1;
    } else {
      summary.suppressed += 1;
    }

    const settled = await settleShipmentNotification({
      id: row.id,
      outcome: decision.outcome,
      providerMessageId: decision.providerMessageId,
      error: decision.error,
      retryAfterSeconds: retryAfter,
    });
    if (!settled.ok) summary.notes.push(`settle ${settled.code}`);
  }

  summary.ok = true;
  return summary;
}
