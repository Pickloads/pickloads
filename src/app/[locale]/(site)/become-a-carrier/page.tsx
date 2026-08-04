import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PageHero } from "@/components/ui/PageHero";
import { CarrierWizard } from "@/components/onboarding/CarrierWizard";
import { isEsignConfigured } from "@/lib/esign";
import { getV4 } from "@/i18n/v4-server";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    href: "/become-a-carrier",
    title: "Become a Carrier — PickLoads Logistics Group",
    description:
      "Onboard with PickLoads in about 10 minutes: company info, secure document upload, plain-English dispatch agreement and your own carrier portal. No forced dispatch, no exit fees.",
  });
}

export default async function BecomeACarrierPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tv = await getV4(locale);
  const esignLive = isEsignConfigured();

  return (
    <main id="main">
      <PageHero
        eyebrow={tv("Carrier onboarding")}
        title={tv("On the road with us in 24 hours.")}
      >
        {tv(
          "Four steps, about 10 minutes: your company info, your documents, a plain-English agreement and your own portal. A dispatcher calls you the same day.",
        )}
      </PageHero>
      <section className="light" style={{ paddingTop: 48 }}>
        <div className="wrap">
          <CarrierWizard esignLive={esignLive} />
          <p
            className="mono"
            style={{
              fontSize: ".72rem",
              color: "var(--color-slate-aa)",
              marginTop: 26,
            }}
          >
            {"// "}
            {tv(
              "Prefer a human? Call (908) 404-5373 and we'll complete onboarding with you over the phone.",
            )}
          </p>
        </div>
      </section>
    </main>
  );
}
