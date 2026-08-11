import { Link } from "@/i18n/navigation";
import {
  BOARD_COLUMNS,
  type BoardColumn,
  type BoardColumnResult,
  type ShipmentBoardRow,
} from "@/lib/shipments/board";
import { ScrollRegion } from "@/components/portal/ScrollRegion";
import { SHIPMENT_STATUSES, type ShipmentStatus } from "@/lib/shipments/types";
import type { ShipmentListFilters } from "@/lib/shipments/shipper-list";
import type { TrackingSearchResult } from "@/lib/shipments/search";

/**
 * M-75 — the §14 operational board, presentational half.
 *
 * ── THE CRM-KANBAN IDIOM, REUSED RATHER THAN REINVENTED ───────────────────
 *
 * `.kanban` / `.kcol` / `.kcard` / `.kfilters` are M-23's, already in
 * `portal.css`, already responsive (the container scrolls horizontally at
 * every breakpoint) and already audited. This component adds **no new CSS
 * class and no new colour** — CLAUDE.md's rule, and the reason M-75 needs no
 * `portal.css` change at all.
 *
 * ── SERVER COMPONENT, NO CLIENT STATE, NO DRAG ────────────────────────────
 *
 * M-23's board is a client component because it drag-and-drops leads. This one
 * is a plain server component:
 *
 *   * **Filters are a `<form method="get">`.** Keyboard-reachable with
 *     nothing to get wrong, shareable as a URL, and — the §25 point — they
 *     narrow the QUERY rather than an array already in the browser.
 *   * **Column expansion is a link** (`?col=…&page=…`), so paging a column is
 *     a new server query rather than a client fetch of everything.
 *   * **No drag.** A lead's status is pipeline bookkeeping; a shipment's is
 *     §20's graph with preconditions, an actor gate and a compare-and-swap. A
 *     drag gesture cannot carry a cancellation reason or a closeout assertion
 *     and has nowhere to show a refusal, so it would either fail silently or
 *     bypass the engine. Status moves live on the shipment page as explicit
 *     buttons, one per legal target.
 *
 * ── §23 ACCESSIBILITY ─────────────────────────────────────────────────────
 *
 * Each column is a `<section>` with an `aria-label` carrying its name AND its
 * count, so a screen-reader user hears "Delayed, 3 shipments" rather than
 * counting cards. Status is rendered as TEXT in a badge, never as colour
 * alone. The result summary is `role="status"` so submitting a filter
 * announces its effect. Every filter control has a `<label for>`.
 */

const STATUS_TONE: Partial<Record<ShipmentStatus, string>> = {
  delayed: "red",
  cancelled: "red",
  completed: "green",
  delivered: "green",
  pod_uploaded: "green",
  in_transit: "amber",
  picked_up: "amber",
};

export function statusLabel(status: ShipmentStatus): string {
  return status.replace(/_/g, " ");
}

function badgeClass(status: ShipmentStatus): string {
  const tone = STATUS_TONE[status];
  return tone ? `pbadge ${tone}` : "pbadge";
}

function lane(row: ShipmentBoardRow): string {
  return `${row.origin_city}, ${row.origin_state} → ${row.destination_city}, ${row.destination_state}`;
}

function shortDate(iso: string | null): string {
  if (iso === null) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** One card. A link, so it is reachable by keyboard and by screen reader. */
function ShipmentCard({ row }: { row: ShipmentBoardRow }) {
  const late = (row.delay_minutes ?? 0) > 0;
  return (
    <div className="kcard">
      <b>
        <Link href={`/portal/admin/shipments/${row.id}`}>
          {row.tracking_number}
        </Link>
      </b>
      <span className="kmeta">{lane(row)}</span>
      <span className="kmeta">
        {row.equipment} · PU {shortDate(row.pickup_appointment_at)}
      </span>
      <span className="ktags">
        <span className={badgeClass(row.status)}>{statusLabel(row.status)}</span>
        {late ? (
          <span className="pbadge red">{row.delay_minutes} min late</span>
        ) : null}
        {row.carrier_id === null ? (
          <span className="pbadge">no carrier</span>
        ) : null}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Filters + §5 search
 * ------------------------------------------------------------------ */

function FilterBar({
  filters,
  search,
  restricted,
  scopedCarrierCount,
}: {
  filters: ShipmentListFilters;
  search: TrackingSearchResult;
  restricted: boolean;
  scopedCarrierCount: number;
}) {
  return (
    <>
      {restricted ? (
        <p className="pempty" style={{ padding: "0 0 12px" }}>
          Scoped view: shipments assigned to you, plus your {scopedCarrierCount}{" "}
          assigned {scopedCarrierCount === 1 ? "carrier" : "carriers"}. Search is
          scoped the same way — ask an admin to assign a carrier if a shipment is
          missing.
        </p>
      ) : null}
      <form method="get" className="kfilters" role="search">
        <div className="field">
          {/* §5: "searchable by admin and dispatcher". Paste the whole number
              or type the last digits — M-70's normaliser handles both. */}
          <label htmlFor="sb-q">Tracking number</label>
          <input
            id="sb-q"
            name="q"
            type="search"
            inputMode="search"
            maxLength={32}
            placeholder="PL-2026-000458 or 000458"
            defaultValue={search.term.raw}
          />
        </div>
        <div className="field">
          <label htmlFor="sb-status">Status</label>
          <select id="sb-status" name="status" defaultValue={filters.status ?? ""}>
            <option value="">All statuses</option>
            {SHIPMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sb-origin">Origin</label>
          <input id="sb-origin" name="origin" maxLength={64} defaultValue={filters.origin ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="sb-destination">Destination</label>
          <input
            id="sb-destination"
            name="destination"
            maxLength={64}
            defaultValue={filters.destination ?? ""}
          />
        </div>
        <div className="field">
          <label htmlFor="sb-equipment">Equipment</label>
          <input
            id="sb-equipment"
            name="equipment"
            maxLength={64}
            defaultValue={filters.equipment ?? ""}
          />
        </div>
        <div className="field">
          <label htmlFor="sb-from">Pickup from</label>
          <input id="sb-from" name="from" type="date" defaultValue={filters.dateFrom ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="sb-to">Pickup to</label>
          <input id="sb-to" name="to" type="date" defaultValue={filters.dateTo ?? ""} />
        </div>
        <button className="btn btn-ghost btn-sm" type="submit">
          Apply
        </button>
        <Link className="btn btn-ghost btn-sm" href="/portal/admin/shipments">
          Clear
        </Link>
      </form>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * §5 search results
 * ------------------------------------------------------------------ */

export function SearchResults({ search }: { search: TrackingSearchResult }) {
  if (!search.searched) return null;
  return (
    <section aria-labelledby="sb-search-h">
      <span className="psec" id="sb-search-h">
        Search — {search.term.kind === "exact" ? "exact number" : "number ending"}{" "}
        {search.term.kind === "exact" ? search.term.value : search.term.value}
      </span>
      {search.failed ? (
        <p className="pempty" role="alert">
          The search failed. Retry, and check the Supabase connection.
        </p>
      ) : search.rows.length === 0 ? (
        <p className="pempty" role="status">
          No shipment matches that number in your scope.
        </p>
      ) : (
        <ScrollRegion label="Search results">
          <table className="ptable">
            <thead>
              <tr>
                <th scope="col">Tracking</th>
                <th scope="col">Lane</th>
                <th scope="col">Equipment</th>
                <th scope="col">Pickup</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {search.rows.map((row) => (
                <tr key={row.id}>
                  <td data-th="Tracking">
                    <Link href={`/portal/admin/shipments/${row.id}`}>
                      {row.tracking_number}
                    </Link>
                  </td>
                  <td data-th="Lane">{lane(row)}</td>
                  <td data-th="Equipment">{row.equipment}</td>
                  <td data-th="Pickup">{shortDate(row.pickup_appointment_at)}</td>
                  <td data-th="Status">
                    <span className={badgeClass(row.status)}>
                      {statusLabel(row.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
      {search.truncated ? (
        <p className="pempty" style={{ padding: "8px 0 0" }}>
          Showing the first {search.rows.length} matches. Paste the full tracking
          number for an exact hit.
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The board
 * ------------------------------------------------------------------ */

/** Preserve the active filters when linking to an expanded column. */
function queryFor(
  filters: ShipmentListFilters,
  extra: Record<string, string>,
): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.origin) params.set("origin", filters.origin);
  if (filters.destination) params.set("destination", filters.destination);
  if (filters.equipment) params.set("equipment", filters.equipment);
  if (filters.dateFrom) params.set("from", filters.dateFrom);
  if (filters.dateTo) params.set("to", filters.dateTo);
  for (const [key, value] of Object.entries(extra)) params.set(key, value);
  const q = params.toString();
  return q === "" ? "" : `?${q}`;
}

function ColumnHeading({ result }: { result: BoardColumnResult }) {
  /* M-82 D-7: was an <h3> directly under the page <h1> — a skipped level on
     the operational board, while the expanded single-column view rendered the
     same thing as an <h2>. §23 asks for "correct headings"; axe's
     `heading-order` rule is tagged best-practice rather than WCAG A/AA, which
     is why the board shipped with it. `portal.css` carries the matching
     `.kcol h2` rule — the type is unchanged. */
  return (
    <h2>
      {result.column.label} <i>{result.failed ? "—" : (result.total ?? "—")}</i>
    </h2>
  );
}

export function ShipmentBoard({
  columns,
  filters,
  search,
  restricted,
  scopedCarrierCount,
}: {
  columns: BoardColumnResult[];
  filters: ShipmentListFilters;
  search: TrackingSearchResult;
  restricted: boolean;
  scopedCarrierCount: number;
}) {
  const total = columns.reduce((sum, c) => sum + (c.total ?? 0), 0);
  return (
    <>
      <FilterBar
        filters={filters}
        search={search}
        restricted={restricted}
        scopedCarrierCount={scopedCarrierCount}
      />
      <SearchResults search={search} />
      <p className="psh-count" role="status" style={{ margin: "0 0 12px" }}>
        {total} shipment{total === 1 ? "" : "s"} across the eight operational
        columns. Cancelled shipments are not on the board — find them with the
        status filter.
      </p>
      <ScrollRegion
        className="kanban"
        label="Operational board — eight columns, scrolls sideways"
      >
        {columns.map((result) => (
          <section
            key={result.column.id}
            className="kcol"
            aria-label={`${result.column.label} — ${result.total ?? 0} shipments. ${result.column.hint}.`}
          >
            <ColumnHeading result={result} />
            {result.failed ? (
              <p className="pempty" role="alert" style={{ padding: "8px 4px" }}>
                Couldn&apos;t load this column.
              </p>
            ) : result.rows.length === 0 ? (
              <p className="pempty" style={{ padding: "8px 4px" }}>
                Nothing here.
              </p>
            ) : (
              result.rows.map((row) => <ShipmentCard key={row.id} row={row} />)
            )}
            {(result.total ?? 0) > result.rows.length ? (
              <Link
                className="btn btn-ghost btn-sm"
                href={`/portal/admin/shipments${queryFor(filters, { col: result.column.id })}`}
              >
                View all {result.total}
              </Link>
            ) : null}
          </section>
        ))}
      </ScrollRegion>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * One expanded column, paginated (§25)
 * ------------------------------------------------------------------ */

export function ShipmentColumnView({
  result,
  filters,
  search,
  restricted,
  scopedCarrierCount,
}: {
  result: BoardColumnResult;
  filters: ShipmentListFilters;
  search: TrackingSearchResult;
  restricted: boolean;
  scopedCarrierCount: number;
}) {
  const column: BoardColumn = result.column;
  const base = (page: number) =>
    `/portal/admin/shipments${queryFor(filters, { col: column.id, page: String(page) })}`;

  return (
    <>
      <FilterBar
        filters={filters}
        search={search}
        restricted={restricted}
        scopedCarrierCount={scopedCarrierCount}
      />
      <SearchResults search={search} />
      <div className="pbar" style={{ marginBottom: 12 }}>
        <div>
          <span className="crumb">{column.hint}</span>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 800 }}>{column.label}</h2>
        </div>
        <Link className="btn btn-ghost btn-sm" href="/portal/admin/shipments">
          ← All columns
        </Link>
      </div>
      <p className="psh-count" role="status" style={{ margin: "0 0 12px" }}>
        {result.failed
          ? "This column failed to load."
          : `${result.total ?? 0} shipment${result.total === 1 ? "" : "s"} · page ${result.page} of ${result.pageCount}`}
      </p>
      <ScrollRegion label={`${column.label} column`}>
        {result.failed ? (
          <p className="pempty" role="alert">
            Couldn&apos;t load this column. Retry, and check the Supabase
            connection.
          </p>
        ) : result.rows.length === 0 ? (
          <p className="pempty">Nothing in this column right now.</p>
        ) : (
          <table className="ptable ptable--cards">
            <thead>
              <tr>
                <th scope="col">Tracking</th>
                <th scope="col">Lane</th>
                <th scope="col">Equipment</th>
                <th scope="col">Pickup</th>
                <th scope="col">Delivery</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.id}>
                  <td data-th="Tracking">
                    <Link href={`/portal/admin/shipments/${row.id}`}>
                      {row.tracking_number}
                    </Link>
                  </td>
                  <td data-th="Lane">{lane(row)}</td>
                  <td data-th="Equipment">{row.equipment}</td>
                  <td data-th="Pickup">{shortDate(row.pickup_appointment_at)}</td>
                  <td data-th="Delivery">
                    {shortDate(row.delivery_appointment_at)}
                  </td>
                  <td data-th="Status">
                    <span className={badgeClass(row.status)}>
                      {statusLabel(row.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ScrollRegion>
      {result.pageCount > 1 ? (
        <nav className="psh-pager" aria-label={`${column.label} pagination`}>
          {result.page > 1 ? (
            <Link rel="prev" href={base(result.page - 1)}>
              ← Newer
            </Link>
          ) : null}
          <span>
            Page {result.page} of {result.pageCount}
          </span>
          {result.page < result.pageCount ? (
            <Link rel="next" href={base(result.page + 1)}>
              Older →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}

export { BOARD_COLUMNS };
