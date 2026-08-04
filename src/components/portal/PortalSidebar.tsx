"use client";

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

  const item = (href: string, label: string, exact = false) => {
    const active = exact ? pathname === href : pathname.startsWith(href);
    return (
      <Link href={href} className={active ? "active" : undefined}>
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
    <aside className="pside">
      <div style={{ padding: "4px 6px 10px" }}>
        <Logo small />
      </div>
      {isStaff ? (
        <>
          <span className="plabel">Dispatch desk</span>
          {item("/portal/admin", "Dashboard", true)}
          {item("/portal/admin/leads", "Leads CRM")}
          {item("/portal/admin/loads", "Loads")}
          {item("/portal/admin/support", "Support inbox")}
          {item("/portal/admin/posts", "Blog posts")}
          {role === "admin" ? item("/portal/admin/users", "Users") : null}
          {role === "admin" ? item("/portal/admin/security", "Security log") : null}
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
  );
}
