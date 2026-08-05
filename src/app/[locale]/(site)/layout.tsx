import { Topbar } from "@/components/layout/Topbar";
import { SiteNav } from "@/components/layout/SiteNav";
import { Footer } from "@/components/layout/Footer";
import { CallFab } from "@/components/layout/CallFab";
import { PortalToast } from "@/components/ui/PortalToast";
import { SkipLink } from "@/components/ui/SkipLink";
import { ConsentAnalytics } from "@/components/analytics/ConsentAnalytics";
import { getBooleanSetting } from "@/lib/company-settings";

/**
 * Shared public-site chrome (topbar, nav, footer, toast, mobile call FAB).
 *
 * M-69/P-3: the footer's `/shippers` label is gated on `brokerage_active`.
 * The read goes through src/lib/company-settings.ts, which uses a
 * cookie-less anon client — so adding it here does NOT pull `cookies()` in
 * and does NOT turn the statically prerendered public site dynamic.
 */
export default async function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const brokerageActive = await getBooleanSetting("brokerage_active");
  return (
    <>
      <SkipLink />
      <Topbar />
      <SiteNav />
      {children}
      <Footer brokerageActive={brokerageActive} />
      <PortalToast />
      <CallFab />
      <ConsentAnalytics />
    </>
  );
}
