"use client";

import { useEffect, useState } from "react";
import { Turnstile } from "@marsidev/react-turnstile";

/**
 * SEC-P1-01 — mint a fresh Turnstile token after every settled submission.
 *
 * ── WHY A HOOK, AND WHY IT IS NOT OPT-IN ─────────────────────────────────
 *
 * `resetKey` shipped as an opt-in with a default of 0 so the carrier wizard
 * could be fixed without touching the other call sites. The audit found the
 * predictable result: **one of eleven call sites opted in.** The other ten —
 * both account-creation forms, contact, the freight quote, the home-page
 * quick quote, the New Authority lead, the newsletter, the driver update, the
 * tracking support form and the public tracking lookup — still re-sent a
 * spent token on the second attempt and wedged exactly as described below.
 *
 * A safety default that every caller has to remember is not a default. So the
 * reset is now a hook the call site wires to its own `useActionState` value,
 * and `resetKey` remains only as the escape hatch for a caller that tracks
 * attempts some other way.
 *
 * ── WHY IT FIRES ON SUCCESS TOO, NOT ONLY ON ERROR ───────────────────────
 *
 * The token is spent by the *submission*, not by the *outcome*. Any form that
 * survives its own success and can be submitted again therefore has the same
 * bug on the happy path. `/track` is the clearest case and its own
 * documentation invites it: "a successful result renders BELOW the form …
 * a second lookup is one edit away." That second lookup re-sent a dead token
 * and was refused, on the public tracking page, for a customer who had just
 * been told the first lookup worked.
 *
 * `status !== "idle"` is the whole condition: `useActionState` hands back a
 * new state object per submission, so this counts submissions, not outcomes.
 */
export function useTurnstileReset(state: { status: string }): number {
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (state.status !== "idle") setAttempt((n) => n + 1);
  }, [state]);
  return attempt;
}

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
   * Prefer `useTurnstileReset(state)` above — it derives this counter from the
   * form's own action state. Pass `resetKey` directly only when a caller
   * counts attempts some other way (the carrier wizard does).
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
