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
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);

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
      if (drawerOpen) {
        setDrawerOpen(false);
        // Focus goes back to the control that opened it, not to the top of the
        // document — otherwise dismissing the menu costs a keyboard user every
        // tab stop they had already passed.
        menuBtnRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openGroup, drawerOpen]);

  /* ── THE MOBILE DRAWER IS MODAL, SO THE PAGE BEHIND IT MUST NOT MOVE ────
   *
   * ── THE BUG ────────────────────────────────────────────────────────────
   *
   * The drawer renders INSIDE `nav.sitenav`, which is `position: sticky`. So
   * the panel stayed pinned to the top of the screen while a swipe scrolled
   * the document underneath it — the menu looked frozen and the page slid
   * around behind it. Worse, the drawer is a flat list of every destination on
   * the site: on a phone it is taller than the viewport, it had no height
   * limit and no scroller of its own, so the last several links were simply
   * unreachable. Scrolling "toward them" scrolled the page instead.
   *
   * Two things were missing and both are needed; neither alone fixes it.
   *
   * ── 1. THE BODY LOCK, AND WHY IT IS `position: fixed` ──────────────────
   *
   * `overflow: hidden` on the body is not enough on iOS Safari — the page
   * still rubber-bands and still scrolls under a touch drag. Taking the body
   * out of flow at a negative offset is the technique that holds there, and it
   * is why the scroll position has to be captured and restored by hand:
   * `position: fixed` resets the document scroll to 0, so without the restore
   * below, closing the menu would throw the reader back to the top of the page
   * they were reading.
   *
   * The sticky nav survives this — its containing block still spans the
   * viewport, so it stays clamped at `top: 0` with the body fixed. That is
   * asserted on a real mobile viewport by `tests/e2e/mobile-nav.spec.ts`,
   * which is the only honest way to know it: this is browser behaviour, not
   * something a unit test can observe.
   */
  useEffect(() => {
    if (!drawerOpen) return;
    const { body } = document;
    const scrollY = window.scrollY;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      // Exactly where they were, to the pixel. EVERY close path — the
      // hamburger, Escape, a link, a route change, a resize — runs this
      // cleanup, so there is one restore rather than five that can drift.
      //
      // `behavior: "instant"` is load-bearing, not a micro-optimisation. The
      // site sets `html { scroll-behavior: smooth }`, so the two-argument
      // `scrollTo(0, y)` ANIMATES: the page visibly slides back from the top
      // to where the reader was, which is a page jump with better manners, and
      // for the half-second it lasts the position is simply wrong. Restoring a
      // position the user never left must not be an animation.
      window.scrollTo({ top: scrollY, left: 0, behavior: "instant" });
    };
  }, [drawerOpen]);

  /* ── 2. THE DRAWER NEEDS ITS OWN SCROLLER, SIZED TO WHAT IS LEFT ────────
   *
   * A `max-height` in CSS cannot know where the nav actually sits: at the top
   * of the page the topbar is still on screen and the nav bottom is ~110px
   * down; once scrolled it is ~72px. A fixed `calc()` is therefore wrong at
   * one end or the other, and being wrong at the bottom end puts the last menu
   * item off-screen again — the exact defect this is fixing.
   *
   * So the height is measured. `visualViewport` rather than `innerHeight`,
   * because iOS shrinks the visual viewport when its toolbars are showing and
   * the difference is about two menu rows.
   */
  useEffect(() => {
    if (!drawerOpen) return;
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const available =
        (window.visualViewport?.height ?? window.innerHeight) -
        nav.getBoundingClientRect().bottom;
      nav.style.setProperty("--mm-max-h", `${Math.max(available, 160)}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      nav.style.removeProperty("--mm-max-h");
    };
  }, [drawerOpen]);

  /* ── 3. A DESKTOP VIEWPORT HAS NO DRAWER, SO IT MUST NOT HAVE A LOCK ────
   *
   * Above 960px the hamburger is `display: none` and the drawer with it. A
   * rotation or a window resize across that line would otherwise leave the
   * body locked with no visible control left to unlock it.
   */
  useEffect(() => {
    if (!drawerOpen) return;
    const mq = window.matchMedia("(min-width: 961px)");
    const onChange = () => {
      if (mq.matches) setDrawerOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [drawerOpen]);

  /* ── 4. FOCUS STAYS IN THE MENU WHILE THE MENU IS OPEN ──────────────────
   *
   * The background is inert to touch and to the wheel once the body is locked;
   * without this it would still be reachable by Tab, so a keyboard user could
   * walk out of an open menu into a page they cannot see.
   *
   * The trigger is INSIDE the trap on purpose. `aria-modal` was considered and
   * rejected: it would hide the hamburger — the only close control this design
   * has — from assistive technology, and adding a second close button inside
   * the drawer would change a visual design this task is explicitly not
   * allowed to redesign. Keeping the toggle in the loop means Shift+Tab from
   * the first link lands on the control that closes the thing.
   */
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const drawer = drawerRef.current;
      const button = menuBtnRef.current;
      if (!drawer || !button) return;
      const focusable: HTMLElement[] = [
        button,
        ...Array.from(
          drawer.querySelectorAll<HTMLElement>(
            "a[href], button:not([disabled])",
          ),
        ),
      ];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement as HTMLElement | null;
      const inside = active === button || (!!active && drawer.contains(active));
      if (!inside) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

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
            ref={menuBtnRef}
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
          destination and hides the thing the visitor came for.

          It is its OWN scroll container (see the CSS and the effects above).
          Before that it was neither — it inherited the page's scroller, which
          is how a swipe over the menu moved the page and how the bottom of the
          list became unreachable. */}
      <div
        ref={drawerRef}
        className={`mobile-menu${drawerOpen ? " open" : ""}`}
        id="mobile-menu"
      >
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
