"use client";

import { Link } from "@/i18n/navigation";
import { usePathname } from "@/i18n/navigation";
import { useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { useV4 } from "@/i18n/v4";

const NAV_LINKS = [
  { href: "/#dispatch", label: "Dispatch", match: null },
  { href: "/shippers", label: "Shippers", match: "/shippers" },
  { href: "/#pricing", label: "Pricing", match: null },
  { href: "/faq", label: "FAQ", match: "/faq" },
  { href: "/blog", label: "Blog", match: "/blog" },
  { href: "/about", label: "About", match: "/about" },
  { href: "/contact", label: "Contact", match: "/contact" },
  // M-51: real auth entry (directive) — sign-in is role-routed server-side.
  { href: "/login", label: "Login", match: "/login" },
] as const;

const MOBILE_LINKS = [
  { href: "/#dispatch", label: "Dispatch Services" },
  { href: "/shippers", label: "Shippers & Freight Quote" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#packet", label: "Carrier Packet" },
  { href: "/faq", label: "FAQ" },
  { href: "/blog", label: "Freight Insights" },
  { href: "/about", label: "About Us" },
  { href: "/contact", label: "Contact" },
  // M-51: auth + support entries (directive); M-52 points Get Started at
  // the /create-account chooser.
  { href: "/login", label: "Login" },
  { href: "/create-account", label: "Get Started →" },
  // M-82 (§22 "no hidden actions"): `Start Carrier Setup` → `/#quote` lives in
  // `.nav-cta`, which v4.css hides at ≤960px. Every other collapsing control
  // has a drawer or footer equivalent by DESTINATION; this one had neither, so
  // on every phone-width page — including the tracking pages this module
  // audits — the primary carrier call to action was simply unreachable. The
  // label is already in the v4 dictionary (`.nav-cta` renders it), so this
  // adds no string and no translation debt.
  { href: "/#quote", label: "Start Carrier Setup" },
  { href: "/contact", label: "Support" },
] as const;

export function SiteNav() {
  const tv = useV4();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <nav className="sitenav">
      <div className="wrap">
        <Logo />
        <div className="navlinks">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className={l.match && pathname.startsWith(l.match) ? "active" : undefined}
            >
              {tv(l.label)}
            </Link>
          ))}
        </div>
        <div className="nav-cta">
          {/* M-51 secondary Get Started (directive); M-52 → account chooser. */}
          <Link className="btn btn-ghost" href="/create-account">
            {tv("Get Started →")}
          </Link>
          <Link className="btn btn-amber" href="/#quote">
            {tv("Start Carrier Setup")}
          </Link>
          <button
            className="menu-btn"
            aria-label="Menu"
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((v) => !v)}
          >
            ☰
          </button>
        </div>
      </div>
      <div className={`mobile-menu${open ? " open" : ""}`} id="mobile-menu">
        {MOBILE_LINKS.map((l) => (
          <Link key={l.label} href={l.href} onClick={() => setOpen(false)}>
            {tv(l.label)}
          </Link>
        ))}
      </div>
    </nav>
  );
}
