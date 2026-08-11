import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHero } from "@/components/ui/PageHero";
import { NotificationOptOutForm } from "@/components/forms/NotificationOptOutForm";
import {
  lookupNotificationOptOut,
  normalizeNotificationToken,
} from "@/lib/notification-preferences";

/**
 * M-79 — the shipment-notification opt-out page
 * (`docs/DIRECTIVE-tracking.md` §17 "respect user preferences", §24).
 *
 * §17 requires preferences to be respected. The plan requires the opt-out to
 * be *honest and reachable*: reachable means a link in every one of the eleven
 * notification emails that works without a login, and honest means it actually
 * stops the mail rather than setting a flag nothing reads.
 *
 * ── THE GET NEVER MUTATES ─────────────────────────────────────────────────
 *
 * M-69/P-1 established this for the newsletter and the reasoning is identical
 * here: Outlook Safe Links, Proofpoint and Barracuda fetch every URL in an
 * email, so a GET side effect would stop notifications for customers who never
 * clicked. This page LOOKS UP and renders; the change needs a POST.
 *
 * ── HONEST STATES, IN ORDER OF PRECEDENCE ─────────────────────────────────
 *
 *   no token / malformed  → "this link isn't complete"
 *   unknown token         → the SAME wording (no enumeration signal)
 *   no service-role key   → "we can't reach your preferences" + support
 *   already opted out     → the success confirmation + a resume button
 *   valid + still on      → masked address + the stop button
 *
 * ── WHAT THIS PAGE DOES NOT TOUCH ─────────────────────────────────────────
 *
 * The newsletter. Marketing consent is a separate list with a separate token
 * and a separate page (M-69), and collapsing them would mean a customer who
 * wants fewer status emails silently loses the blog digest, or worse, the
 * reverse. The copy says which one this is.
 *
 * noindex: a per-recipient credential URL is never a search result.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "shipment.optout" });
  return {
    title: t("meta_title"),
    robots: { index: false, follow: false },
  };
}

export default async function NotificationUnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "shipment.optout" });

  const raw = (await searchParams).token;
  const token = normalizeNotificationToken(Array.isArray(raw) ? raw[0] : raw);
  const result = token ? await lookupNotificationOptOut(token) : "invalid";

  return (
    <main id="main">
      <PageHero eyebrow={t("eyebrow")} title={t("title")}>
        {t("intro")}
      </PageHero>
      <section className="light">
        <div className="wrap" style={{ maxWidth: 720 }}>
          {result === "invalid" ? (
            <p className="sub" style={{ maxWidth: "none" }}>
              {t("invalid")}
            </p>
          ) : result === "unavailable" ? (
            <p className="sub" style={{ maxWidth: "none" }}>
              {t("unavailable")}
            </p>
          ) : (
            <>
              <p className="sub" style={{ maxWidth: "none" }}>
                {result.alreadyOptedOut ? t("already") : t("confirm")}
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
              <NotificationOptOutForm
                token={token ?? ""}
                alreadyOptedOut={result.alreadyOptedOut}
              />
              <p className="track-note" style={{ marginTop: 22 }}>
                {t("scope_note")}
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
