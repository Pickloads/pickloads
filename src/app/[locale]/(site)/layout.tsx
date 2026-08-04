import { Topbar } from "@/components/layout/Topbar";
import { SiteNav } from "@/components/layout/SiteNav";
import { Footer } from "@/components/layout/Footer";
import { CallFab } from "@/components/layout/CallFab";
import { PortalToast } from "@/components/ui/PortalToast";
import { SkipLink } from "@/components/ui/SkipLink";
import { ConsentAnalytics } from "@/components/analytics/ConsentAnalytics";

/** Shared public-site chrome (topbar, nav, footer, toast, mobile call FAB). */
export default function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <SkipLink />
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
