import type { PublicTrackingDto } from "@/lib/shipments/dto";
import { SHIPMENT_I18N_NAMESPACE } from "@/lib/shipments/types";

/**
 * M-73 — the `useActionState` shape for the `/track` lookup.
 *
 * A plain module, not part of the `"use server"` file, for two reasons: a
 * server-action module may only export async functions, and the client
 * component that renders the result has to import this type.
 *
 * Every failure carries a MESSAGE KEY plus an English fallback, the same
 * belt-and-braces `FormState` uses (`src/lib/form-state.ts`): the page renders
 * `t(messageKey)` from the five-locale `shipment` catalogue, and the literal
 * only ever appears if a catalogue entry goes missing.
 */

/**
 * The refusal key. ONE key for unknown number, wrong secondary value and
 * admin-suspended tracking — §19's "prevents enumeration" reaches all the way
 * to the rendered sentence, not just the server's return value.
 */
export const TRACKING_ERROR_KEYS = {
  refused: `${SHIPMENT_I18N_NAMESPACE}.error.refused`,
  rate_limited: `${SHIPMENT_I18N_NAMESPACE}.error.rate_limited`,
  turnstile: `${SHIPMENT_I18N_NAMESPACE}.error.turnstile`,
  unavailable: `${SHIPMENT_I18N_NAMESPACE}.error.unavailable`,
  invalid: `${SHIPMENT_I18N_NAMESPACE}.error.invalid`,
} as const;

export type TrackingErrorCode = keyof typeof TRACKING_ERROR_KEYS;

export type TrackingLookupState =
  | { status: "idle" }
  | {
      status: "error";
      code: TrackingErrorCode;
      messageKey: string;
      /** English fallback, in the repo's existing `FormState` idiom. */
      message: string;
    }
  | {
      status: "success";
      tracking: PublicTrackingDto;
      /** §25: true when the shipment has more public events than the cap. */
      timelineTruncated: boolean;
    };

export const initialTrackingState: TrackingLookupState = { status: "idle" };

/** English fallbacks. The catalogue is authoritative; these are the net. */
export const TRACKING_ERROR_FALLBACKS: Record<TrackingErrorCode, string> = {
  refused:
    "We couldn't match that tracking number and verification value. Check both and try again, or call (908) 404-5373.",
  rate_limited:
    "Too many tracking attempts from your network. Please wait a few minutes and try again — or call (908) 404-5373.",
  turnstile:
    "We couldn't verify your submission. Please refresh the page and try again.",
  unavailable:
    "Tracking is temporarily unavailable. Please try again shortly, or call (908) 404-5373.",
  invalid: "Enter your tracking number and the delivery ZIP or access code.",
};

export function trackingError(code: TrackingErrorCode): TrackingLookupState {
  return {
    status: "error",
    code,
    messageKey: TRACKING_ERROR_KEYS[code],
    message: TRACKING_ERROR_FALLBACKS[code],
  };
}
