"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { Logo } from "@/components/ui/Logo";
import { useV4 } from "@/i18n/v4";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/supabase/database.types";

/**
 * M-23 portal navigation — V4 vocabulary on the dark shell (U-10).
 * M-55/M-56 complete the customer navs (directive sections) and translate
 * customer-facing labels via the V4 bridge; the staff nav stays English
 * (existing scope decision).
 *
 * M-59: ≤860px the sidebar is an off-canvas drawer driven from a sticky
 * mobile bar. Focus management per WCAG 2.4.3/2.4.11 — opening moves focus
 * into the drawer, Escape/backdrop closes and returns focus to the toggle;
 * route changes close it.
 */
export function PortalSidebar({
  role,
  fullName,
}: {
  role: UserRole;
  fullName: string | null;
}) {
  const tv = useV4();
  const pathname = usePathname();
  const isStaff = role === "admin" || role === "dispatcher";
  const [open, setOpen] = useState(false);
  const asideRef = useRef<HTMLElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) toggleRef.current?.focus();
  }, []);

  // Route change (drawer link followed) → close without stealing focus.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Opening moves focus to the first control inside the drawer.
  useEffect(() => {
    if (open) {
      const first = asideRef.current?.querySelector<HTMLElement>("button, a");
      first?.focus();
    }
  }, [open]);

  const item = (href: string, label: string, exact = false) => {
    const active = exact ? pathname === href : pathname.startsWith(href);
    return (
      <Link
        href={href}
        className={active ? "active" : undefined}
        aria-current={active ? "page" : undefined}
      >
        {label}
      </Link>
    );
  };

  async function signOut() {
    try {
      if (
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
        !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("placeholder")
      ) {
        await createClient().auth.signOut();
      }
    } finally {
      window.location.assign("/");
    }
  }

  return (
    <>
      <div className="pmobilebar">
        <Logo small />
        <button
          type="button"
          ref={toggleRef}
          className="pmenu"
          aria-expanded={open}
          aria-controls="portal-nav"
          onClick={() => setOpen((v) => !v)}
        >
          <span aria-hidden="true">☰</span> {tv("Menu")}
        </button>
      </div>
      {open ? (
        <button
          type="button"
          className="pbackdrop"
          aria-label={tv("Close menu")}
          onClick={() => close(true)}
        />
      ) : null}
      <aside
        id="portal-nav"
        ref={asideRef}
        className={open ? "pside open" : "pside"}
        aria-label={tv("Portal navigation")}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) close(true);
        }}
      >
        <div
          style={{
            padding: "4px 6px 10px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <Logo small />
          <button
            type="button"
            className="pclose"
            aria-label={tv("Close menu")}
            onClick={() => close(true)}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        {isStaff ? (
          <>
            <span className="plabel">Dispatch desk</span>
            {item("/portal/admin", "Dashboard", true)}
            {item("/portal/admin/leads", "Leads CRM")}
            {item("/portal/admin/loads", "Loads")}
            {item("/portal/admin/quotes", "Freight quotes")}
            {item("/portal/admin/support", "Support inbox")}
            {item("/portal/admin/posts", "Blog posts")}
            {role === "admin" ? item("/portal/admin/users", "Users") : null}
            {item("/portal/admin/mfa", "Two-factor auth")}
            {role === "admin"
              ? item("/portal/admin/security", "Security log")
              : null}
            {role === "admin" ? item("/portal/admin/settings", "Settings") : null}
          </>
        ) : role === "shipper" ? (
          <>
            <span className="plabel">{tv("Shipper portal")}</span>
            {item("/portal/shipper", tv("Overview"), true)}
            {item("/portal/shipper/quotes/new", tv("Request a Quote"))}
            {item("/portal/shipper/quotes", tv("My Quotes"), true)}
            {item("/portal/shipper/documents", tv("Documents"))}
            {item("/portal/shipper/billing", tv("Billing"))}
            {item("/portal/shipper/support", tv("Support"))}
            {item("/portal/shipper/company", tv("Company Settings"))}
            {item("/portal/shipper/settings", tv("Account Settings"))}
          </>
        ) : (
          <>
            <span className="plabel">{tv("Carrier portal")}</span>
            {item("/portal/carrier", tv("Overview"), true)}
            {item("/portal/carrier/profile", tv("Company Profile"))}
            {item("/portal/carrier/trucks", tv("Trucks & Equipment"))}
            {item("/portal/carrier/drivers", tv("Drivers"))}
            {item("/portal/carrier/documents", tv("Documents"))}
            {item("/portal/carrier/agreements", tv("Agreements"))}
            {item("/portal/carrier/loads", tv("Loads"))}
            {item("/portal/carrier/invoices", tv("Invoices & Payments"))}
            {item("/portal/carrier/notifications", tv("Notifications"))}
            {item("/portal/carrier/support", tv("Support"))}
            {item("/portal/carrier/settings", tv("Account Settings"))}
          </>
        )}
        <span className="plabel">{tv("Site")}</span>
        <Link href="/">← {tv("Back to pickloads.com")}</Link>
        <a
          href="#signout"
          onClick={(e) => {
            e.preventDefault();
            void signOut();
          }}
        >
          {tv("Sign out")}
        </a>
        <div className="pfoot">
          {fullName ?? "—"}
          <br />
          {role.toUpperCase()}
        </div>
      </aside>
    </>
  );
}
