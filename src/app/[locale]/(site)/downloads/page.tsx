import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { JsonLd } from "@/components/seo/JsonLd";
import { PageHero } from "@/components/ui/PageHero";
import { DOWNLOAD_SECTIONS } from "@/content/downloads";
import { Link } from "@/i18n/navigation";
import { getV4 } from "@/i18n/v4-server";
import { absoluteUrl, pageMetadata } from "@/lib/seo";

/**
 * Downloads Center.
 *
 * ── THIS PAGE HAS NO DOWNLOAD BUTTONS, AND THAT IS THE POINT ─────────────
 *
 * `public/` holds no approved PDF and `packet_downloads_live` is false because
 * the four counsel-approved packet documents have never been uploaded. So the
 * page describes what a carrier needs to bring, sends authenticated users to
 * the portal that already holds their files, and offers nothing to click that
 * would not work.
 *
 * A downloads page with dead buttons is worse than none: it tells a carrier
 * the paperwork is ready when it is not.
 *
 * ── IT MINTS NO URLS ─────────────────────────────────────────────────────
 *
 * Every authenticated entry is a ROUTE into the portal. The certified document
 * architecture already issues 300-second signed URLs from authenticated server
 * components, under RLS, with an audit trail. A public marketing page has no
 * business holding a second key to that, so it does not have one — there is no
 * storage path, no bucket name and no signed URL anywhere in this render.
 *
 * The portal routes are behind middleware; an unauthenticated visitor
 * following one lands on `/login`, which the smoke suite already proves.
 *
 * ── PRIVATE DOCUMENTS ARE DESCRIBED, NEVER LISTED ────────────────────────
 *
 * The private tier explains where shipment and account documents live and
 * stops. It carries no route, because listing private artefacts on a public
 * page is the habit that ends with one of them being linkable.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    href: "/downloads",
    title: "Downloads & Documents — PickLoads Logistics Group",
    description:
      "What you need to get started with PickLoads, and where to find your account documents. Carrier and shipper documents live in your portal.",
  });
}

export default async function DownloadsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tv = await getV4(locale);

  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/", locale) },
      {
        "@type": "ListItem",
        position: 2,
        name: "Downloads",
        item: absoluteUrl("/downloads", locale),
      },
    ],
  };

  /** The honest reason a resource is not obtainable, in the user's language. */
  const reason = (why: string | undefined): string => {
    if (why === "login_required") {
      return tv("Sign in to your portal to see your documents.");
    }
    if (why === "after_onboarding") {
      return tv("Available after onboarding.");
    }
    return tv("Call us — a human picks up. (908) 404-5373, or email support@pickloads.com.");
  };

  return (
    <main id="main">
      <JsonLd data={breadcrumbs} />

      <PageHero eyebrow={tv("Resources")} title={tv("Downloads & documents")}>
        {tv(
          "What you need to get started, and where to find your account documents.",
        )}
      </PageHero>

      {DOWNLOAD_SECTIONS.map((section) => (
        <section className="light" key={section.slug} id={section.slug}>
          <div className="wrap">
            <h2 className="sec">{tv(section.label)}</h2>
            <p className="sub">{tv(section.note)}</p>

            <div className="values">
              {section.resources.map((resource) => (
                <div key={resource.label}>
                  <h3>{tv(resource.label)}</h3>
                  <p>{tv(resource.description)}</p>
                  {resource.href ? (
                    /* A route into the portal — which enforces the role. This
                       page grants nothing; it points. */
                    <p>
                      <Link className="btn btn-ghost" href={resource.href}>
                        {tv("Sign in")}
                      </Link>
                    </p>
                  ) : (
                    /* NOT a disabled button. A control that looks clickable
                       and is not teaches people to distrust every control. */
                    <div className="state state--empty">
                      <p>{reason(resource.unavailable)}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}

      <section className="light">
        <div className="wrap">
          <h2 className="sec">{tv("Related")}</h2>
          <p>
            <Link className="btn btn-ghost" href="/become-a-carrier">
              {tv("Become a Carrier")}
            </Link>{" "}
            <Link className="btn btn-ghost" href="/knowledge-base">
              {tv("Knowledge Base")}
            </Link>{" "}
            <Link className="btn btn-ghost" href="/contact">
              {tv("Contact")}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
