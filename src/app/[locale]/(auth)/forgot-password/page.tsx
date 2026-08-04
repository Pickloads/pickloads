import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PageHero } from "@/components/ui/PageHero";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { useV4 } from "@/i18n/v4";

export const metadata: Metadata = {
  title: "Reset Password — PickLoads Logistics Group",
  robots: { index: false, follow: false },
};

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ForgotPasswordContent />;
}

function ForgotPasswordContent() {
  const tv = useV4();
  return (
    <main>
      <PageHero eyebrow={tv("Portal")} title={tv("Forgot your password?")}>
        {tv(
          "It happens on the road. Enter your email and we'll get you back into your portal.",
        )}
      </PageHero>
      <section className="light" style={{ padding: "56px 0 88px" }}>
        <div className="wrap">
          <ForgotPasswordForm />
        </div>
      </section>
    </main>
  );
}
