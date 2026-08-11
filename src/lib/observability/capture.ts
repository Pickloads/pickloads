import * as Sentry from "@sentry/nextjs";

import type { ShipmentSignalRecord } from "@/lib/shipments/observability";

/**
 * M-84b — the §26 signal transport.
 *
 * WHY A SEPARATE FILE FROM `observability.ts`. That module is imported by the
 * transition engine, the public lookup and the notification worker — code
 * paths that must stay pure and cheap to unit-test. Keeping the SDK import
 * here means the 1,594-test unit lane never loads Sentry, and the signal
 * vocabulary stays a plain data structure that anything can build.
 *
 * SEVERITY, DELIBERATELY ASSIGNED. All nine signals are failures, but they are
 * not equally urgent. A provider timeout is operational noise to review daily;
 * an unauthorized-access attempt is someone probing the system. Mapping them
 * to different Sentry levels is what stops the important one being buried.
 *
 * FINGERPRINTING. Sentry groups by stack trace, which for a captured *message*
 * is nearly useless — every signal from the same helper would collapse into
 * one issue. Grouping on `scope + signal + code` gives one issue per genuine
 * failure mode, which is what an operator wants to triage.
 *
 * WHAT IS ATTACHED, AND WHAT IS NOT. Only the record's own fields, which are
 * already an allow-list built by `buildShipmentSignal` and already swept by
 * `redactDetail`. `scrubEvent` then runs over the whole event as a second,
 * independent pass — belt and braces, because this is the one place where a
 * mistake ships data off the platform.
 */

/** §26 signals ranked by what an operator should do about them tonight. */
const SIGNAL_LEVEL: Record<ShipmentSignalRecord["signal"], Sentry.SeverityLevel> =
  {
    // Someone is probing. Look now.
    unauthorized_access_attempt: "error",
    repeated_invalid_tracking_attempts: "warning",

    // A customer is looking at a broken page, or an operator at a failed write.
    public_tracking_failure: "error",
    status_update_error: "error",
    document_download_error: "error",

    // Asynchronous work that retries; review in aggregate, not per event.
    notification_failure: "warning",
    webhook_failure: "warning",
    location_provider_failure: "warning",
    eta_calculation_failure: "warning",
  };

/**
 * Send one signal. Never throws, never blocks: an observability call that can
 * break the operation it observes is worse than no observability.
 */
export function captureShipmentSignal(record: ShipmentSignalRecord): void {
  try {
    Sentry.withScope((scope) => {
      scope.setLevel(SIGNAL_LEVEL[record.signal] ?? "error");
      scope.setFingerprint(["shipment", record.signal, record.code]);

      // Tags are indexed and searchable. Only low-cardinality, non-identifying
      // values belong here — a tracking number would be both high-cardinality
      // and a §5 identifier, so it goes in the context instead.
      scope.setTag("scope", "shipment");
      scope.setTag("shipment_signal", record.signal);
      scope.setTag("shipment_signal_code", record.code);
      if (record.actor_role) scope.setTag("actor_role", record.actor_role);

      // The record is already an allow-list; `scrubEvent` sweeps it again on
      // the way out.
      scope.setContext("shipment_signal", { ...record });

      Sentry.captureMessage(
        `shipment.${record.signal}: ${record.code}`,
        SIGNAL_LEVEL[record.signal] ?? "error",
      );
    });
  } catch {
    /* the console line in logShipmentSignal already happened */
  }
}
