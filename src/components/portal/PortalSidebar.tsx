"use client";

import { Link, usePathname } from "@/i18n/navigation";
import { Logo } from "@/components/ui/Logo";
import { createClient } from "@/lib/supabase/client";
import type { UserRole } from "@/lib/supabase/database.types";

/** M-23 portal navigation — V4 vocabulary on the dark shell (U-10). */
export function PortalSidebar({
  role,
  fullName,
}: {
  role: UserRole;
  fullName: string | null;
}) {
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
          {item("/portal/admin/posts", "Blog posts")}
          {role === "admin" ? item("/portal/admin/settings", "Settings") : null}
        </>
      ) : role === "shipper" ? (
        <>
          <span className="plabel">Shipper portal</span>
          {item("/portal/shipper", "My Quotes", true)}
          <Link href="/shippers">Request a quote</Link>
        </>
      ) : (
        <>
          <span className="plabel">Carrier portal</span>
          {item("/portal/carrier", "My Documents", true)}
          {item("/portal/carrier/loads", "My Loads")}
          {item("/portal/carrier/profile", "My Profile")}
        </>
      )}
      <span className="plabel">Site</span>
      <Link href="/">← Back to pickloads.com</Link>
      <a
        href="#signout"
        onClick={(e) => {
          e.preventDefault();
          void signOut();
        }}
      >
        Sign out
      </a>
      <div className="pfoot">
        {fullName ?? "—"}
        <br />
        {role.toUpperCase()}
      </div>
    </aside>
  );
}
