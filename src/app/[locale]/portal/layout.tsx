import "@/app/portal.css";
import { getSessionProfile } from "@/lib/auth";
import { PortalSidebar } from "@/components/portal/PortalSidebar";

/**
 * M-23 portal shell — sidebar + main pane. Auth/role enforcement lives in
 * each page (requireProfile/requireStaff/requireAdmin); the middleware has
 * already bounced anonymous traffic, so a missing session here only happens
 * mid-logout — pages handle the redirect.
 */
export default async function PortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSessionProfile();
  return (
    <div className="portal">
      {session ? (
        <PortalSidebar role={session.role} fullName={session.fullName} />
      ) : (
        <aside className="pside" />
      )}
      <div className="pmain">{children}</div>
    </div>
  );
}
