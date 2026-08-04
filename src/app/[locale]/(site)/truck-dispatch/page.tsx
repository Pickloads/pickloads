import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PageHero } from "@/components/ui/PageHero";
import { CtaBand } from "@/components/sections/CtaBand";
import { getV4 } from "@/i18n/v4-server";
import { pageMetadata } from "@/lib/seo";
import { STATE_CONTENT, STATE_SLUGS } from "@/content/states";

/**
 * M-35 — /truck-dispatch index: the six priority state pages + an honest
 * "more coming" note (arch: 4–6 new states/month is the content cadence).
 * V4 vocabulary: PageHero + .eq-grid cards (same card language as the
 * equipment grid).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    href: "/truck-dispatch",
    title: "Truck Dispatch by State — Local Lanes, Local Knowledge | PickLoads",
    description:
      "State-by-state truck dispatch guides: lanes, ports, realistic rates and state-specific requirements for owner-operators — starting with NJ, NY, FL, GA, TX and IL.",
  });
}

export default async function TruckDispatchIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tv = await getV4(locale);

  return (
    <main id="main">
      <PageHero
        eyebrow={tv("Truck dispatch by state")}
        title={tv("Local lanes. Local knowledge.")}
      >
        {tv(
          "Freight isn't national — it's a chain of local markets. Each state guide covers the lanes, ports, realistic rates and state-specific requirements we dispatch every week.",
        )}
      </PageHero>

      <section>
        <div className="wrap">
          <div className="eq-grid">
            {STATE_SLUGS.map((slug) => {
              const s = STATE_CONTENT[slug];
              return (
                <Link
                  className="eq-card"
                  key={slug}
                  href={`/truck-dispatch/${slug}`}
                >
                  <span className="mm">
                    {s.code} · {s.abbr}
                  </span>
                  <h3>{tv(s.name)}</h3>
                  <p>{s.blurb}</p>
                </Link>
              );
            })}
          </div>
          <p
            className="mono"
            style={{ fontSize: ".78rem", color: "var(--color-steel)", marginTop: 28 }}
          >
            {"// "}
            {tv(
              "More states are being written — we publish new state guides every month. Run somewhere else? We dispatch all 48 contiguous states; call (908) 404-5373.",
            )}
          </p>
        </div>
      </section>

      <CtaBand />
    </main>
  );
}
