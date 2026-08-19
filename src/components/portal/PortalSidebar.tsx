"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { Logo } from "@/components/ui/Logo";
import { useV4 } from "@/i18n/v4";
import { signOutAction } from "@/app/actions/auth";
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
  const locale = useLocale();
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
            {/* M-75 — §14's operational board. Not `exact`: the detail and
                create routes must keep the parent entry marked current. */}
            {item("/portal/admin/shipments", "Shipments")}
            {item("/portal/admin/quotes", "Freight quotes")}
            {/* M-94 — the manual-review queue. Dispatcher-visible, not
                admin-only: resolving an FMCSA timeout or a name that differs
                by more than punctuation is dispatch work, and a queue only
                admins can see is a queue that waits for an admin. Clearing an
                applicant lets them continue to the fee; it activates nothing,
                which is why it does not need the account-decision gate the
                broker partner surface has. */}
            {item("/portal/admin/carrier-verifications", "Carrier verifications")}
            {/* M-81 — §12's partner administration. ADMIN only: deciding who a
                counterparty is is an account decision, and M-58 established
                that dispatchers do not make those. Sharing one shipment is on
                the shipment page, where a dispatcher can reach it. */}
            {role === "admin" ? item("/portal/admin/brokers", "Broker partners") : null}
            {item("/portal/admin/support", "Support inbox")}
            {item("/portal/admin/posts", "Blog posts")}
            {role === "admin" ? item("/portal/admin/users", "Users") : null}
            {item("/portal/admin/mfa", "Two-factor auth")}
            {role === "admin"
              ? item("/portal/admin/security", "Security log")
              : null}
            {role === "admin"
              ? item("/portal/admin/settings", "Settings")
              : null}
          </>
        ) : role === "shipper" ? (
          <>
            <span className="plabel">{tv("Shipper portal")}</span>
            {item("/portal/shipper", tv("Overview"), true)}
            {item("/portal/shipper/quotes/new", tv("Request a Quote"))}
            {item("/portal/shipper/quotes", tv("My Quotes"), true)}
            {/* M-74 — §11's shipment list. Not `exact`: the detail route
                `/shipments/[id]` must keep the parent entry marked current. */}
            {item("/portal/shipper/shipments", tv("Shipments"))}
            {item("/portal/shipper/documents", tv("Documents"))}
            {item("/portal/shipper/billing", tv("Billing"))}
            {item("/portal/shipper/support", tv("Support"))}
            {item("/portal/shipper/company", tv("Company Settings"))}
            {item("/portal/shipper/settings", tv("Account Settings"))}
          </>
        ) : role === "broker" ? (
          <>
            {/* M-81 — §12's partner portal. FOUR entries would be three too
                many: §12 grants a broker partner a VIEW of shared shipments
                and nothing else, so there is no documents page (documents
                live on the shipment they belong to), no billing page (§12
                forbids it outright) and no company page (the organization is
                administered by PickLoads, which is what "admin-invited only"
                means). One entry, and the honest reason it is one. */}
            <span className="plabel">{tv("Partner portal")}</span>
            {/* Not `exact`: the detail route `/shipments/[id]` must keep this
                entry marked current, and it is the only entry there is. */}
            {item("/portal/broker", tv("Shared Shipments"))}
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
            {/* M-76 — §13's carrier update surface. Separate from "Loads" on
                purpose: dispatch loads and brokerage shipments are different
                products on different tables (plan §1), and one nav entry
                covering both would be the query mistake the architecture was
                designed to make impossible. */}
            {item("/portal/carrier/shipments", tv("Shipments"))}
            {item("/portal/carrier/invoices", tv("Invoices & Payments"))}
            {item("/portal/carrier/notifications", tv("Notifications"))}
            {item("/portal/carrier/support", tv("Support"))}
            {item("/portal/carrier/settings", tv("Account Settings"))}
          </>
        )}
        <span className="plabel">{tv("Site")}</span>
        <Link href="/">← {tv("Back to pickloads.com")}</Link>
        {/* Sign out is a WRITE — it destroys a session — so it is a form that
            posts to the canonical server action, not an anchor with an
            onClick. The old control was `<a href="#signout" onClick=…>`, which
            before hydration navigated to a fragment and did nothing at all,
            silently. Ending a session must not depend on JavaScript having
            loaded. */}
        <form action={signOutAction}>
          <input type="hidden" name="locale" value={locale} />
          <button type="submit" className="psignout">
            {tv("Sign out")}
          </button>
        </form>
        <div className="pfoot">
          {fullName ?? "—"}
          <br />
          {role.toUpperCase()}
        </div>
      </aside>
    </>
  );
}
