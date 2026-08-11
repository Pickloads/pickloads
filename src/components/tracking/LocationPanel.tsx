"use client";

import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";

import { formatTrackingDateTime } from "@/components/tracking/format";
import {
  LOCATION_PANEL_LABEL_KEY,
  mapMayMount,
  resolveLocationPanelState,
} from "@/lib/shipments/map-state";
import type {
  ShipmentEventSource,
  ShipmentLocationVisibility,
  ShipmentTrackingMode,
} from "@/lib/shipments/types";
import type { MapPoint } from "@/components/tracking/ShipmentMap";

/**
 * M-80 — §11's "map, when enabled" slot, filled honestly.
 *
 * ── WHAT RENDERS TODAY ───────────────────────────────────────────────────
 *
 * The §30 label, the last known place, and the ACCESSIBLE TEXT EQUIVALENT —
 * an ordered list of recorded readings with machine-readable `<time>` values.
 * The map does **not** render, because no provider is connected and therefore
 * no shipment has a disclosed coordinate. That is the honest state, and it is
 * the state the panel says out loud rather than showing an empty grey box.
 *
 * ── §25 "map scripts lazy-loaded" ────────────────────────────────────────
 *
 * `ShipmentMap` is reached only through `next/dynamic(..., { ssr: false })`,
 * so it is a separate chunk that is requested when — and only when — a
 * shipment has a live position to draw. `ssr: false` is not decoration: the
 * projection reads coordinates that must not appear in server-rendered HTML
 * that a cache or a crawler could keep.
 *
 * ── §23 "accessible map alternative" ─────────────────────────────────────
 *
 * The text equivalent is not alt text and it is not screen-reader-only. It is
 * a visible, ordered list carrying every fact the map plots, present whether
 * the map mounts or not, keyboard-reachable, and readable with the stylesheet
 * deleted. A sighted keyboard user, a screen-reader user and a visitor on a
 * slow connection all get the same information.
 *
 * ── §23 reduced motion ───────────────────────────────────────────────────
 *
 * The one animation in the block (the newest-reading marker) is inside a
 * `prefers-reduced-motion: no-preference` query in `v4.css`. Nothing here
 * animates on mount, and nothing scrolls itself.
 */

const ShipmentMap = dynamic(() => import("@/components/tracking/ShipmentMap"), {
  ssr: false,
  // A one-line placeholder rather than a skeleton: a shimmering rectangle
  // where a map might appear implies a map is coming, which on a shipment
  // with no live source it is not.
  loading: () => <p className="track-note" role="status" />,
});

export interface LocationReading {
  recorded_at: string;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  speed_mph: number | null;
  source: ShipmentEventSource;
}

export interface LocationPanelProps {
  level: ShipmentLocationVisibility;
  trackingMode: ShipmentTrackingMode;
  currentCity: string | null;
  currentState: string | null;
  currentLatitude: number | null;
  currentLongitude: number | null;
  lastLocationAt: string | null;
  /** Newest first. Already redacted by the DTO for this audience. */
  readings: readonly LocationReading[];
  /** Heading id, so the caller owns the document outline. */
  headingId: string;
  /** True when the location read failed — degrade honestly, never silently. */
  failed?: boolean;
}

/** §25 — how many readings the list shows before it says how many more exist. */
export const VISIBLE_READINGS = 12;

function placeOf(city: string | null, state: string | null): string | null {
  const parts = [city, state].filter((p): p is string => p !== null && p !== "");
  return parts.length === 0 ? null : parts.join(", ");
}

export function LocationPanel({
  level,
  trackingMode,
  currentCity,
  currentState,
  currentLatitude,
  currentLongitude,
  lastLocationAt,
  readings,
  headingId,
  failed = false,
}: LocationPanelProps) {
  const t = useTranslations();
  const locale = useLocale();

  const plottable: MapPoint[] = readings
    .filter(
      (r): r is LocationReading & { latitude: number; longitude: number } =>
        r.latitude !== null && r.longitude !== null,
    )
    .map((r) => ({
      recorded_at: r.recorded_at,
      latitude: r.latitude,
      longitude: r.longitude,
      city: r.city,
      state: r.state,
    }));

  const hasCoordinates =
    plottable.length > 0 ||
    (currentLatitude !== null && currentLongitude !== null);
  const hasPlace =
    placeOf(currentCity, currentState) !== null ||
    readings.some((r) => placeOf(r.city, r.state) !== null);

  const state = resolveLocationPanelState({
    level,
    trackingMode,
    hasCoordinates,
    hasPlace,
  });
  const showMap = mapMayMount(state, plottable.length);

  const currentPlace = placeOf(currentCity, currentState);
  const shown = readings.slice(0, VISIBLE_READINGS);
  const hiddenCount = readings.length - shown.length;

  /**
   * The sentence that IS the map's accessible description and the list's
   * opening line — one string, so the two can never describe different data.
   */
  const summary =
    readings.length === 0
      ? t("shipment.location.summary_empty")
      : t("shipment.location.summary", {
          count: readings.length,
          place:
            placeOf(shown[0]?.city ?? null, shown[0]?.state ?? null) ??
            currentPlace ??
            t("shipment.location.place_unknown"),
        });

  return (
    <section className="track-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{t("shipment.location.heading")}</h2>

      <div className="psh-mapslot" data-testid="shipment-map-slot">
        <span className="shipmap-badge" data-testid="shipment-map-label">
          {t(LOCATION_PANEL_LABEL_KEY[state])}
        </span>

        <p data-testid="shipment-map-current">
          {state === "unavailable" || currentPlace === null
            ? t("shipment.label.location_unavailable")
            : `${currentPlace}${
                formatTrackingDateTime(lastLocationAt, locale) === null
                  ? ""
                  : ` · ${formatTrackingDateTime(lastLocationAt, locale)}`
              }`}
        </p>

        {/*
          §30 — the sentence under the badge, keyed on what is actually true.
          With no provider connected this is always the manual-updates line,
          and it names the reason rather than leaving a blank space.
        */}
        <p className="track-note">
          {state === "live"
            ? t("shipment.location.live_note")
            : t("shipment.location.manual_note")}
        </p>

        {failed ? (
          <p className="track-note" role="status">
            {t("shipment.location.read_failed")}
          </p>
        ) : null}

        {showMap ? (
          <div className="shipmap-wrap">
            <ShipmentMap
              points={plottable}
              title={t("shipment.location.map_title")}
              description={summary}
            />
          </div>
        ) : null}

        {/* ── §23: the accessible alternative. Always present. ────────── */}
        <div className="shipmap-alt">
          <h3 className="shipmap-alt-h">
            {t("shipment.location.text_alternative_heading")}
          </h3>
          <p className="track-note" role="status">
            {summary}
          </p>
          {shown.length === 0 ? null : (
            <ol className="shipmap-list">
              {shown.map((reading, index) => {
                const place = placeOf(reading.city, reading.state);
                const when = formatTrackingDateTime(reading.recorded_at, locale);
                return (
                  <li key={`${reading.recorded_at}-${index}`}>
                    <time dateTime={reading.recorded_at}>
                      {when ?? reading.recorded_at}
                    </time>
                    <span className="shipmap-place">
                      {place ?? t("shipment.location.place_unknown")}
                    </span>
                    {reading.latitude !== null && reading.longitude !== null ? (
                      <span className="shipmap-coords">
                        {t("shipment.location.coordinates", {
                          lat: reading.latitude.toFixed(4),
                          lon: reading.longitude.toFixed(4),
                        })}
                      </span>
                    ) : null}
                    {reading.speed_mph !== null ? (
                      <span className="shipmap-speed">
                        {t("shipment.location.speed", {
                          mph: Math.round(reading.speed_mph),
                        })}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
          {hiddenCount > 0 ? (
            <p className="track-note">
              {t("shipment.location.more_readings", { count: hiddenCount })}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
