"use server";

import { headers } from "next/headers";
import { field } from "@/lib/forms/guard";
import { checkRateLimit } from "@/lib/rate-limit";
import type { FormState } from "@/lib/form-state";
import {
  applyNotificationOptOut,
  revokeNotificationOptOut,
  type OptOutOutcome,
} from "@/lib/notification-preferences";

/**
 * M-79 — the POST half of the shipment-notification opt-out.
 *
 * The GET render of `/notifications/unsubscribe` NEVER mutates: corporate
 * link scanners prefetch every URL in an email, and a GET side effect would
 * silently stop notifications for customers who never clicked. That is
 * M-69/P-1's argument, and it applies here for exactly the same reason.
 *
 * Rate limited per IP for the same reason M-69's is: the token is
 * unguessable, but a write endpoint reachable without a session must not
 * become a free write amplifier or a token-probing oracle.
 *
 * `already` is reported as SUCCESS. An opt-out request for an address that is
 * already opted out has been honoured; repeating it must never look like a
 * failure to the person pressing the button or to an auditor reading the logs.
 */

function outcomeToState(outcome: OptOutOutcome, done: string): FormState {
  if (outcome === "opted_out" || outcome === "already") {
    return { status: "success", message: done };
  }
  if (outcome === "invalid") {
    return {
      status: "error",
      message:
        "This link is no longer valid. Email support@pickloads.com and we'll update your preferences by hand.",
    };
  }
  return {
    status: "error",
    message:
      "We couldn't reach your preferences just now — nothing was changed. Try again, or email support@pickloads.com.",
  };
}

async function limited(bucket: string): Promise<boolean> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  return !(await checkRateLimit(bucket, ip, 10));
}

const RATE_LIMITED: FormState = {
  status: "error",
  message:
    "Too many requests from your network. Wait a few minutes, or email support@pickloads.com and we'll update your preferences.",
};

/** Stop shipment notification emails: address suppression + preference flag. */
export async function optOutShipmentNotifications(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (await limited("shipment-notification-optout")) return RATE_LIMITED;
  return outcomeToState(
    await applyNotificationOptOut(field(formData, "token")),
    "opted_out",
  );
}

/**
 * Turn them back on. Reachable only from the page a customer just used —
 * never a link in an email — so an accidental opt-out is reversible in the
 * same breath without a second credential being mailed anywhere.
 */
export async function resumeShipmentNotifications(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (await limited("shipment-notification-optin")) return RATE_LIMITED;
  return outcomeToState(
    await revokeNotificationOptOut(field(formData, "token")),
    "resumed",
  );
}
