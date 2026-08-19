/**
 * M-96 — making Supabase's TOTP QR payload actually renderable.
 *
 * Plain module (no `server-only`, no `"use client"`): a pure string function,
 * imported by the enrollment component and exercised directly by
 * `tests/unit/mfa-enrollment.test.tsx`.
 *
 * ── THE DEFECT THIS EXISTS TO FIX ────────────────────────────────────────
 *
 * `supabase.auth.mfa.enroll({factorType:'totp'})` returns `totp.qr_code` as a
 * `data:` URL — and the URL it returns is not a valid one. Measured against
 * the live project on 2026-08-19:
 *
 *     header : "data:image/svg+xml;utf-8"          ← not a valid parameter;
 *                                                    it must be charset=utf-8
 *     payload: 321,600 characters of RAW SVG
 *              0 percent-escapes
 *              25,367 literal spaces
 *              42,260 literal double quotes
 *              4,229 literal '<'
 *
 * A `data:` URL's content has to be percent-encoded. Handed that string, the
 * browser cannot decode it and the `<img>` renders nothing — which is exactly
 * what "the Generate QR code button does nothing" looked like: the button was
 * working, the enrollment was succeeding, and the QR was a blank box the same
 * colour as the card behind it.
 *
 * The previous helper made this unreachable by design:
 *
 *     if (raw.startsWith("data:")) return raw;   // ← always taken
 *     return `data:image/svg+xml;utf-8,${encodeURIComponent(raw)}`;
 *
 * The second line was the correct handling and was dead code, because the
 * provider always sends the `data:` prefix.
 *
 * ── WHY THE RESULT IS STILL RENDERED THROUGH `<img>` ─────────────────────
 *
 * The obvious alternative — inlining the SVG with `dangerouslySetInnerHTML` —
 * would be smaller and would also work. It is not used, because an inline SVG
 * is live markup: a script tag inside it executes in our origin, and this
 * payload comes from outside the application. An SVG loaded through `<img>`
 * cannot run script (the SVG-in-image spec disables it), so the untrusted
 * document is rendered in the one context that is inert by definition.
 */

/** The correct media type, replacing whatever the provider claimed. */
const MEDIA_TYPE = "data:image/svg+xml;charset=utf-8,";

/**
 * Normalize a provider QR payload into a data URL a browser will decode.
 *
 * Accepts either a `data:...,<payload>` URL or a bare SVG document, because
 * the response shape has changed across auth versions and guessing which one
 * is in play is how this broke in the first place.
 *
 * Returns `null` when there is nothing renderable — the caller must show the
 * manual setup key instead rather than an empty frame.
 */
export function toRenderableQrSrc(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Strip the provider's header, whatever it claimed to be, and keep only the
  // document. `data:` URLs put the payload after the FIRST comma.
  let payload = trimmed;
  if (/^data:/i.test(trimmed)) {
    const comma = trimmed.indexOf(",");
    if (comma === -1) return null;
    const header = trimmed.slice(0, comma);
    payload = trimmed.slice(comma + 1);

    // Already base64? Then it is well-formed by construction — a base64 body
    // contains nothing that needs escaping — so pass it through untouched
    // rather than mangling it.
    if (/;base64$/i.test(header)) return trimmed;

    // Percent-encoded already (and not merely containing a stray '%')? Leave
    // it alone: re-encoding would double-escape every '%'.
    if (!/[<>"' ]/.test(payload) && /%[0-9A-Fa-f]{2}/.test(payload)) {
      return `${MEDIA_TYPE}${payload}`;
    }
  }

  if (payload.trim() === "") return null;
  return `${MEDIA_TYPE}${encodeURIComponent(payload)}`;
}

/**
 * Does this string look like an SVG document at all?
 *
 * Used only to decide whether to offer the QR frame or go straight to the
 * manual key. It is a display decision, never a security one — the `<img>`
 * boundary is what makes the payload safe, not this check.
 */
export function looksLikeSvg(raw: string | null | undefined): boolean {
  return typeof raw === "string" && /<svg[\s>]/i.test(raw);
}
