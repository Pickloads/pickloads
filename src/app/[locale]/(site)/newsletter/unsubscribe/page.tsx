import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { PageHero } from "@/components/ui/PageHero";
import { getV4 } from "@/i18n/v4-server";
import { UnsubscribeForm } from "@/components/forms/UnsubscribeForm";
import { normalizeUnsubscribeToken } from "@/lib/newsletter";
import { lookupUnsubscribe } from "@/lib/newsletter-unsubscribe";

/**
 * M-69 / P-1 — locale-aware newsletter unsubscribe page (CAN-SPAM).
 *
 * `subscribers.unsubscribed_at` has existed since 0001 with no writer, while
 * the confirmation email promises "unsubscribe anytime". This page is the
 * human half of the fix; /api/newsletter/unsubscribe is the RFC 8058
 * one-click half.
 *
 * The GET you are reading NEVER unsubscribes. It only LOOKS the token up and
 * renders a confirmation with a POST button. Corporate link scanners
 * (Outlook Safe Links, Proofpoint, Barracuda) fetch every URL in an email;
 * a GET side effect would silently remove people who never clicked.
 *
 * Honest states, in order of precedence:
 *   no token / malformed  → "this link isn't complete"
 *   unknown token         → same wording as malformed (no enumeration signal)
 *   no service-role key   → "we can't reach the list" + support mailbox
 *   already unsubscribed  → the SUCCESS confirmation (idempotent)
 *   valid + still on list → masked address + the POST button
 *
 * noindex: it is a per-recipient credential URL, never a search result.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Unsubscribe — PickLoads Freight Insights",
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const tv = await getV4(locale);

  const raw = (await searchParams).token;
  const token = normalizeUnsubscribeToken(Array.isArray(raw) ? raw[0] : raw);
  const result = token ? await lookupUnsubscribe(token) : "invalid";

  const invalidBody = tv(
    "This unsubscribe link isn't complete or is no longer valid. Email support@pickloads.com and we'll take you off the list by hand — no account needed.",
  );

  return (
    <main id="main">
      <PageHero
        eyebrow={tv("Freight Insights")}
        title={tv("Unsubscribe")}
      >
        {tv(
          "Marketing emails only. Account, document and load notifications you asked for are separate and keep working.",
        )}
      </PageHero>
      <section className="light">
        <div className="wrap" style={{ maxWidth: 720 }}>
          {result === "invalid" ? (
            <p className="sub" style={{ maxWidth: "none" }}>
              {invalidBody}
            </p>
          ) : result === "unavailable" ? (
            <p className="sub" style={{ maxWidth: "none" }}>
              {tv(
                "We can't reach the subscriber list right now, so nothing was changed. Try again in a few minutes, or email support@pickloads.com and we'll remove you.",
              )}
            </p>
          ) : (
            <>
              <p className="sub" style={{ maxWidth: "none" }}>
                {result.alreadyUnsubscribed
                  ? tv(
                      "This address is already off the Freight Insights list — nothing more to do.",
                    )
                  : tv(
                      "Confirm below and we'll stop sending Freight Insights to this address. This takes effect immediately.",
                    )}
              </p>
              <p
                className="mono"
                style={{
                  fontSize: ".82rem",
                  color: "var(--color-slate-mid)",
                  margin: "8px 0 22px",
                }}
              >
                {result.maskedEmail}
              </p>
              <UnsubscribeForm
                token={token ?? ""}
                alreadyUnsubscribed={result.alreadyUnsubscribed}
              />
            </>
          )}
        </div>
      </section>
    </main>
  );
}
