import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { redeemDriverToken } from "@/lib/shipments/driver-access";
import { normalizeDriverToken } from "@/lib/shipments/driver-token";
import { offeredCarrierActions } from "@/lib/shipments/carrier-updates";
import {
  DriverLinkExpired,
  DriverUpdateView,
} from "@/components/driver/DriverUpdateView";

/**
 * M-76 — `/driver/update/[secureToken]` (`docs/DIRECTIVE-tracking.md` §13).
 *
 * ── WHY THIS PAGE IS `force-dynamic` AND `noindex` ───────────────────────
 *
 * Every render REDEEMS a bearer credential: it writes a row to
 * `shipment_driver_token_access` (§13 "audit logged"), spends rate budget
 * (§13 "rate limited") and returns freight data. None of that may be cached,
 * prerendered, or crawled. `robots: { index: false, follow: false }` is on the
 * route and `/driver` is in `robots.txt`'s disallow list; the route is not in
 * `PUBLIC_ROUTES`, so it is not in the sitemap either. §25's *"never cache
 * private shipment data publicly"* is satisfied by construction — there is no
 * cacheable artifact that contains a shipment.
 *
 * ── THE ONE REFUSAL ──────────────────────────────────────────────────────
 *
 * A malformed token, an unknown token, an expired one, a revoked one and one
 * whose carrier has been released all render THE SAME card: §30's authored
 * label "Tracking link expired" plus a sentence and a phone number. §13
 * requires the link to be non-enumerable, so those five must be
 * indistinguishable to whoever is holding it. Which one it actually was is in
 * `shipment_driver_token_access`, where only staff can read it.
 *
 * `rate_limited` and `unavailable` get their own wording because neither says
 * anything about any particular token — both are true for every input,
 * including inputs that do not exist, so neither is an oracle.
 *
 * ── WHAT THIS SERVER COMPONENT HOLDS ─────────────────────────────────────
 *
 * A `DriverShipmentView` and nothing else. 0023's redeem payload names no
 * financial column, no shipper identity and no internal note, so §13's *"no
 * access to financial data"* is a property of the query rather than of the
 * markup. The internal shipment id IS in the process (it is the write key)
 * and is never rendered — the driver's forms carry the TOKEN, not the id,
 * which is §13's *"do not expose internal shipment IDs"* applied to the form
 * body as well as to the URL.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "shipment" });
  return {
    title: t("driver.meta_title"),
    // Belt and braces with robots.txt: a link forwarded into a public Slack
    // must not become a search result.
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function DriverUpdatePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  const userAgent = h.get("user-agent");

  const result = await redeemDriverToken({ token, ip, userAgent });

  if (!result.ok) {
    return (
      <main id="main" className="driver-shell">
        <DriverLinkExpired
          reasonKey={
            result.code === "rate_limited"
              ? "shipment.driver.rate_limited"
              : result.code === "unavailable"
                ? "shipment.driver.unavailable"
                : "shipment.driver.expired_body"
          }
        />
      </main>
    );
  }

  /*
   * §20's facts, derived from the grant. The driver page does NOT read the
   * event timeline: §13 gives a driver "limited status transitions" and no
   * history, and a timeline would be shipment data the token does not need to
   * expose. The consequence is that `pickup_confirmation_required` cannot be
   * evaluated from here, so `picked_up` (§13's "departed pickup") is offered
   * only once the shipment has actually reached `loading` — which is the same
   * outcome the graph produces, because `loading → picked_up` is the only
   * edge into it.
   *
   * The server action re-resolves the REAL facts through
   * `shipment_transition_facts()` before writing, so anything this
   * approximation over-offers is refused there with a typed message.
   */
  const facts = {
    activeAssignmentId: result.carrierId,
    pickupConfirmedAt:
      result.shipment.status === "loading" ||
      result.shipment.status === "picked_up" ||
      result.shipment.status === "in_transit"
        ? new Date().toISOString()
        : null,
    deliveryTimestamp: new Date().toISOString(),
    deliveredAt: null,
    approvedPodDocumentId: null,
    closeoutCompletedAt: null,
    cancellationReason: null,
  };

  const offeredActions = offeredCarrierActions(
    "driver",
    result.shipment.status,
    facts,
  );

  // Normalised, so the value handed to the client forms is the canonical one
  // the hash was computed from — not whatever casing or encoding the URL
  // happened to carry.
  const canonicalToken = normalizeDriverToken(token) ?? "";

  return (
    <main id="main" className="driver-shell">
      <DriverUpdateView
        token={canonicalToken}
        shipment={result.shipment}
        offeredActions={offeredActions}
        consentStatus={result.consentStatus}
        expiresAt={result.expiresAt}
        driverName={result.driverName}
      />
    </main>
  );
}
