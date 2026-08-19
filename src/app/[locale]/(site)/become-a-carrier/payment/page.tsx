import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { PageHero } from "@/components/ui/PageHero";
import { getV4 } from "@/i18n/v4-server";
import { resolveWizardResume } from "@/lib/carrier-authority/wizard-resume";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    ...pageMetadata({
      locale,
      href: "/become-a-carrier/payment",
      title: "Verification fee — PickLoads Logistics Group",
      description:
        "Confirming your PickLoads carrier verification fee with Stripe.",
    }),
    robots: { index: false, follow: false },
  };
}

/**
 * M-95 — where Stripe sends the applicant back.
 *
 * ── THE QUERY PARAMETER DECIDES THE WORDING AND NOTHING ELSE ─────────────
 *
 * `?return=success` is on the URL because Stripe put it there, and anybody can
 * type it. So it selects a sentence — "thanks, we're confirming" versus "you
 * cancelled" — and the actual state comes from `resolveWizardResume()`, which
 * reads the pre-registration and the payments ledger on the server.
 *
 * A visitor who types `?return=success` with no payment sees the page telling
 * them the fee is still outstanding, because that is what the database says.
 *
 * ── WHY "STILL CONFIRMING" IS A REAL STATE AND NOT A BUG ─────────────────
 *
 * Stripe redirects the browser the instant the payment succeeds; the WEBHOOK
 * that records it arrives independently, usually within a second or two, but
 * not always before the redirect lands. So there is a genuine window where the
 * applicant has paid and our ledger does not yet say so.
 *
 * The honest answer is to say exactly that and let them refresh — not to trust
 * the redirect and let them through, which is the shortcut this whole module
 * exists to refuse.
 */
export default async function CarrierPaymentReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ return?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tv = await getV4(locale);
  const { return: returnKind } = await searchParams;
  const cancelled = returnKind === "cancelled";

  const resume = await resolveWizardResume();

  const body = (() => {
    switch (resume.step) {
      case "company":
        return {
          title: tv("Payment received. Thank you."),
          tone: "ok" as const,
          lines: [
            tv(
              "Your $9.99 verification fee is confirmed. Your account is not active yet — documents, the dispatch agreement and our compliance review still apply.",
            ),
          ],
          cta: tv("Continue to Company Info →"),
        };
      case "fee":
        return cancelled
          ? {
              title: tv("Payment cancelled — nothing was charged."),
              tone: "info" as const,
              lines: [
                tv(
                  "You left the payment page before it completed, so no money has moved. Your carrier verification is still valid and you can pay whenever you're ready.",
                ),
              ],
              cta: tv("Back to the verification fee →"),
            }
          : {
              title: tv("We're confirming your payment."),
              tone: "info" as const,
              lines: [
                tv(
                  "Stripe confirms payments to us directly rather than through your browser, which occasionally takes a few seconds. Refresh this page in a moment.",
                ),
                tv(
                  "If it still says this after a minute, nothing is lost — call (908) 404-5373 and we'll find the payment.",
                ),
              ],
              cta: tv("Back to the verification fee →"),
            };
      case "already_onboarded":
        return {
          title: tv("This application already has an account."),
          tone: "ok" as const,
          lines: [
            tv("Sign in to your portal to carry on where you left off."),
          ],
          cta: tv("Sign in to your portal →"),
        };
      default:
        return {
          title: tv("Let's pick up where you left off."),
          tone: "info" as const,
          lines: [
            tv(
              "We couldn't match this to a verified application. Nothing has been charged.",
            ),
          ],
          cta: tv("Back to carrier onboarding →"),
        };
    }
  })();

  const href =
    resume.step === "already_onboarded" ? "/login" : "/become-a-carrier";

  return (
    <main id="main">
      <PageHero eyebrow={tv("Carrier onboarding")} title={body.title}>
        {body.lines[0]}
      </PageHero>
      <section className="light" style={{ paddingTop: 48 }}>
        <div className="wrap">
          <div className="bigform">
            <div
              className={body.tone === "ok" ? "form-ok show" : "form-err show"}
              role="status"
            >
              {body.lines.map((line) => (
                <p key={line} style={{ margin: "4px 0" }}>
                  {line}
                </p>
              ))}
            </div>
            <div
              style={{
                marginTop: 22,
                display: "flex",
                gap: 14,
                flexWrap: "wrap",
              }}
            >
              <Link className="btn btn-amber" href={href}>
                {body.cta}
              </Link>
              <a className="btn btn-dark" href="tel:+19084045373">
                {tv("Questions? (908) 404-5373")}
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
