"use client";

import { useLocale, useTranslations } from "next-intl";
import { SHIPMENT_STATUSES, statusKey } from "@/lib/shipments/types";
import type { ShipmentListFilters } from "@/lib/shipments/shipper-list";
import type { BrokerListRow } from "@/lib/shipments/broker-access";
import {
  formatTrackingDate,
  formatTrackingDateTime,
} from "@/components/tracking/format";

/**
 * M-81 — §12's shared-shipment LIST.
 *
 * ── WHY NOT `CarrierShipmentListView` WITH A PROP ────────────────────────
 *
 * The same question M-76 answered for the carrier list, with the same answer.
 * The columns overlap heavily; the EMPTY STATES do not, and they are the part
 * that matters here. A carrier with no shipments has none assigned; a partner
 * with no shipments may have none SHARED, or may belong to an organization
 * nobody has verified yet — two different sentences with two different next
 * actions, and a `variant` prop would put that fork inside a component whose
 * axe suite already scans it in nine states.
 *
 * What IS shared is everything that would actually drift: the status
 * vocabulary (`statusKey` → the same five-locale catalogue `/track` renders),
 * the date formatters, the filter TYPE and parser, the `.ptable--cards`
 * transform and the pager shape.
 *
 * ── WHAT IS NOT IN THIS TABLE, AND THAT IS THE POINT ─────────────────────
 *
 * No money column of any kind. `BrokerListRow` is a `Pick<>` over columns
 * `BROKER_FIELD_POLICY` marks `allow`, so `carrier_pay`,
 * `gross_shipper_amount` and `margin` are not merely unrendered here — they
 * are unrepresentable, and the SQL projection never fetched them.
 *
 * ── §22 MOBILE ───────────────────────────────────────────────────────────
 *
 * `.ptable--cards` with a `data-th` on every body cell — M-59's audited
 * transform. Below 640px each row becomes a labelled card.
 */

export interface BrokerShipmentListViewProps {
  rows: BrokerListRow[];
  filters: ShipmentListFilters;
  page: number;
  pageCount: number;
  total: number | null;
  pageSize: number;
  /** Locale-prefixed path of this route. */
  basePath: string;
  /** Locale-prefixed path the detail links hang off. */
  detailBase: string;
  failed: boolean;
  filtered: boolean;
  /** The organization reaches more shipments than the §25 id bound. */
  truncated: boolean;
}

/** Serialize the four filters this surface offers back into a query string. */
export function brokerFilterQuery(
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

function lane(row: BrokerListRow): string {
  return `${row.origin_city}, ${row.origin_state} → ${row.destination_city}, ${row.destination_state}`;
}

export function BrokerShipmentListView({
  rows,
  filters,
  page,
  pageCount,
  total,
  pageSize,
  basePath,
  detailBase,
  failed,
  filtered,
  truncated,
}: BrokerShipmentListViewProps) {
  const t = useTranslations();
  const locale = useLocale();

  const rangeStart = rows.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = rows.length === 0 ? 0 : rangeStart + rows.length - 1;

  return (
    <>
      {/* §23: a plain GET form. Keyboard-usable with nothing to get wrong,
          shareable as a URL, and it narrows the QUERY rather than the DOM. */}
      <form
        method="get"
        action={basePath}
        className="kfilters psh-filters"
        role="search"
      >
        <fieldset>
          <legend className="sr-only">
            {t("shipment.broker.filters_legend")}
          </legend>
          <div className="field">
            <label htmlFor="bf-tracking">
              {t("shipment.form.tracking_number")}
            </label>
            <input
              id="bf-tracking"
              name="tracking"
              type="text"
              defaultValue={filters.tracking ?? ""}
              autoComplete="off"
              spellCheck={false}
              placeholder="PL-2026-000458"
            />
          </div>
          <div className="field">
            <label htmlFor="bf-status">
              {t("shipment.result.current_status")}
            </label>
            <select
              id="bf-status"
              name="status"
              defaultValue={filters.status ?? ""}
            >
              <option value="">—</option>
              {SHIPMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(statusKey(status))}
                </option>
              ))}
            </select>
          </div>
          <div className="field psh-toggle">
            <label htmlFor="bf-delayed">
              <input
                id="bf-delayed"
                name="delayed"
                type="checkbox"
                value="1"
                defaultChecked={filters.delayed}
              />
              {t("shipment.status.delayed")}
            </label>
          </div>
          <div className="field psh-toggle">
            <label htmlFor="bf-delivered">
              <input
                id="bf-delivered"
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
              {t("shipment.broker.filter_apply")}
            </button>
          </div>
        </fieldset>
      </form>

      {/* §23: a refusal or a result count is ANNOUNCED, not discovered. */}
      <p className="pempty psh-count" role="status">
        {failed
          ? t("shipment.broker.failed")
          : rows.length === 0
            ? filtered
              ? t("shipment.broker.empty_filtered")
              : t("shipment.broker.empty")
            : t("shipment.broker.showing", {
                from: rangeStart,
                to: rangeEnd,
                total: total ?? rangeEnd,
              })}
      </p>

      {truncated ? (
        <p className="pempty" role="note" style={{ padding: "0 0 12px" }}>
          {t("shipment.broker.truncated")}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="pcard" style={{ padding: 0 }}>
          <table className="ptable ptable--cards">
            <thead>
              <tr>
                <th scope="col">{t("shipment.form.tracking_number")}</th>
                <th scope="col">{t("shipment.result.current_status")}</th>
                <th scope="col">{t("shipment.broker.lane")}</th>
                <th scope="col">{t("shipment.result.pickup_appointment")}</th>
                <th scope="col">{t("shipment.result.delivery_appointment")}</th>
                <th scope="col">{t("shipment.result.reference")}</th>
                <th scope="col">
                  <span className="sr-only">{t("shipment.broker.open")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td
                    data-th={t("shipment.form.tracking_number")}
                    className="mono"
                  >
                    {row.tracking_number}
                  </td>
                  {/* §23: state is TEXT, never colour alone. */}
                  <td data-th={t("shipment.result.current_status")}>
                    {t(statusKey(row.status))}
                  </td>
                  <td data-th={t("shipment.broker.lane")}>{lane(row)}</td>
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
                  <td data-th={t("shipment.result.reference")}>
                    {row.shipper_reference ?? row.po_number ?? "—"}
                  </td>
                  <td data-th={t("shipment.broker.open")}>
                    <a href={`${detailBase}/${row.id}`}>
                      {t("shipment.broker.open")}
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
        <nav className="psh-pager" aria-label={t("shipment.broker.title")}>
          {page > 1 ? (
            <a
              rel="prev"
              href={`${basePath}${brokerFilterQuery(filters, page - 1)}`}
            >
              ← {t("shipment.broker.prev")}
            </a>
          ) : null}
          <span>
            {page} / {pageCount}
          </span>
          {page < pageCount ? (
            <a
              rel="next"
              href={`${basePath}${brokerFilterQuery(filters, page + 1)}`}
            >
              {t("shipment.broker.next")} →
            </a>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
