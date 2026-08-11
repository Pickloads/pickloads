"use client";

import { useEffect, useRef, useState } from "react";

import { Link, usePathname } from "@/i18n/navigation";
import { Logo } from "@/components/ui/Logo";
import { useV4 } from "@/i18n/v4";
import {
  entryLabel,
  liveEntries,
  NAV_GROUPS,
  NAV_UTILITIES,
  PRIMARY_CTA,
} from "@/lib/site-nav";

/**
 * Phase B — the global navigation.
 *
 * ── WHAT CHANGED AND WHY ─────────────────────────────────────────────────
 *
 * The bar used to be eight flat links in source order. That is fine for eight
 * destinations and falls apart at twenty: the approved IA groups the site into
 * Services / Carriers / Shippers / Resources / Company, and a flat bar cannot
 * express that without becoming a wall of text.
 *
 * Every link comes from `src/lib/site-nav.ts`, which the desktop bar, the
 * mobile drawer and the footer all share. Three hard-coded lists were three
 * chances to rename a destination in two places.
 *
 * ── EVERY GROUP HEADER IS A REAL LINK ────────────────────────────────────
 *
 * The trigger is an `<a>` to a real page, not a dead `<button>`. So the nav
 * works with JavaScript disabled, works for a keyboard user who tabs straight
 * past the panel, and never presents a control that does nothing. The panel is
 * an enhancement layered on top.
 *
 * ── WHY THE PANEL IS `display: none` WHEN CLOSED ─────────────────────────
 *
 * Not cosmetic. A panel hidden with `opacity: 0` keeps its links in the
 * accessibility tree and in the layout — screen readers announce them, tab
 * order includes them, and the certified responsive suite measures them as
 * links sitting outside the nav bar. `display: none` removes them from all
 * three. The suite's probe skips `display: none` anchors for exactly this
 * reason.
 *
 * ── NO DEAD LINKS ────────────────────────────────────────────────────────
 *
 * `liveEntries` drops anything with `ships: false`. Carrier Resources,
 * Knowledge Base, Downloads, Careers and Partners are declared in the IA and
 * do not render until their pages exist. `tests/unit/site-nav.test.ts` proves
 * every rendered href resolves against the real app directory.
 */
export function SiteNav({
  brokerageActive = false,
}: {
  brokerageActive?: boolean;
}) {
  const tv = useV4();
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const navRef = useRef<HTMLElement | null>(null);

  // Close the panel on route change: a menu that survives navigation covers
  // the page the user just asked for.
  useEffect(() => {
    setOpenGroup(null);
    setDrawerOpen(false);
  }, [pathname]);

  // Escape closes, and focus returns to the trigger — WCAG 2.2 keyboard
  // expectation for any transient overlay.
  useEffect(() => {
    if (openGroup === null && !drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpenGroup(null);
      setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openGroup, drawerOpen]);

  // A click outside the nav closes the panel. Pointer users get the same
  // dismissal affordance keyboard users get from Escape.
  useEffect(() => {
    if (openGroup === null) return;
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenGroup(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openGroup]);

  const isActive = (href: string) =>
    href !== "/" && !href.startsWith("/#") && pathname.startsWith(href);

  return (
    <nav className="sitenav" ref={navRef}>
      <div className="wrap">
        <Logo />

        <div className="navlinks">
          {NAV_GROUPS.map((group) => {
            const entries = liveEntries(group.entries);
            const open = openGroup === group.label;
            return (
              <div
                key={group.label}
                className={`navgroup${open ? " open" : ""}`}
                // Hover opens on pointer devices; focus-within and the toggle
                // cover keyboard and touch. Leaving closes, so the panel never
                // strands itself open behind the cursor.
                onMouseEnter={() => setOpenGroup(group.label)}
                onMouseLeave={() =>
                  setOpenGroup((cur) => (cur === group.label ? null : cur))
                }
              >
                <Link
                  href={group.href}
                  className={isActive(group.href) ? "active" : undefined}
                  aria-expanded={open}
                  aria-haspopup="true"
                  onFocus={() => setOpenGroup(group.label)}
                >
                  {tv(group.label)}
                </Link>
                <div className="navpanel" role="group" aria-label={tv(group.label)}>
                  {entries.map((entry) => (
                    <Link key={`${group.label}-${entry.label}`} href={entry.href}>
                      {tv(entryLabel(entry, brokerageActive))}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}

          {liveEntries(NAV_UTILITIES).map((entry) => (
            <Link
              key={entry.label}
              href={entry.href}
              className={isActive(entry.href) ? "active" : undefined}
            >
              {tv(entry.label)}
            </Link>
          ))}
        </div>

        <div className="nav-cta">
          {/* §10/§20: the quote is the acquisition CTA. Tracking is a utility
              in the bar above — putting a lookup box in the primary slot tells
              a first-time visitor the main offering is a search field. */}
          <Link className="btn btn-amber" href={PRIMARY_CTA.href}>
            {tv(PRIMARY_CTA.label)}
          </Link>
          <button
            className="menu-btn"
            aria-label={tv("Menu")}
            aria-expanded={drawerOpen}
            aria-controls="mobile-menu"
            onClick={() => setDrawerOpen((v) => !v)}
          >
            ☰
          </button>
        </div>
      </div>

      {/* The drawer is flat and grouped by heading rather than nested: a
          two-level accordion on a 320px screen costs a tap for every
          destination and hides the thing the visitor came for. */}
      <div className={`mobile-menu${drawerOpen ? " open" : ""}`} id="mobile-menu">
        <Link className="mm-cta" href={PRIMARY_CTA.href}>
          {tv(PRIMARY_CTA.label)}
        </Link>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mm-group">
            <span className="mm-head">{tv(group.label)}</span>
            {liveEntries(group.entries).map((entry) => (
              <Link key={`${group.label}-${entry.label}`} href={entry.href}>
                {tv(entryLabel(entry, brokerageActive))}
              </Link>
            ))}
          </div>
        ))}
        <div className="mm-group">
          {liveEntries(NAV_UTILITIES).map((entry) => (
            <Link key={entry.label} href={entry.href}>
              {tv(entry.label)}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
