import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { FreightQuoteForm } from "@/components/forms/FreightQuoteForm";
import { Link } from "@/i18n/navigation";
import { PageHero } from "@/components/ui/PageHero";
import { getBooleanSetting } from "@/lib/company-settings";
import { pageMetadata } from "@/lib/seo";
import { useV4 } from "@/i18n/v4";

/**
 * Request a Quote — the primary acquisition surface.
 *
 * ── ONE QUOTE SYSTEM, NOT TWO ────────────────────────────────────────────
 *
 * This page renders `FreightQuoteForm`, the same component `/shippers` uses,
 * posting to the same `submitFreightQuote` action, through the same
 * `guardPublicForm` stack (rate limit → Turnstile → Zod → service-role
 * insert → notification), writing the same `freight_quotes` row. Nothing about
 * the quote pipeline is duplicated or re-implemented here; the page supplies
 * the surrounding conversion context the home-page anchor could not.
 *
 * The one behavioural addition is the funnel instrumentation, and it lives
 * INSIDE the shared form so both surfaces measure identically rather than
 * drifting apart (§52).
 *
 * ── WHAT THE CTA USED TO POINT AT ────────────────────────────────────────
 *
 * Phase B's primary CTA sent "Request a Quote" to `/#quote`. That anchor is
 * the home page's CARRIER setup form — truck type, trailer, home state, truck
 * count — not a freight quote at all. A shipper following the site's single
 * loudest call to action landed on a form asking how many trucks they own.
 * `PRIMARY_CTA` now points here.
 *
 * ── THE BROKERAGE GATE (§14, §57, §73) ───────────────────────────────────
 *
 * `brokerage_active` is false and stays false until the MC authority and the
 * BMC-84 bond are real. The page therefore must not present PickLoads as
 * actively brokering freight — but it may collect a qualified inquiry, which
 * is what the approved `/shippers` copy already does and what the M-56
 * waitlist doctrine established.
 *
 * The distinction is drawn in the copy, not in the plumbing: nothing on this
 * page can create a shipment, and `trg_shipments_brokerage_gate` would refuse
 * it at the database if it tried. A freight_quotes row is an inquiry, not a
 * brokered load.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return pageMetadata({
    locale,
    href: "/request-a-quote",
    title: "Request a Freight Quote — PickLoads Logistics Group",
    description:
      "Tell us about your shipment — pickup, delivery, dates and equipment — and our team replies by email. Full truckload and partial freight with vetted carriers and milestone tracking.",
  });
}

export default async function RequestAQuotePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const brokerageActive = await getBooleanSetting("brokerage_active");
  return <QuoteContent brokerageActive={brokerageActive} />;
}

function QuoteContent({ brokerageActive }: { brokerageActive: boolean }) {
  const tv = useV4();

  return (
    <main id="main">
      <PageHero
        eyebrow={tv("For shippers")}
        title={tv("Request a freight quote")}
      >
        {tv(
          "Full truckload and partial solutions with vetted carriers, milestone tracking and one point of contact from pickup to proof of delivery.",
        )}
      </PageHero>

      {/* THE FORM FIRST. §15 asks for a low-friction first step, and a
          conversion page that makes a visitor scroll past three sections of
          reassurance before it will accept their shipment is not low
          friction. Everything below the form is support material for the
          undecided, not a gate for the decided. */}
      <section className="light">
        <div className="wrap">
          <FreightQuoteForm
            surface="request-a-quote"
            brokerageActive={brokerageActive}
          />

          {!brokerageActive ? (
            <div className="state state--empty" style={{ marginTop: 22 }}>
              <h3>{tv("Brokerage operations open with our MC activation")}</h3>
              <p>
                {tv(
                  "Brokerage operations open with our MC activation; early requests get priority onboarding.",
                )}
              </p>
            </div>
          ) : null}
        </div>
      </section>

      {/* §23's shipper flow, stated as fact rather than promise. Each step is
          something the platform actually does today — the tracking step is
          M-73's real page, the POD step is M-77's real document store. */}
      <section className="light">
        <div className="wrap">
          <h2>{tv("How it works")}</h2>
          <div className="values">
            <div>
              <h3>{tv("1. Request a quote")}</h3>
              <p>{tv("Tell us pickup, delivery, dates and equipment.")}</p>
            </div>
            <div>
              <h3>{tv("2. Confirm the shipment")}</h3>
              <p>
                {tv(
                  "We review the lane and come back to you with a rate and a plan.",
                )}
              </p>
            </div>
            <div>
              <h3>{tv("3. Freight moves")}</h3>
              <p>{tv("One point of contact from pickup to delivery.")}</p>
            </div>
            <div>
              <h3>{tv("4. Track progress")}</h3>
              <p>
                {tv(
                  "Updates are entered by our dispatch team as milestones are confirmed. This page does not show a live GPS position.",
                )}
              </p>
            </div>
            <div>
              <h3>{tv("5. Delivery and POD")}</h3>
              <p>
                {tv(
                  "Proof of delivery is uploaded and made available to you.",
                )}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* NO DEAD END. Whatever happens with the form, there is another way
          through: an existing customer tracks, and anyone stuck can call. */}
      <section className="light">
        <div className="wrap">
          <h2>{tv("Already shipping with us?")}</h2>
          <p>
            {tv(
              "Track a shipment with your tracking number, or sign in to see everything in one place.",
            )}
          </p>
          <p>
            {/* `Link` from @/i18n/navigation, not a raw anchor: it carries
                the locale prefix, so /es/request-a-quote does not send a
                Spanish-speaking visitor to the English tracking page. */}
            <Link className="btn btn-ghost" href="/track">
              {tv("Track Shipment")}
            </Link>{" "}
            <Link className="btn btn-ghost" href="/portal">
              {tv("Client Login")}
            </Link>
          </p>
          <p className="mono" style={{ fontSize: ".8rem" }}>
            {tv("Questions now? Call (908) 404-5373 or email support@pickloads.com")}
          </p>
        </div>
      </section>
    </main>
  );
}
