"use client";

/**
 * M-80 — the map itself. Fills the slot M-73/M-74 left labelled.
 *
 * ── IT MAKES NO NETWORK REQUEST, AND THAT IS WHY THE CSP IS UNCHANGED ────
 *
 * No Google Maps script, no Mapbox GL, no Leaflet, no tile server. The whole
 * thing is one inline `<svg>` rendered from coordinates the server already
 * disclosed under §9's privacy levels. Three consequences worth stating:
 *
 *   * **CSP untouched.** The brief said to update it "only for what you
 *     actually need", and nothing is needed: same-origin markup loads under
 *     `default-src 'self'`. When a basemap provider is eventually chosen, the
 *     runbook records the single `img-src` entry to add — one line, one host.
 *   * **No third party learns which shipments are being watched.** A tile
 *     request carries the viewport, which is the truck's position, to
 *     somebody who is not a party to the freight.
 *   * **No basemap.** This draws the route, not the roads. It is labelled as
 *     a route diagram rather than a street map, because calling it a map of
 *     roads it does not draw would be the same species of claim §30 forbids.
 *
 * ── §23: THE MAP IS NOT THE INFORMATION ──────────────────────────────────
 *
 * The `<svg>` is `role="img"` with a real accessible name and description,
 * and every point it plots is ALSO in the text-equivalent table that
 * `LocationPanel` renders beside it — visible to everyone, not
 * screen-reader-only. That is the difference between an accessible map
 * alternative and alt text: the alternative carries the same facts, in the
 * same page, for a sighted keyboard user and a screen-reader user alike.
 *
 * ── §25: LAZY-LOADED ─────────────────────────────────────────────────────
 *
 * This module is imported ONLY through `next/dynamic(..., { ssr: false })` in
 * `LocationPanel`, so it is its own chunk and is fetched only when a shipment
 * genuinely has a live position to draw. `tests/e2e/shipment-map.spec.ts`
 * asserts no public page ever requests it.
 */

export interface MapPoint {
  recorded_at: string;
  latitude: number;
  longitude: number;
  city: string | null;
  state: string | null;
}

export interface ShipmentMapProps {
  /** Newest first, as every location read in this codebase returns. */
  points: readonly MapPoint[];
  /** The accessible name. Localized by the caller. */
  title: string;
  /** The accessible description — the same sentence the text list opens with. */
  description: string;
}

const VIEW_W = 640;
const VIEW_H = 320;
const PAD = 28;

/**
 * Equirectangular projection with a cosine correction on longitude.
 *
 * A plain lat/long → x/y mapping stretches east–west by a factor of ~1.3 at
 * US latitudes, which makes a straight interstate look like a diagonal. The
 * cosine of the mid-latitude is the standard cheap correction and is accurate
 * enough for a route drawn inside a 640×320 box. Nothing here claims to be a
 * survey-grade projection, and the label says "route diagram" for that reason.
 */
export function projectPoints(
  points: readonly MapPoint[],
): { x: number; y: number; point: MapPoint }[] {
  if (points.length === 0) return [];

  const lats = points.map((p) => p.latitude);
  const lons = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const kx = Math.max(Math.cos(midLat), 0.1);

  // A single point (or a stationary truck) has zero span; the guard keeps the
  // division finite and centres the marker instead of dividing by zero.
  const spanLon = Math.max((maxLon - minLon) * kx, 1e-6);
  const spanLat = Math.max(maxLat - minLat, 1e-6);
  const innerW = VIEW_W - PAD * 2;
  const innerH = VIEW_H - PAD * 2;
  // One scale for both axes keeps the aspect ratio honest — a route squeezed
  // to fill the box would misrepresent its shape.
  const scale = Math.min(innerW / spanLon, innerH / spanLat);
  const usedW = spanLon * scale;
  const usedH = spanLat * scale;
  const offsetX = PAD + (innerW - usedW) / 2;
  const offsetY = PAD + (innerH - usedH) / 2;

  return points.map((point) => ({
    x: offsetX + (point.longitude - minLon) * kx * scale,
    // SVG y grows downward; latitude grows northward.
    y: offsetY + (maxLat - point.latitude) * scale,
    point,
  }));
}

export default function ShipmentMap({
  points,
  title,
  description,
}: ShipmentMapProps) {
  const projected = projectPoints(points);
  if (projected.length === 0) return null;

  // `points` is newest-first; the path reads oldest → newest so the line is
  // drawn in travel order.
  const ordered = [...projected].reverse();
  const path = ordered.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const latest = projected[0];

  return (
    <svg
      className="shipmap"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-labelledby="shipmap-title shipmap-desc"
      data-testid="shipment-map"
      focusable="false"
    >
      <title id="shipmap-title">{title}</title>
      <desc id="shipmap-desc">{description}</desc>
      {ordered.length > 1 ? (
        <polyline className="shipmap-path" points={path} fill="none" />
      ) : null}
      {ordered.map((p, index) => (
        <circle
          key={`${p.point.recorded_at}-${index}`}
          className="shipmap-dot"
          cx={p.x}
          cy={p.y}
          r={3}
        />
      ))}
      {latest ? (
        <circle className="shipmap-latest" cx={latest.x} cy={latest.y} r={7} />
      ) : null}
    </svg>
  );
}
