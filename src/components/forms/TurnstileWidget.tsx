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
}: {
  theme?: "light" | "dark" | "auto";
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!siteKey) return null;
  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <Turnstile siteKey={siteKey} options={{ theme, size: "flexible" }} />
    </div>
  );
}
