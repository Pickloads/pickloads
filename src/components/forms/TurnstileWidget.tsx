"use client";

import { Turnstile } from "@marsidev/react-turnstile";

/**
 * Cloudflare Turnstile widget (audit S-03). Renders nothing when
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset (secretless dev/preview) — the
 * server-side verify skips symmetrically, so forms stay fully walkable.
 * The widget injects the `cf-turnstile-response` hidden input into the
 * surrounding <form> automatically.
 */
export function TurnstileWidget({
  theme = "auto",
  resetKey = 0,
}: {
  theme?: "light" | "dark" | "auto";
  /**
   * Bump this to mint a FRESH token. Remounting is what resets the widget.
   *
   * ── WHY THIS EXISTS ──────────────────────────────────────────────────
   *
   * A Turnstile token is SINGLE-USE and expires after 300 seconds. The
   * widget solves once on mount and then sits on that one token.
   *
   * So when a submission failed for any reason — a Zod error, a rate limit,
   * a genuine Turnstile refusal — the user fixed the field, pressed the
   * button again, and the form re-sent the ALREADY-SPENT token. Cloudflare
   * answered `timeout-or-duplicate`, the guard turned that into "We couldn't
   * verify your submission. Please refresh the page and try again", and the
   * form was then wedged in that state permanently: every retry re-sent the
   * same dead token, and the only escape really was a page refresh, exactly
   * as the message said.
   *
   * The message was not wrong. It was describing a trap the form had set.
   *
   * Default 0 keeps every existing call site byte-identical in behaviour;
   * a caller opts in by passing an attempt counter.
   */
  resetKey?: number;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!siteKey) return null;
  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <Turnstile
        key={resetKey}
        siteKey={siteKey}
        options={{ theme, size: "flexible" }}
      />
    </div>
  );
}
