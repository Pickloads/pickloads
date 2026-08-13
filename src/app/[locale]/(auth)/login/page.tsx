import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import { getSessionProfile, portalHomeFor } from "@/lib/auth";
import { PageHero } from "@/components/ui/PageHero";
import { LoginForm } from "@/components/auth/LoginForm";
import { useV4 } from "@/i18n/v4";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign In — PickLoads Logistics Group",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // M-54: an already-authenticated visitor is role-routed to their home
  // (carrier/shipper/dispatcher/admin) — except suspended accounts, which
  // must be able to see the clear error state below.
  const session = await getSessionProfile();
  if (session && session.status !== "suspended") {
    redirect(getPathname({ href: portalHomeFor(session.role), locale }));
  }
  return <LoginContent />;
}

function LoginContent() {
  const tv = useV4();
  return (
    <main id="main">
      {/* P0/8: the hero named carriers and staff only, so a shipper arriving
          from their own verification email was told twice that this page was
          not for them. */}
      <PageHero eyebrow={tv("Portal")} title={tv("Sign in to PickLoads")}>
        {tv(
          "Carriers: documents and agreement. Shippers: quotes and shipments. Staff: leads, dispatch and operations.",
        )}
      </PageHero>
      <section className="light" style={{ padding: "56px 0 88px" }}>
        <div className="wrap">
          {/* useSearchParams (?next=) requires a Suspense boundary */}
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
