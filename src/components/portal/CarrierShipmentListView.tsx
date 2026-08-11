"use client";

import { useLocale, useTranslations } from "next-intl";
import { statusKey } from "@/lib/shipments/types";
import { SHIPMENT_STATUSES } from "@/lib/shipments/types";
import type { ShipmentListFilters } from "@/lib/shipments/shipper-list";
import type { CarrierListRow } from "@/lib/shipments/carrier-shipments";
import {
  formatTrackingDate,
  formatTrackingDateTime,
} from "@/components/tracking/format";

/**
 * M-76 — §13's carrier shipment LIST.
 *
 * ── WHY NOT `ShipmentListView` WITH A PROP ───────────────────────────────
 *
 * It was the first thing tried. M-74's view renders §11's NINE filters, a
 * `shipper_reference` column and a shipper's empty states; a carrier needs
 * four filters, no reference (it is the customer's, not theirs) and different
 * words for "you have none". A `variant` prop would have put four `variant ===
 * "carrier"` branches inside a component whose axe suite scans it in nine
 * states, and every future change to either audience would have to be
 * reasoned about for both.
 *
 * What IS shared is everything that would actually drift: the status
 * vocabulary (`statusKey` → the same five-locale catalogue `/track` renders),
 * the date formatters, the filter TYPE and parser, the `.ptable--cards`
 * transform and the pager shape.
 *
 * ── §22 MOBILE ──────────────────────────────────────────────────────────
 *
 * `.ptable--cards` with a `data-th` on every body cell — M-59's transform,
 * already audited. Below 640px each row becomes a labelled card, so §22's
 * "no unreadable shipment table" and "do not force desktop tables onto
 * mobile" are met by the shipped mechanism rather than a new one.
 * `tests/unit/carrier-driver-a11y.test.tsx` walks the DOM and asserts every
 * body cell carries a `data-th` matching its header.
 */

export interface CarrierShipmentListViewProps {
  rows: CarrierListRow[];
  filters: ShipmentListFilters;
  page: number;
  pageCount: number;
  total: number | null;
  pageSize: number;
  /** Locale-prefixed path of this route. */
  basePath: string;
  failed: boolean;
  filtered: boolean;
}

/** Serialize the four filters this surface offers back into a query string. */
export function carrierFilterQuery(
  filters: ShipmentListFilters,
  page?: number,
): string {
  const params = new URLSearchParams();
  if (filters.tracking) params.set("tracking", filters.tracking);
  if (filters.status) params.set("status", filters.status);
  if (filters.delayed) params.set("delayed", "1");
  if (filters.delivered) params.set("delivered", "1");
  if (page !== undefined && page > 1) params.set("page", String(page));
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

function lane(row: CarrierListRow): string {
  return `${row.origin_city}, ${row.origin_state} → ${row.destination_city}, ${row.destination_state}`;
}

export function CarrierShipmentListView({
  rows,
  filters,
  page,
  pageCount,
  total,
  pageSize,
  basePath,
  failed,
  filtered,
}: CarrierShipmentListViewProps) {
  const t = useTranslations();
  const locale = useLocale();

  const rangeStart = rows.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = rows.length === 0 ? 0 : rangeStart + rows.length - 1;

  return (
    <>
      {/* §23: a plain GET form. Keyboard-usable with nothing to get wrong,
          shareable as a URL, and it narrows the QUERY rather than the DOM. */}
      <form method="get" action={basePath} className="kfilters psh-filters" role="search">
        <fieldset>
          <legend className="sr-only">{t("shipment.carrier.filters_legend")}</legend>
          <div className="field">
            <label htmlFor="cf-tracking">
              {t("shipment.form.tracking_number")}
            </label>
            <input
              id="cf-tracking"
              name="tracking"
              type="text"
              defaultValue={filters.tracking ?? ""}
              autoComplete="off"
              spellCheck={false}
              placeholder="PL-2026-000458"
            />
          </div>
          <div className="field">
            <label htmlFor="cf-status">{t("shipment.result.current_status")}</label>
            <select id="cf-status" name="status" defaultValue={filters.status ?? ""}>
              <option value="">—</option>
              {SHIPMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(statusKey(status))}
                </option>
              ))}
            </select>
          </div>
          <div className="field psh-toggle">
            <label htmlFor="cf-delayed">
              <input
                id="cf-delayed"
                name="delayed"
                type="checkbox"
                value="1"
                defaultChecked={filters.delayed}
              />
              {t("shipment.status.delayed")}
            </label>
          </div>
          <div className="field psh-toggle">
            <label htmlFor="cf-delivered">
              <input
                id="cf-delivered"
                name="delivered"
                type="checkbox"
                value="1"
                defaultChecked={filters.delivered}
              />
              {t("shipment.status.delivered")}
            </label>
          </div>
          <div className="psh-actions">
            <button className="btn btn-amber btn-sm" type="submit">
              {t("shipment.carrier.filter_apply")}
            </button>
          </div>
        </fieldset>
      </form>

      {/* §23: a refusal or a result count is ANNOUNCED, not discovered. */}
      <p className="pempty psh-count" role="status">
        {failed
          ? t("shipment.carrier.failed")
          : rows.length === 0
            ? filtered
              ? t("shipment.carrier.empty_filtered")
              : t("shipment.carrier.empty")
            : t("shipment.carrier.showing", {
                from: rangeStart,
                to: rangeEnd,
                total: total ?? rangeEnd,
              })}
      </p>

      {rows.length > 0 ? (
        <div className="pcard" style={{ padding: 0 }}>
          <table className="ptable ptable--cards">
            <thead>
              <tr>
                <th scope="col">{t("shipment.form.tracking_number")}</th>
                <th scope="col">{t("shipment.result.current_status")}</th>
                <th scope="col">{t("shipment.carrier.lane")}</th>
                <th scope="col">{t("shipment.result.pickup_appointment")}</th>
                <th scope="col">{t("shipment.result.delivery_appointment")}</th>
                <th scope="col">{t("shipment.result.equipment")}</th>
                <th scope="col">
                  <span className="sr-only">{t("shipment.carrier.open")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td data-th={t("shipment.form.tracking_number")} className="mono">
                    {row.tracking_number}
                  </td>
                  {/* §23: state is TEXT, never colour alone. */}
                  <td data-th={t("shipment.result.current_status")}>
                    {t(statusKey(row.status))}
                  </td>
                  <td data-th={t("shipment.carrier.lane")}>{lane(row)}</td>
                  <td data-th={t("shipment.result.pickup_appointment")}>
                    {row.pickup_appointment_at
                      ? formatTrackingDateTime(row.pickup_appointment_at, locale)
                      : "—"}
                  </td>
                  <td data-th={t("shipment.result.delivery_appointment")}>
                    {row.delivery_appointment_at
                      ? formatTrackingDateTime(
                          row.delivery_appointment_at,
                          locale,
                        )
                      : row.estimated_delivery_at
                        ? formatTrackingDate(row.estimated_delivery_at, locale)
                        : "—"}
                  </td>
                  <td data-th={t("shipment.result.equipment")}>{row.equipment}</td>
                  <td data-th={t("shipment.carrier.open")}>
                    <a href={`${basePath}/${row.id}`}>
                      {t("shipment.carrier.open")}
                      <span className="sr-only"> {row.tracking_number}</span>
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {pageCount > 1 ? (
        <nav className="psh-pager" aria-label={t("shipment.carrier.title")}>
          {page > 1 ? (
            <a rel="prev" href={`${basePath}${carrierFilterQuery(filters, page - 1)}`}>
              ← {t("shipment.carrier.prev")}
            </a>
          ) : null}
          <span>
            {page} / {pageCount}
          </span>
          {page < pageCount ? (
            <a rel="next" href={`${basePath}${carrierFilterQuery(filters, page + 1)}`}>
              {t("shipment.carrier.next")} →
            </a>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
