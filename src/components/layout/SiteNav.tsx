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
  // M-51: auth + support entries (directive).
  { href: "/login", label: "Login" },
  { href: "/portal", label: "Get Started →" },
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
          {/* M-51: secondary Get Started (directive) → the portal chooser. */}
          <Link className="btn btn-ghost" href="/portal">
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
