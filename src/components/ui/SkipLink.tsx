import { useV4 } from "@/i18n/v4";

/**
 * M-59 — WCAG 2.4.1 bypass block. First focusable element in every layout
 * (site / auth / portal); jumps to the page's `<main id="main">`. Visually
 * hidden until keyboard focus (`.skip-link` in v4.css — token-only).
 */
export function SkipLink() {
  const tv = useV4();
  return (
    <a href="#main" className="skip-link">
      {tv("Skip to main content")}
    </a>
  );
}
