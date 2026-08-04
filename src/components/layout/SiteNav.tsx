"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/ui/Logo";

const NAV_LINKS = [
  { href: "/#dispatch", label: "Dispatch", match: null },
  { href: "/shippers", label: "Shippers", match: "/shippers" },
  { href: "/#pricing", label: "Pricing", match: null },
  { href: "/faq", label: "FAQ", match: "/faq" },
  { href: "/blog", label: "Blog", match: "/blog" },
  { href: "/about", label: "About", match: "/about" },
  { href: "/contact", label: "Contact", match: "/contact" },
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
] as const;

export function SiteNav() {
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
              {l.label}
            </Link>
          ))}
        </div>
        <div className="nav-cta">
          <Link className="btn btn-amber" href="/#quote">
            Start Carrier Setup
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
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
