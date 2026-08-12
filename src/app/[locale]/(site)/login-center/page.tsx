import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { JsonLd } from "@/components/seo/JsonLd";
import { PageHero } from "@/components/ui/PageHero";
import { Link } from "@/i18n/navigation";
import { getV4 } from "@/i18n/v4-server";
import { absoluteUrl, pageMetadata } from "@/lib/seo";

/**
 * Login Center — a routing surface, not an authentication layer.
 *
 * ── IT AUTHENTICATES NOTHING ─────────────────────────────────────────────
 *
 * Every door below is a link to the existing `/login` (or `/portal`, the
 * two-door chooser). There is no form here, no credential field, no session
 * handling and no role logic. Role routing stays exactly where M-54 put it:
 * server-side, after sign-in, from the profile. A second place that decides
 * where a user lands is a second place to get it wrong, and the wrong outcome
 * is somebody in the wrong portal.
 *
 * ── THE APPROVED POSTURE ─────────────────────────────────────────────────
 *
 * Three customer doors — shipper, carrier, broker partner. Dispatcher and
 * admin get NO public door: they sign in through the same `/login` and the
 * server sends them where they belong. One low-emphasis "Staff sign-in" link
 * exists so staff are not stranded, and it is the least prominent thing on
 * the page.
 *
 * Naming internal portals in public navigation buys an attacker
 * reconnaissance — which surfaces exist, what roles the system has — and buys
 * a customer nothing at all.
 *
 * ── THE BROKER DOOR IS REAL ──────────────────────────────────────────────
 *
 * `/portal/broker` exists (M-81) with its own RLS, membership model and DTO.
 * It is listed because it is built, not because the posture named it.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    href: "/login-center",
    title: "Sign in — PickLoads Logistics Group",
    description:
      "Sign in to your PickLoads account: shipper, carrier or broker partner.",
  });
}

/** The three customer doors. Every href is an existing route. */
const DOORS = [
  {
    label: "Client Login",
    note: "Request quotes and coordinate freight with vetted carriers — and follow every request in one place.",
    href: "/portal",
  },
  {
    label: "Carrier Login",
    note: "Documents, agreements, loads and invoices in one place — yours, not a shared inbox.",
    href: "/portal",
  },
  {
    label: "Broker Partner Login",
    note: "Authorized broker partners can follow the shipments shared with them.",
    href: "/login",
  },
] as const;

export default async function LoginCenterPage({
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
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: absoluteUrl("/", locale),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Sign in",
        item: absoluteUrl("/login-center", locale),
      },
    ],
  };

  return (
    <main id="main">
      <JsonLd data={breadcrumbs} />

      <PageHero eyebrow={tv("Sign in")} title={tv("Sign in to PickLoads")}>
        {tv(
          "Carriers and shippers each have their own workspace — pick yours to sign in or create an account.",
        )}
      </PageHero>

      <section className="light">
        <div className="wrap">
          <div className="values">
            {DOORS.map((door) => (
              <div key={door.label}>
                <h3>{tv(door.label)}</h3>
                <p>{tv(door.note)}</p>
                <p>
                  <Link className="btn btn-amber" href={door.href}>
                    {tv("Sign in")}
                  </Link>
                </p>
              </div>
            ))}
          </div>

          <p style={{ marginTop: 26 }}>
            <Link className="btn btn-ghost" href="/create-account">
              {tv("Get Started →")}
            </Link>
          </p>

          {/* The single internal entry. Deliberately last, deliberately the
              least prominent thing on the page, and deliberately unnamed as to
              which internal portals exist. */}
          <p className="mono" style={{ fontSize: ".78rem", marginTop: 22 }}>
            <Link className="foot-staff" href="/login">
              {tv("Staff sign-in")}
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
