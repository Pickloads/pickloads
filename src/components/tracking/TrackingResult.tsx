"use client";

import { useLocale, useTranslations } from "next-intl";
import type { CustomerEventDto, PublicTrackingDto } from "@/lib/shipments/dto";
import { resolvePublicText } from "@/lib/shipments/phrases";
import { TrackingTimeline } from "@/components/tracking/TrackingTimeline";
import { TrackingSupportForm } from "@/components/tracking/TrackingSupportForm";
import {
  formatTrackingDate,
  formatTrackingDateTime,
} from "@/components/tracking/format";

/**
 * M-73 — §8's customer-facing tracking result.
 *
 * Renders EXACTLY the `PublicTrackingDto` M-70 produced. It never receives a
 * shipment row, never fetches, and has no access to a database client: the
 * only shipment data reachable from this file is what the allow-list
 * serializer chose to emit, which is what makes §4's eight forbidden
 * categories unrepresentable here rather than merely unrendered.
 *
 * ── §8's four required blocks, in order ───────────────────────────────────
 *
 *   header summary · progress timeline · shipment summary · contact
 *
 * ── §22's mobile priority order ───────────────────────────────────────────
 *
 *   status → ETA → route → timeline → support → documents → map
 *
 * The header grid is `auto-fit`, so the DOM order IS the mobile order: status
 * and estimated delivery are the first two cells and stack first at 320px.
 * Documents (M-77) and map (M-80) are not built yet and are therefore absent
 * rather than stubbed — an empty "Documents" heading on a shipment with no
 * documents is a promise, and §30 forbids those.
 *
 * ── §30 honest labels ─────────────────────────────────────────────────────
 *
 * Every claim this page makes about WHERE its data came from is labelled:
 * "Last updated by dispatch", "Milestone tracking", "ETA provided by
 * dispatcher", "Live location available" / "Location temporarily
 * unavailable". Nothing here says "live tracking", nothing says "real-time",
 * and nothing says "AI" — the tracking mode this product ships with is Mode A,
 * manual operator updates, and the copy says so out loud.
 *
 * ── noindex ───────────────────────────────────────────────────────────────
 *
 * The `<meta name="robots">` below is hoisted into `<head>` by React 19 and
 * exists only while a result is on screen. It is belt-and-braces: a result has
 * no URL of its own (the lookup is a POST server action, see
 * `src/app/actions/public-tracking.ts`), so there is nothing for a crawler to
 * fetch in the first place. Two independent reasons an individual result can
 * never be indexed.
 */

/** §4/§8: a value the shipper never supplied renders as an honest blank. */
function Field({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  const t = useTranslations();
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ?? t("shipment.result.not_provided")}</dd>
    </div>
  );
}

/**
 * D-6 in one component: a library phrase is TRANSLATED, novel dispatcher prose
 * is rendered verbatim with `lang` and an honest label, and nothing is ever
 * machine-translated (§24).
 */
function PublicText({ raw }: { raw: string | null }) {
  const t = useTranslations();
  const resolved = resolvePublicText(raw);
  if (resolved === null) return null;
  if (resolved.kind === "phrase") {
    return <span className="msg">{t(resolved.key)}</span>;
  }
  return (
    <>
      <span className="msg" lang={resolved.lang}>
        {resolved.text}
      </span>
      <span className="track-freetext">{t(resolved.noticeKey)}</span>
    </>
  );
}

function TimelineEvent({
  event,
  locale,
}: {
  event: CustomerEventDto;
  locale: string;
}) {
  const t = useTranslations();
  const place = [event.city, event.state].filter(Boolean).join(", ");
  return (
    <li>
      <span className="ev">{t(event.event_type_key)}</span>
      <PublicText raw={event.message} />
      <span className="meta">
        <time dateTime={event.event_time}>
          {formatTrackingDateTime(event.event_time, locale)}
        </time>
        {place === "" ? null : ` · ${place}`}
      </span>
    </li>
  );
}

export function TrackingResult({
  tracking,
  timelineTruncated,
}: {
  tracking: PublicTrackingDto;
  timelineTruncated: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();

  const cancelled = tracking.status === "cancelled";
  const openException = tracking.exceptions.some(
    (e) => e.resolved_at === null,
  );
  const delayed = tracking.status === "delayed";

  const statusClass = cancelled
    ? "is-cancelled"
    : delayed || openException
      ? "is-exception"
      : "";

  // §30: an ETA a dispatcher typed is labelled as one. `calculated` and
  // `provider` sources get no such label because they are not claims about a
  // human — and neither exists yet, so today the label is always accurate.
  const etaByDispatcher =
    tracking.eta_source === "manual" ||
    tracking.eta_source === "dispatcher_adjusted";

  // §9/§30: the ONLY honest location claim this page can make. Mode A carries
  // no live position at all; Modes B and C are M-80. A city/state that the DTO
  // did not redact is a place an operator recorded, so it is labelled as such.
  const hasLocation =
    tracking.current_city !== null || tracking.current_state !== null;
  const locationClaimsLive = tracking.tracking_mode !== "manual" && hasLocation;

  // Newest first for the history list; the milestone timeline reads the same
  // array and orders itself.
  const events = [...tracking.events].sort((a, b) =>
    a.event_time < b.event_time ? 1 : a.event_time > b.event_time ? -1 : 0,
  );

  return (
    <div className="track-result" id="track-result">
      {/* Hoisted to <head> by React 19 — see the header note. */}
      <meta name="robots" content="noindex, nofollow" />

      <span className="track-kicker">{t("shipment.result.tracking_number")}</span>
      <p className="track-number">{tracking.tracking_number}</p>

      {cancelled ? (
        <div className="track-banner is-neutral" role="note">
          <h3>{t("shipment.result.cancelled_title")}</h3>
          <p>{t("shipment.result.cancelled_body")}</p>
        </div>
      ) : null}

      {delayed ? (
        <div className="track-banner" role="note">
          <h3>{t("shipment.result.delay_title")}</h3>
          {tracking.delay_minutes === null ? null : (
            <p>
              {t("shipment.result.delay_minutes", {
                minutes: tracking.delay_minutes,
              })}
            </p>
          )}
          <PublicText raw={tracking.delay_reason} />
        </div>
      ) : null}

      {/* §8 exception state: accessible warning style, honest explanation, no
          internal detail. M-70's DTO already drops any exception with no
          public description, so an empty alarm cannot be rendered. */}
      {tracking.exceptions.map((exception) => (
        <div
          key={`${exception.exception_type}-${exception.opened_at}`}
          className="track-banner"
          role="note"
        >
          <h3>{t("shipment.result.exception_title")}</h3>
          <p>
            {t(exception.exception_type_key)} · {t(exception.severity_key)}
          </p>
          <PublicText raw={exception.description} />
        </div>
      ))}

      {/* ── §8 header summary ── */}
      <div className="track-head">
        <div>
          <span className="k">{t("shipment.result.current_status")}</span>
          <span className="v">
            <span className={`track-status ${statusClass}`.trim()}>
              {t(tracking.status_key)}
            </span>
          </span>
        </div>
        <div>
          <span className="k">{t("shipment.result.estimated_delivery")}</span>
          <span className="v">
            {formatTrackingDateTime(tracking.estimated_delivery_at, locale) ??
              t("shipment.result.not_provided")}
          </span>
          {etaByDispatcher ? (
            <span className="track-note">
              {t("shipment.label.eta_by_dispatcher")}
            </span>
          ) : null}
        </div>
        <div>
          <span className="k">{t("shipment.result.origin")}</span>
          <span className="v">
            {tracking.origin_city}, {tracking.origin_state}
          </span>
        </div>
        <div>
          <span className="k">{t("shipment.result.destination")}</span>
          <span className="v">
            {tracking.destination_city}, {tracking.destination_state}
          </span>
        </div>
        <div>
          <span className="k">{t("shipment.result.shipment_type")}</span>
          <span className="v">{tracking.equipment}</span>
        </div>
        <div>
          <span className="k">{t("shipment.result.last_update")}</span>
          <span className="v">
            {formatTrackingDateTime(
              tracking.last_location_at ?? tracking.eta_updated_at,
              locale,
            ) ?? t("shipment.result.not_provided")}
          </span>
          <span className="track-note">
            {t("shipment.label.last_updated_by_dispatch")}
            {hasLocation
              ? ` · ${[tracking.current_city, tracking.current_state]
                  .filter(Boolean)
                  .join(", ")}`
              : ""}
          </span>
          <span className="track-note">
            {locationClaimsLive
              ? t("shipment.label.live_location_available")
              : hasLocation
                ? t("shipment.label.milestone_tracking")
                : t("shipment.label.location_unavailable")}
          </span>
        </div>
      </div>

      {/* ── §8 progress timeline (+ §23 text equivalent) ── */}
      <TrackingTimeline tracking={tracking} />

      {/* ── update history — §25-bounded ── */}
      <section className="track-section" aria-labelledby="track-events-heading">
        <h2 id="track-events-heading">{t("shipment.a11y.event_list")}</h2>
        {events.length === 0 ? (
          <p className="sub" style={{ maxWidth: "none" }}>
            {t("shipment.result.timeline_empty")}
          </p>
        ) : (
          <>
            <ul className="track-events">
              {events.map((event, index) => (
                <TimelineEvent
                  key={`${event.event_time}-${event.event_type}-${index}`}
                  event={event}
                  locale={locale}
                />
              ))}
            </ul>
            {timelineTruncated ? (
              <span className="track-note">
                {t("shipment.result.timeline_truncated")}
              </span>
            ) : null}
          </>
        )}
        <span className="track-note">
          {t("shipment.result.updates_are_manual")}
        </span>
      </section>

      {/* ── §8 shipment summary ── */}
      <section className="track-section" aria-labelledby="track-summary-heading">
        <h2 id="track-summary-heading">{t("shipment.result.summary_title")}</h2>
        <dl className="track-summary">
          <Field
            label={t("shipment.result.pickup_appointment")}
            value={formatTrackingDate(tracking.pickup_appointment_at, locale)}
          />
          <Field
            label={t("shipment.result.delivery_appointment")}
            value={formatTrackingDate(tracking.delivery_appointment_at, locale)}
          />
          <Field
            label={t("shipment.result.equipment")}
            value={tracking.equipment}
          />
          <Field
            label={t("shipment.result.commodity")}
            value={tracking.commodity_category}
          />
          <Field
            label={t("shipment.result.weight")}
            value={
              tracking.weight_lbs === null
                ? null
                : `${tracking.weight_lbs.toLocaleString(locale)} ${t("shipment.result.weight_unit")}`
            }
          />
          <Field
            label={t("shipment.result.pallets")}
            value={tracking.pallets === null ? null : String(tracking.pallets)}
          />
          <Field
            label={t("shipment.result.reference")}
            value={tracking.shipper_reference}
          />
          <Field
            label={t("shipment.result.po_number")}
            value={tracking.po_number}
          />
          {/* §1 wants "assigned carrier status" visible; §4 forbids private
              carrier contact information. A boolean is the whole of what a
              public visitor may know. */}
          <Field
            label={t("shipment.result.carrier")}
            value={
              tracking.carrier_assigned
                ? t("shipment.result.carrier_assigned")
                : t("shipment.result.carrier_pending")
            }
          />
        </dl>
      </section>

      {/* ── §8 contact ── */}
      <section className="track-section" aria-labelledby="track-contact-heading">
        <h2 id="track-contact-heading">
          {t("shipment.result.contact_title")}
        </h2>
        <p className="sub" style={{ maxWidth: "none" }}>
          {t("shipment.result.contact_body")}
        </p>
        <div className="track-contact">
          <a href="tel:+19084045373">(908) 404-5373</a>
          <a href="mailto:support@pickloads.com">support@pickloads.com</a>
        </div>
        <TrackingSupportForm trackingNumber={tracking.tracking_number} />
      </section>
    </div>
  );
}
