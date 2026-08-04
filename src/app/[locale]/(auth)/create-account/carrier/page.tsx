import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import { getSessionProfile, portalHomeFor } from "@/lib/auth";
import { PageHero } from "@/components/ui/PageHero";
import { CreateCarrierForm } from "@/components/auth/CreateCarrierForm";
import { useV4 } from "@/i18n/v4";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create Carrier Account — PickLoads Logistics Group",
  robots: { index: false, follow: false },
};

/**
 * M-52 — carrier registration (directive fields + authority-status routing).
 * The account is created first; onboarding (documents, agreement) continues
 * in the existing M-20 wizard for active-authority carriers.
 */
export default async function CreateCarrierAccountPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  // M-54: signed-in visitors are role-routed to their portal home.
  const session = await getSessionProfile();
  if (session && session.status !== "suspended") {
    redirect(getPathname({ href: portalHomeFor(session.role), locale }));
  }
  return <CarrierAccountContent />;
}

function CarrierAccountContent() {
  const tv = useV4();
  return (
    <main id="main">
      <PageHero eyebrow={tv("Portal")} title={tv("Create your carrier account")}>
        {tv(
          "Tell us where your authority stands and we'll route you to the right next step — onboarding, tracking, or launch help.",
        )}
      </PageHero>
      <section className="light" style={{ padding: "56px 0 88px" }}>
        <div className="wrap">
          <CreateCarrierForm />
        </div>
      </section>
    </main>
  );
}
