import "server-only";

import { z } from "zod";

const siteverifyResponse = z.object({
  success: z.boolean(),
  // Cloudflare returns this on every failure and it is the ONLY thing that
  // distinguishes the causes. Optional because a success carries no codes.
  "error-codes": z.array(z.string()).optional(),
});

/**
 * What each siteverify code actually means for an operator staring at
 * "We couldn't verify your submission" and no other information.
 *
 * This table exists because the codes are not self-explanatory and the wrong
 * reading sends you to the wrong place: `invalid-input-response` looks like a
 * server misconfiguration and is almost always a client-side or domain issue,
 * while `invalid-input-secret` is the only one that means the key is wrong.
 */
const CODE_MEANING: Record<string, string> = {
  "missing-input-secret": "TURNSTILE_SECRET_KEY is not set on the server",
  "invalid-input-secret":
    "TURNSTILE_SECRET_KEY is wrong, or belongs to a different widget than NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "missing-input-response":
    "no token was submitted — the widget did not render or did not solve",
  "invalid-input-response":
    "token rejected — usually the widget's allowed HOSTNAME does not include the origin you are testing from (add localhost/127.0.0.1 to the widget in the Cloudflare dashboard), or the site key and secret are from different widgets",
  "timeout-or-duplicate":
    "token already spent or older than 300s — a Turnstile token is SINGLE-USE, so a double submit or a re-submitted stale form fails here",
  "bad-request": "malformed siteverify request",
  "internal-error": "Cloudflare-side failure — retry is appropriate",
};

/**
 * Cloudflare Turnstile server-side verification (audit S-03 — Turnstile on
 * every public form, verified server-side, decision Q3 pipeline step 2).
 *
 * Graceful degradation: when TURNSTILE_SECRET_KEY is unset (local dev,
 * preview without secrets) the check is skipped with a warning — the build
 * and dev flows keep working without Cloudflare credentials.
 */
export async function verifyTurnstile(
  token: string | null,
  remoteIp?: string,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.warn("[turnstile] TURNSTILE_SECRET_KEY unset — check skipped (dev mode)");
    return true;
  }
  if (!token) {
    // Previously a bare `return false`. A missing token and a REJECTED token
    // produced the identical silent failure and the identical user-facing
    // sentence, so "the widget never rendered" and "Cloudflare said no" were
    // indistinguishable from outside — which is most of what made the carrier
    // step-1 report hard to act on.
    console.error(
      "[turnstile] REFUSED: no cf-turnstile-response field in the submission. " +
        "The widget did not render or was not solved. Check that " +
        "NEXT_PUBLIC_TURNSTILE_SITE_KEY is set in the environment the BROWSER " +
        "bundle was built with, and that <TurnstileWidget/> is inside this form.",
    );
    return false;
  }

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body },
    );
    if (!res.ok) {
      console.error(`[turnstile] siteverify HTTP ${res.status}`);
      return false;
    }
    const parsed = siteverifyResponse.safeParse(await res.json());
    if (!parsed.success) {
      console.error("[turnstile] siteverify returned an unreadable body");
      return false;
    }
    if (!parsed.data.success) {
      // The codes are the whole diagnostic value of this call and they were
      // being parsed away. They are logged, never returned: the caller still
      // shows one generic sentence, because telling a bot which check it
      // failed is how you help it pass the next one.
      const codes = parsed.data["error-codes"] ?? [];
      const explained = codes.length
        ? codes.map((c) => `${c} — ${CODE_MEANING[c] ?? "unrecognised code"}`)
        : ["no error-codes returned"];
      console.error(
        `[turnstile] REFUSED by siteverify: ${explained.join(" | ")}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error("[turnstile] siteverify request failed", err);
    return false; // fail closed: no verification, no write
  }
}
