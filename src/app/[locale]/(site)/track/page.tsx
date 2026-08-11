import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHero } from "@/components/ui/PageHero";
import { TrackingLookup } from "@/components/tracking/TrackingLookup";
import { getBooleanSetting } from "@/lib/company-settings";
import { pageMetadata } from "@/lib/seo";

/**
 * M-73 — the public secure tracking page (`docs/DIRECTIVE-tracking.md` §4,
 * §8, §19, §25, §30).
 *
 * ── WHAT THIS SERVER COMPONENT DOES AND DOES NOT DO ───────────────────────
 *
 * It renders a FORM. It reads no shipment, holds no service-role client and
 * takes no search parameter. Every byte of shipment data on this route arrives
 * through a POST server action after two factors, a rate limit and a Turnstile
 * challenge (`src/app/actions/public-tracking.ts`).
 *
 * That is what makes §25's "never cache private shipment data publicly" true
 * BY CONSTRUCTION rather than by configuration. The plan flagged `/blog`'s ISR
 * as the pattern to avoid leaking here; there is nothing to leak, because the
 * cacheable artifact — this prerendered shell — contains no shipment. No
 * `revalidate`, no `unstable_cache` over shipment data, no `force-dynamic`
 * needed either: a static shell plus an uncacheable POST is strictly safer
 * than a dynamic page that renders data into HTML.
 *
 * ── SEO / PRIVACY ─────────────────────────────────────────────────────────
 *
 * `/track` itself is a legitimate public landing page and IS indexable and IS
 * in the sitemap (`PUBLIC_ROUTES` in `src/lib/seo.ts`). Individual RESULTS are
 * neither, twice over: they have no URL at all, and `TrackingResult` renders a
 * `noindex, nofollow` robots meta while it is on screen.
 *
 * ── §2 HONEST STATE ───────────────────────────────────────────────────────
 *
 * While `company_settings.brokerage_active` is false, migration 0017's gate
 * trigger refuses to create a shipment at all, so every lookup would honestly
 * return "no match". Saying nothing would leave a visitor to conclude they
 * typed something wrong. The notice says what is actually true — brokerage
 * shipments start when the MC authority and BMC-84 bond are active, and
 * dispatch customers track loads in the Carrier Portal — without claiming
 * brokerage is live, which §2 forbids. `getBooleanSetting` fails CLOSED, so an
 * unreachable switchboard shows the honest waitlist wording rather than
 * implying an active brokerage.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "shipment" });
  return pageMetadata({
    locale,
    href: "/track",
    title: t("page.meta_title"),
    description: t("page.meta_description"),
  });
}

export default async function TrackPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "shipment" });
  const brokerageActive = await getBooleanSetting("brokerage_active");

  return (
    <main id="main">
      <PageHero eyebrow={t("page.eyebrow")} title={t("page.title")}>
        {t("page.intro")}
      </PageHero>

      <section className="light">
        <div className="wrap">
          {brokerageActive ? null : (
            <div className="track-banner is-neutral" role="note">
              {/* M-82: this was an <h3> directly under the hero's <h1>, with
                  no <h2> between them — a skipped heading level on the one
                  public tracking page, in all five locales. §23 asks for
                  "correct headings"; axe's `heading-order` rule is tagged
                  best-practice rather than WCAG A/AA, which is why six modules
                  of scanning never reported it. */}
              <h2>{t("page.title")}</h2>
              <p>{t("page.gate_notice")}</p>
            </div>
          )}

          {/*
            M-79: `TrackingLookup` now reads `?number=` (the tracking link
            §17 puts in every notification email) through `useSearchParams`.
            Next.js requires a Suspense boundary around a client component
            that does so on a statically rendered route — and that boundary is
            what KEEPS this route static, which is the property §25's "never
            cache private shipment data publicly" rests on: the cacheable
            shell contains no shipment, only a form.
          */}
          <Suspense fallback={null}>
            <TrackingLookup />
          </Suspense>

          {/*
            M-84 — the honest no-JavaScript answer.

            `TrackingLookup` is a client component that reads `?number=`
            through `useSearchParams`, which makes Next.js render that subtree
            on the client even on this statically prerendered route. That is
            the right trade for §25 (the cacheable shell holds no shipment),
            but it has a consequence nothing in the suite had stated: with
            scripting off, the one public tracking entry point renders an
            empty panel under a heading that promises a lookup.

            §30's rule is about not saying false things, and a blank form is a
            false thing said silently. This block is server-rendered, so it is
            in the static HTML whether or not the bundle ever runs, and CSS
            hides it the moment scripting is available. It states what is
            actually true and gives the number a person can call instead.
          */}
          <noscript>
            <div className="track-banner is-neutral" role="note">
              <p>{t("page.noscript_body")}</p>
              <p>
                <a className="btn btn-amber" href="tel:+19084045373">
                  (908) 404-5373
                </a>
              </p>
            </div>
          </noscript>

          <section className="track-section" aria-labelledby="track-help">
            <h2 id="track-help">{t("page.help_title")}</h2>
            <p className="sub" style={{ maxWidth: 760 }}>
              {t("page.help_body")}
            </p>
          </section>
        </div>
      </section>
    </main>
  );
}
