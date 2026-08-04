"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";

/*
 * Consent-gated GA4 (M-15, audit S-05: analytics must not fire before cookie
 * consent). Renders nothing unless NEXT_PUBLIC_GA4_MEASUREMENT_ID is set —
 * with no analytics there are no non-essential cookies, so no banner either.
 * The choice is stored in a cookie (not localStorage) so future server-side
 * consent checks (Meta Pixel, Phase 3 marketing dashboard) can read it too.
 */
const CONSENT_COOKIE = "pl_consent";
const MAX_AGE = 60 * 60 * 24 * 365; // 12 months, then re-ask

type Consent = "granted" | "denied" | null;

function readConsent(): Consent {
  const match = document.cookie.match(/(?:^|;\s*)pl_consent=(granted|denied)/);
  return match?.[1] === "granted" || match?.[1] === "denied" ? match[1] : null;
}

function writeConsent(value: "granted" | "denied") {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${value}; Max-Age=${MAX_AGE}; Path=/; SameSite=Lax${secure}`;
}

export function ConsentAnalytics() {
  const tv = useV4();
  const gaId = process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID;
  const [consent, setConsent] = useState<Consent>(null);
  const [ready, setReady] = useState(false); // avoid SSR/client flash

  useEffect(() => {
    setConsent(readConsent());
    setReady(true);
  }, []);

  if (!gaId || !ready) return null;

  if (consent === "granted") {
    return (
      <>
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
          strategy="afterInteractive"
        />
        <Script id="ga4-init" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', ${JSON.stringify(gaId)}, { anonymize_ip: true });`}
        </Script>
      </>
    );
  }

  if (consent === "denied") return null;

  return (
    <div className="consentbar" role="region" aria-label={tv("Cookie consent")}>
      <p>
        {tv(
          "We use one analytics cookie to understand site traffic — nothing fires unless you accept.",
        )}{" "}
        <Link href="/legal/cookies">{tv("Cookie policy")}</Link>
      </p>
      <div className="btns">
        <button
          type="button"
          className="btn btn-amber"
          onClick={() => {
            writeConsent("granted");
            setConsent("granted");
          }}
        >
          {tv("Accept")}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            writeConsent("denied");
            setConsent("denied");
          }}
        >
          {tv("Decline")}
        </button>
      </div>
    </div>
  );
}
