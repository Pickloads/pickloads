import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * M-82 — the bridge between the jsdom a11y suites and the browser.
 *
 * ── THE PROBLEM THIS SOLVES ───────────────────────────────────────────────
 *
 * Every tracking surface except `/track` and `/driver/update/[token]` sits
 * behind a Supabase session the secretless e2e lane cannot mint (M-41), so
 * M-73→M-81 each scanned their views with axe-core in **jsdom**. jsdom applies
 * no stylesheet. That is not a small caveat for a module whose brief is §22
 * (twelve viewport widths, overflow, clipping, touch targets, date inputs) and
 * §23's colour requirements: *none of it is observable without CSS*. Six
 * modules in a row therefore shipped structural proofs and an honest note that
 * layout and contrast were unproven.
 *
 * ── WHAT THIS DOES ────────────────────────────────────────────────────────
 *
 * The a11y suites already render every surface, in every state, from the REAL
 * components with the REAL five-locale catalogue. This helper writes that
 * rendered DOM to `test-results/tracking-harness/<id>.html`, and
 * `tests/e2e/tracking-responsive-a11y.spec.ts` loads each file into Chromium
 * behind the REAL compiled stylesheets (`.next/static/css/*`, verified against
 * what the running server actually links) at all twelve §22 widths.
 *
 * So the markup is the shipped markup, the CSS is the shipped CSS, and the
 * measurement is a real layout engine. What it is NOT is a running route:
 * there is no server data, no hydration and no client-side navigation, and the
 * spec says so out loud rather than implying otherwise.
 *
 * Nothing here reaches `src/`. If this file disappeared, the product would be
 * unchanged and only the proof would be lost — which is the correct blast
 * radius for a test artifact.
 */

export type HarnessShell =
  /** The portal shell: `.portal` grid + the 230px sidebar column + `.pmain`. */
  | "portal"
  /** A public `.light` section, as `/track` renders its result into. */
  | "site"
  /** The chromeless driver route: its own `<main class="driver-shell">` IS
   * the layout (`src/app/[locale]/driver/layout.tsx` adds only a skip link),
   * so nothing is wrapped around it. */
  | "driver";

export const HARNESS_DIR = path.join(
  process.cwd(),
  "test-results",
  "tracking-harness",
);

/**
 * The sidebar is rendered as an EMPTY `.pside` on purpose.
 *
 * `.portal` is `grid-template-columns:230px 1fr`, so the sidebar's 230px column
 * is what determines how much width the tracking content actually gets — and
 * that geometry is exactly what a reflow test needs. Its CONTENTS are M-59's
 * off-canvas drawer, which that module audited and `tests/e2e/responsive.spec.
 * ts` fences; duplicating its markup here would create a replica that rots.
 * `aria-hidden` keeps an empty landmark out of the axe results.
 */
const PORTAL_ASIDE = '<aside class="pside" aria-hidden="true"></aside>';

function unwrapPortal(html: string): string {
  // `shipper-shipments-a11y` already wraps its render in `.portal`; wrapping
  // again would nest two grids and silently double the sidebar column.
  const trimmed = html.trim();
  if (!trimmed.startsWith('<div class="portal">')) return html;
  const doc = new DOMParser().parseFromString(trimmed, "text/html");
  const portal = doc.body.firstElementChild;
  return portal === null ? html : portal.innerHTML;
}

function shellFor(shell: HarnessShell, html: string): string {
  switch (shell) {
    case "portal":
      return `<div class="portal">${PORTAL_ASIDE}<div class="pmain">${unwrapPortal(html)}</div></div>`;
    case "site":
      return `<section class="light"><div class="wrap">${html}</div></section>`;
    case "driver":
      return html;
  }
}

/**
 * Write one surface state. Called from the a11y suites, which own the
 * fixtures — this file deliberately owns none, so a fixture can never drift
 * from the one the module that shipped the surface asserts against.
 */
export function emitHarness(
  id: string,
  shell: HarnessShell,
  container: HTMLElement,
): void {
  mkdirSync(HARNESS_DIR, { recursive: true });
  const body = shellFor(shell, container.innerHTML);
  writeFileSync(
    path.join(HARNESS_DIR, `${id}.html`),
    `<!--${shell}-->\n${body}\n`,
    "utf8",
  );
}

/**
 * True when every named fixture is on disk. The emitting tests assert this so
 * a silently-skipped write fails the unit lane rather than the browser lane
 * three minutes later with a confusing "file not found".
 */
export function harnessWritten(ids: readonly string[]): boolean {
  return ids.every((id) => existsSync(path.join(HARNESS_DIR, `${id}.html`)));
}
