import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PageHero } from "@/components/ui/PageHero";
import { Link } from "@/i18n/navigation";
import { CarrierWizard } from "@/components/onboarding/CarrierWizard";
import { isEsignConfigured } from "@/lib/esign";
import { getV4 } from "@/i18n/v4-server";
import { ONBOARDING_TIMING } from "@/lib/copy/onboarding-timing";
import { resolveWizardResume } from "@/lib/carrier-authority/wizard-resume";
import { pageMetadata } from "@/lib/seo";

/**
 * M-95: this page reads an httpOnly cookie and the database to decide which
 * step the applicant is on, so it renders per request rather than at build.
 *
 * The cost is real and worth naming: this was a statically generated marketing
 * page. It stopped being one because an applicant who pays on Stripe comes
 * back through a fresh page load, and a fresh page load that always restarted
 * the wizard would look — to somebody who had just been charged $9.99 — like
 * losing their money. The alternative was resolving the step in the browser,
 * which would mean the client deciding where it is in a payment flow.
 */
export const dynamic = "force-dynamic";

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
      "Onboarding starts with an FMCSA check of your USDOT and MC — then documents, a plain-English dispatch agreement and your own carrier portal. No forced dispatch, no exit fees.",
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
  const resume = await resolveWizardResume();

  return (
    <main id="main">
      {/* Owner decision A3 (2026-08-12): the title was "On the road with us
          in 24 hours." Headline and qualifier now both come from the shared
          constant — this page and the homepage section made the same promise
          and only one of them would have been remembered on the next edit. */}
      <PageHero
        eyebrow={tv("Carrier onboarding")}
        title={tv(ONBOARDING_TIMING.headline)}
      >
        {/* M-94 §23: the old sentence described a four-step flow that started
            with a company-info form. Verification now comes first, and the
            hero has to say so — a visitor who is told "your company info" and
            then meets a USDOT check has been mis-sold the next click. */}
        {tv(
          "It starts with verification: we check your USDOT and MC with FMCSA before anything else. Then your documents, a plain-English agreement and your own portal.",
        )}{" "}
        {tv(ONBOARDING_TIMING.qualifier)}
      </PageHero>
      <section className="light" style={{ paddingTop: 48 }}>
        <div className="wrap">
          <CarrierWizard esignLive={esignLive} resume={resume} />
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

      {/* §17 — WHO, WHAT IS NEEDED, WHAT HAPPENS NEXT.
          Every string below already exists in the approved V4 dictionary or
          restates a documented fact about the onboarding the wizard actually
          performs. Nothing is newly authored: final marketing copy is Cowork's.

          DELIBERATELY ABSENT: any earnings figure, any guaranteed-loads claim,
          and any carrier rating. Internal carrier performance data is
          §25/§C internal-only — it has no public surface and must never get
          one. An e2e test asserts this page exposes none. */}
      <section className="light">
        <div className="wrap">
          <h2 className="sec">{tv("What you need to get started")}</h2>
          <div className="values">
            <div>
              <h3>{tv("Your operating authority")}</h3>
              <p>
                {tv(
                  "MC/DOT, W-9, certificate of insurance and a voided check — uploaded in one secure form.",
                )}
              </p>
            </div>
            <div>
              <h3>{tv("A signed dispatch agreement")}</h3>
              <p>
                {tv(
                  "Review the dispatch agreement and sign from your phone. No printer, no fax.",
                )}
              </p>
            </div>
            <div>
              <h3>{tv("Your own portal")}</h3>
              <p>
                {tv(
                  "Documents, agreements, loads and invoices in one place — yours, not a shared inbox.",
                )}
              </p>
            </div>
            <div>
              <h3>{tv("No forced dispatch")}</h3>
              <p>{tv("No forced dispatch — you approve every load")}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="light">
        <div className="wrap">
          <h2 className="sec">{tv("Carrier resources")}</h2>
          <p>
            <Link className="btn btn-ghost" href="/dispatch-services">
              {tv("Dispatch Services")}
            </Link>{" "}
            <Link className="btn btn-ghost" href="/start-your-trucking-company">
              {tv("Start Your Trucking Company")}
            </Link>{" "}
            <Link className="btn btn-ghost" href="/faq">
              {tv("Carrier FAQ")}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
