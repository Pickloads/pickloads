import "@/app/portal.css";
import { getSessionProfile } from "@/lib/auth";
import { MfaGraceBanner } from "@/components/portal/MfaGraceBanner";
import { PortalSidebar } from "@/components/portal/PortalSidebar";
import { SkipLink } from "@/components/ui/SkipLink";

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
  // M-51: no session → the only reachable child is the pre-auth /portal
  // selection page (middleware guards every subpath), which brings its own
  // public chrome — render it without the sidebar shell.
  if (!session) return <>{children}</>;
  return (
    <div className="portal">
      <SkipLink />
      <PortalSidebar role={session.role} fullName={session.fullName} />
      <div className="pmain">
        {/* M-61 (D3): dispatcher MFA countdown — self-hiding, staff only. */}
        <MfaGraceBanner session={session} />
        {children}
      </div>
    </div>
  );
}
