/**
 * M-92 — the agreement signature lifecycle.
 *
 * Plain module (no `server-only`): the webhook writes these statuses and the
 * carrier portal renders them, so both sides must import the same mapping.
 * A second copy of this table in a component is how a status silently stops
 * matching what the webhook writes.
 */

import type { SignatureRequestStatus } from "@/lib/supabase/database.types";

/**
 * The stored status type IS the database column type — aliased, not redeclared.
 * Two hand-maintained copies of an enum drift, and the drift shows up as a
 * status the webhook can write and the portal cannot render.
 */
export type SignatureStatus = SignatureRequestStatus;

/** Stored statuses. `not_sent` is deliberately absent — see below. */
export const SIGNATURE_STATUSES = [
  "sent",
  "viewed",
  "carrier_signed",
  "awaiting_countersignature",
  "completed",
  "declined",
  "expired",
] as const;

/**
 * What the portal shows. `not_sent` is the ABSENCE of a signature_requests
 * row, not a value in the column — one way to say a thing, and no race
 * between a missing row and a row that says "missing".
 */
export type DisplayStatus = SignatureStatus | "not_sent";

/** In-flight. Mirrors the partial unique index in migration 0031 exactly. */
export const ACTIVE_SIGNATURE_STATUSES: readonly SignatureStatus[] = [
  "sent",
  "viewed",
  "carrier_signed",
  "awaiting_countersignature",
];

export function isActiveSignatureStatus(s: SignatureStatus): boolean {
  return ACTIVE_SIGNATURE_STATUSES.includes(s);
}

/**
 * SignWell event type → the status it puts the request into.
 *
 * `document_signed` is absent on purpose: it fires once PER SIGNER, so the
 * status it implies depends on WHO signed. The webhook resolves that against
 * the carrier's own email — see `statusForSignedEvent`.
 *
 * `document_created` and `document_recipients_updated` are absent because
 * they say nothing about progress toward signature.
 */
export const EVENT_TO_STATUS: Readonly<Record<string, SignatureStatus>> = {
  document_sent: "sent",
  document_viewed: "viewed",
  document_completed: "completed",
  document_declined: "declined",
  document_expired: "expired",
};

/**
 * Which status a `document_signed` event implies.
 *
 * With `apply_signing_order: true` and the carrier as recipient 1, the carrier
 * signing means exactly one thing: PickLoads has not countersigned yet. That
 * is reported as `awaiting_countersignature`, which is more informative than
 * `carrier_signed` and is what the portal needs to say.
 *
 * `carrier_signed` is retained for the case where the signer is NOT the
 * carrier — a countersignature arriving before the document completes. It is
 * a real state and pretending it cannot happen is how a status column starts
 * lying.
 */
export function statusForSignedEvent(args: {
  signerEmail: string | null;
  carrierEmail: string | null;
}): SignatureStatus {
  const signer = args.signerEmail?.trim().toLowerCase();
  const carrier = args.carrierEmail?.trim().toLowerCase();
  if (signer && carrier && signer === carrier) {
    return "awaiting_countersignature";
  }
  return "carrier_signed";
}

/**
 * Terminal statuses never move again. A late or out-of-order delivery must not
 * drag a completed agreement back to "viewed" — webhook ordering is not
 * guaranteed by any provider, and this is the guard that makes that harmless.
 */
export const TERMINAL_STATUSES: readonly SignatureStatus[] = [
  "completed",
  "declined",
  "expired",
];

export function isTerminal(s: SignatureStatus): boolean {
  return TERMINAL_STATUSES.includes(s);
}

/** Timestamp column stamped when a status is reached, if any. */
export const STATUS_TIMESTAMP_COLUMN: Readonly<
  Partial<Record<SignatureStatus, string>>
> = {
  viewed: "viewed_at",
  carrier_signed: "carrier_signed_at",
  awaiting_countersignature: "carrier_signed_at",
  completed: "completed_at",
  declined: "declined_at",
  expired: "expired_at",
};

/** English labels. The portal wraps these in tv() for the five locales. */
export const STATUS_LABEL: Readonly<Record<DisplayStatus, string>> = {
  not_sent: "Not sent",
  sent: "Sent",
  viewed: "Viewed",
  carrier_signed: "Carrier signed",
  awaiting_countersignature: "Awaiting PickLoads countersignature",
  completed: "Completed",
  declined: "Declined",
  expired: "Expired",
};

/** Badge tone for the V4 `.pbadge` vocabulary — no new design tokens. */
export const STATUS_TONE: Readonly<
  Record<DisplayStatus, "" | "amber" | "green" | "red">
> = {
  not_sent: "",
  sent: "amber",
  viewed: "amber",
  carrier_signed: "amber",
  awaiting_countersignature: "amber",
  completed: "green",
  declined: "red",
  expired: "red",
};
