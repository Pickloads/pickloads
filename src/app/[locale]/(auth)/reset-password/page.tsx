import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PageHero } from "@/components/ui/PageHero";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { useV4 } from "@/i18n/v4";

export const metadata: Metadata = {
  title: "Choose a New Password — PickLoads Logistics Group",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ResetPasswordContent />;
}

function ResetPasswordContent() {
  const tv = useV4();
  return (
    <main>
      <PageHero eyebrow={tv("Portal")} title={tv("Set a new password")}>
        {tv("You're one step from being back in your portal.")}
      </PageHero>
      <section className="light" style={{ padding: "56px 0 88px" }}>
        <div className="wrap">
          <ResetPasswordForm />
        </div>
      </section>
    </main>
  );
}
