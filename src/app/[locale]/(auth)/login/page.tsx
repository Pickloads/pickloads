import type { Metadata } from "next";
import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { PageHero } from "@/components/ui/PageHero";
import { LoginForm } from "@/components/auth/LoginForm";
import { useV4 } from "@/i18n/v4";

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
  return <LoginContent />;
}

function LoginContent() {
  const tv = useV4();
  return (
    <main>
      <PageHero eyebrow={tv("Portal")} title={tv("Sign in to PickLoads")}>
        {tv(
          "Carriers: track your documents and agreement. Staff: leads, dispatch and operations.",
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
