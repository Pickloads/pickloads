"use client";

import { useLocale, useTranslations } from "next-intl";
import { useV4 } from "@/i18n/v4";
import { SHIPMENT_STATUSES } from "@/lib/shipments/types";
import { statusKey } from "@/lib/shipments/types";
import type {
  ShipmentListFilters,
  ShipmentListRow,
} from "@/lib/shipments/shipper-list";
import {
  formatTrackingDate,
  formatTrackingDateTime,
} from "@/components/tracking/format";

/**
 * M-74 — §11's shipper shipment list.
 *
 * ── WHY A CLIENT COMPONENT FOR A LIST THAT NEVER FETCHES ──────────────────
 *
 * It fetches nothing: every row, the filter state and the page numbers arrive
 * as props from the server component, which did the reading under the
 * caller's RLS. `"use client"` buys two specific things:
 *
 *   1. `useTranslations()` reaches the `shipment` NAMESPACE M-73 authored, so
 *      the eighteen §6 status labels are the SAME five-locale strings `/track`
 *      renders — not a second set of portal-only status words that would
 *      drift on the first status rename.
 *   2. the whole view is renderable in jsdom, which is how it gets an
 *      axe-core scan at all: portal routes sit behind a Supabase session and
 *      the e2e lane runs on placeholder credentials by design (M-41). Same
 *      split, same reason, as `tests/unit/tracking-result-a11y.test.tsx`.
 *
 * ── NAVIGATION IS PLAIN ANCHORS, NOT `<Link>` ─────────────────────────────
 *
 * `basePath` arrives already locale-prefixed from the server's
 * `getPathname()`. Filters and pagination are GET navigations that must work
 * with JavaScript disabled — a `<form method="get">` and href-carrying
 * anchors do, and they are also what makes the filters keyboard-reachable
 * (§23) without a single key handler to get wrong.
 *
 * ── §22 MOBILE ───────────────────────────────────────────────────────────
 *
 * The table carries `.ptable--cards`, the M-59 transform, and every cell
 * carries `data-th`. Below 640px each row becomes a labelled card; §22's
 * *"do not force desktop tables onto mobile"* and *"no unreadable shipment
 * table"* are satisfied by the shipped mechanism rather than a new one.
 */

export interface ShipmentListViewProps {
  rows: ShipmentListRow[];
  filters: ShipmentListFilters;
  page: number;
  pageCount: number;
  total: number | null;
  pageSize: number;
  /** Locale-prefixed path of the list route. */
  basePath: string;
  /** Locale-prefixed path prefix for a detail route (`${detailBase}/${id}`). */
  detailBase: string;
  /** True when the list read errored — an honest error beats a fake zero. */
  failed: boolean;
  /** True when at least one filter is applied (changes the empty state). */
  filtered: boolean;
}

/** Serialize filters back into a query string, dropping everything unset. */
export function filterQuery(
  filters: ShipmentListFilters,
  page?: number,
): string {
  const params = new URLSearchParams();
  if (filters.tracking) params.set("tracking", filters.tracking);
  if (filters.reference) params.set("reference", filters.reference);
  if (filters.dateFrom) params.set("from", filters.dateFrom);
  if (filters.dateTo) params.set("to", filters.dateTo);
  if (filters.origin) params.set("origin", filters.origin);
  if (filters.destination) params.set("destination", filters.destination);
  if (filters.status) params.set("status", filters.status);
  if (filters.equipment) params.set("equipment", filters.equipment);
  if (filters.delayed) params.set("delayed", "1");
  if (filters.delivered) params.set("delivered", "1");
  if (page !== undefined && page > 1) params.set("page", String(page));
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

function lane(row: ShipmentListRow): string {
  return `${row.origin_city}, ${row.origin_state} → ${row.destination_city}, ${row.destination_state}`;
}

export function ShipmentListView({
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
}: ShipmentListViewProps) {
  const t = useTranslations();
  const tv = useV4();
  const locale = useLocale();

  const rangeStart = rows.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = rows.length === 0 ? 0 : rangeStart + rows.length - 1;

  return (
    <>
      {/* ── §11 filters · §23 keyboard-reachable ───────────────────────── */}
      <form method="get" action={basePath} className="kfilters psh-filters">
        <fieldset>
          <legend className="sr-only">{tv("Filter shipments")}</legend>
          <div className="field">
            <label htmlFor="sf-tracking">
              {t("shipment.form.tracking_number")}
            </label>
            <input
              id="sf-tracking"
              name="tracking"
              type="search"
              inputMode="text"
              defaultValue={filters.tracking ?? ""}
              placeholder="PL-2026-000458"
            />
          </div>
          <div className="field">
            <label htmlFor="sf-reference">{tv("PO or reference")}</label>
            <input
              id="sf-reference"
              name="reference"
              type="search"
              defaultValue={filters.reference ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="sf-from">{tv("Pickup from")}</label>
            <input
              id="sf-from"
              name="from"
              type="date"
              defaultValue={filters.dateFrom ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="sf-to">{tv("Pickup to")}</label>
            <input
              id="sf-to"
              name="to"
              type="date"
              defaultValue={filters.dateTo ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="sf-origin">{t("shipment.result.origin")}</label>
            <input
              id="sf-origin"
              name="origin"
              type="search"
              defaultValue={filters.origin ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="sf-destination">
              {t("shipment.result.destination")}
            </label>
            <input
              id="sf-destination"
              name="destination"
              type="search"
              defaultValue={filters.destination ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="sf-status">{tv("Status")}</label>
            <select
              id="sf-status"
              name="status"
              defaultValue={filters.status ?? ""}
            >
              <option value="">{tv("All statuses")}</option>
              {SHIPMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(statusKey(s))}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sf-equipment">{tv("Equipment")}</label>
            <input
              id="sf-equipment"
              name="equipment"
              type="search"
              defaultValue={filters.equipment ?? ""}
            />
          </div>
          <div className="field psh-toggle">
            <label htmlFor="sf-delayed">
              <input
                id="sf-delayed"
                name="delayed"
                type="checkbox"
                value="1"
                defaultChecked={filters.delayed}
              />{" "}
              {tv("Delayed only")}
            </label>
          </div>
          <div className="field psh-toggle">
            <label htmlFor="sf-delivered">
              <input
                id="sf-delivered"
                name="delivered"
                type="checkbox"
                value="1"
                defaultChecked={filters.delivered}
              />{" "}
              {tv("Delivered only")}
            </label>
          </div>
          <div className="field psh-actions">
            <button className="btn btn-ghost btn-sm" type="submit">
              {tv("Apply filters")}
            </button>
            {filtered ? (
              <a className="btn btn-ghost btn-sm" href={basePath}>
                {tv("Clear filters")}
              </a>
            ) : null}
          </div>
        </fieldset>
      </form>

      {failed ? (
        <p className="pempty" role="alert">
          {tv(
            "We couldn't load your shipments just now. Refresh the page, or call (908) 404-5373 and a dispatcher will read them to you.",
          )}
        </p>
      ) : null}

      {/* §23: the result count changes on every filter submit — announce it. */}
      <p
        className="pempty psh-count"
        role="status"
        style={{ padding: "0 0 12px" }}
      >
        {total === null
          ? tv("Showing your most recent shipments.")
          : total === 0
            ? tv("No shipments match.")
            : `${rangeStart}–${rangeEnd} ${tv("of")} ${total}`}
      </p>

      <div className="ptable-wrap">
        {rows.length === 0 ? (
          <p className="pempty">
            {failed
              ? tv("Nothing could be loaded.")
              : filtered
                ? tv(
                    "No shipments match these filters. Clear them to see everything on your account.",
                  )
                : tv(
                    "No shipments yet. Once a dispatcher books your first load it appears here with its tracking number and milestones.",
                  )}
          </p>
        ) : (
          <table className="ptable ptable--cards">
            <caption className="sr-only">{tv("Your shipments")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("shipment.result.tracking_number")}</th>
                <th scope="col">{tv("Status")}</th>
                <th scope="col">{tv("Lane")}</th>
                <th scope="col">{tv("Pickup")}</th>
                <th scope="col">{tv("Estimated delivery")}</th>
                <th scope="col">{tv("Equipment")}</th>
                <th scope="col">{tv("PO or reference")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const late =
                  row.status === "delayed" || (row.delay_minutes ?? 0) > 0;
                return (
                  <tr key={row.id}>
                    <td data-th={t("shipment.result.tracking_number")}>
                      <a className="mono" href={`${detailBase}/${row.id}`}>
                        {row.tracking_number}
                      </a>
                    </td>
                    <td data-th={tv("Status")}>
                      <span
                        className={`pbadge ${late ? "red" : "amber"}`.trim()}
                      >
                        {t(statusKey(row.status))}
                      </span>
                    </td>
                    <td data-th={tv("Lane")}>{lane(row)}</td>
                    <td data-th={tv("Pickup")}>
                      {formatTrackingDate(row.pickup_appointment_at, locale) ??
                        "—"}
                    </td>
                    <td data-th={tv("Estimated delivery")}>
                      {formatTrackingDateTime(
                        row.estimated_delivery_at ??
                          row.delivery_appointment_at,
                        locale,
                      ) ?? "—"}
                    </td>
                    <td data-th={tv("Equipment")}>{row.equipment}</td>
                    <td data-th={tv("PO or reference")}>
                      {row.po_number ?? row.shipper_reference ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── §25 server-side pagination ─────────────────────────────────── */}
      {pageCount > 1 ? (
        <nav className="psh-pager" aria-label={tv("Shipment pages")}>
          {page > 1 ? (
            <a
              className="btn btn-ghost btn-sm"
              href={`${basePath}${filterQuery(filters, page - 1)}`}
              rel="prev"
            >
              ← {tv("Previous")}
            </a>
          ) : null}
          <span className="mono">
            {tv("Page")} {page} {tv("of")} {pageCount}
          </span>
          {page < pageCount ? (
            <a
              className="btn btn-ghost btn-sm"
              href={`${basePath}${filterQuery(filters, page + 1)}`}
              rel="next"
            >
              {tv("Next")} →
            </a>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
