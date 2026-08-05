import "server-only";

import { headers } from "next/headers";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";

/**
 * Shared pre-write pipeline for public form actions (decision Q3):
 * IP extraction → rate limit (Q4) → Turnstile siteverify (S-03). Only after
 * both gates pass does an action touch the service-role client.
 */
export const GUARD_MESSAGES = {
  rate_limit:
    "Too many requests from your network. Please wait a few minutes and try again — or call (908) 404-5373.",
  turnstile:
    "We couldn't verify your submission. Please refresh the page and try again.",
} as const;

export const SERVER_ERROR_MESSAGE =
  "Something went wrong on our end. Please try again — or call (908) 404-5373.";

export type GuardResult =
  | { ok: true; ip: string }
  | { ok: false; message: string };

/**
 * `limit` overrides the 5-per-10-minutes default for THIS form's bucket.
 *
 * M-73 passes a TIGHTER value than the default: `/track` is an enumeration
 * surface rather than a lead form (§19 "prevents enumeration"), and the cost
 * of a false refusal there is a customer waiting ten minutes, while the cost
 * of a generous limit is a guessing budget. Every other caller keeps the
 * default by omitting the argument.
 */
export async function guardPublicForm(
  form: string,
  formData: FormData,
  limit?: number,
): Promise<GuardResult> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";

  if (!(await checkRateLimit(form, ip, limit))) {
    return { ok: false, message: GUARD_MESSAGES.rate_limit };
  }

  const token = formData.get("cf-turnstile-response");
  const human = await verifyTurnstile(
    typeof token === "string" ? token : null,
    ip !== "unknown" ? ip : undefined,
  );
  if (!human) {
    return { ok: false, message: GUARD_MESSAGES.turnstile };
  }

  return { ok: true, ip };
}

/** FormData.get → string (missing/File → empty string) for Zod input. */
export function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
