import { Topbar } from "@/components/layout/Topbar";
import { SiteNav } from "@/components/layout/SiteNav";
import { Footer } from "@/components/layout/Footer";
import { CallFab } from "@/components/layout/CallFab";
import { PortalToast } from "@/components/ui/PortalToast";
import { ConsentAnalytics } from "@/components/analytics/ConsentAnalytics";

/** Shared public-site chrome (topbar, nav, footer, toast, mobile call FAB). */
export default function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Topbar />
      <SiteNav />
      {children}
      <Footer />
      <PortalToast />
      <CallFab />
      <ConsentAnalytics />
    </>
  );
}
