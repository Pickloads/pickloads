import "server-only";

import { z } from "zod";

const siteverifyResponse = z.object({ success: z.boolean() });

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
  if (!token) return false;

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body },
    );
    if (!res.ok) return false;
    const parsed = siteverifyResponse.safeParse(await res.json());
    return parsed.success && parsed.data.success;
  } catch (err) {
    console.error("[turnstile] siteverify request failed", err);
    return false; // fail closed: no verification, no write
  }
}
