import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getStaffScope } from "@/lib/staff-scope";
import {
  BOARD_PAGE_SIZE,
  getBoard,
  getBoardColumn,
  parseBoardColumn,
} from "@/lib/shipments/board";
import { parsePage, parseShipmentFilters } from "@/lib/shipments/shipper-list";
import { searchShipmentsByTrackingNumber } from "@/lib/shipments/search";
import { getBooleanSetting } from "@/lib/company-settings";
import {
  ShipmentBoard,
  ShipmentColumnView,
} from "@/components/portal/ShipmentBoardView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shipments — PickLoads",
  robots: { index: false, follow: false },
};

/**
 * M-75 — §14's operational board and §5's staff search.
 *
 * ── EVERY QUERY IS SERVER-SIDE, BOUNDED AND SCOPED ────────────────────────
 *
 * Eight column queries (or one, expanded and paginated) plus at most one
 * search, all issued here with the COOKIE-BOUND client so 0018's staff policy
 * applies underneath the §19 dispatcher scope. Nothing is fetched in the
 * browser and nothing unbounded is fetched at all — `src/lib/shipments/board.ts`
 * holds the ceiling and `tests/unit/shipment-board.test.ts` proves no path
 * escapes it.
 *
 * ── WHY `force-dynamic` AND NOT REALTIME ──────────────────────────────────
 *
 * §14: *"use real-time updates only where useful… do not use Realtime for
 * every table."* The argument for not subscribing is in `board.ts` and the
 * decisive half is a security one: dispatcher scoping is QUERY-LEVEL (M-71's
 * R-2), so a Realtime subscription filtered only by RLS would push dispatcher
 * B's freight to dispatcher A. The board is rendered fresh on every request
 * instead, and M-72's compare-and-swap makes stale data SAFE rather than
 * merely tolerable — a write from a stale page is refused with
 * `status_conflict`, which the forms surface as "reload".
 */
export default async function AdminShipmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const session = await requireStaff(locale);
  const sp = await searchParams;

  const supabase = await createClient();
  const scope = await getStaffScope(supabase, session);
  const filters = parseShipmentFilters(sp);
  const column = parseBoardColumn(sp.col);
  const now = new Date();

  // §2 — the board is honest about the pre-launch state rather than showing an
  // empty operational surface that implies live brokerage with no freight.
  const brokerageOpen = await getBooleanSetting("brokerage_active", false);

  const [search, board] = await Promise.all([
    searchShipmentsByTrackingNumber(supabase, sp.q, scope, session.userId),
    column === null
      ? getBoard(supabase, { filters, scope, userId: session.userId, now })
      : getBoardColumn(supabase, column, {
          filters,
          scope,
          userId: session.userId,
          now,
          page: parsePage(sp.page),
          pageSize: BOARD_PAGE_SIZE,
        }),
  ]);

  const shared = {
    filters,
    search,
    restricted: scope.restricted,
    scopedCarrierCount: scope.carrierIds?.length ?? 0,
  };

  return (
    <main id="main" className="a-page">
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk / Operations</span>
          <h1>Shipments</h1>
        </div>
        <Link className="btn btn-amber btn-sm" href="/portal/admin/shipments/new">
          + New shipment
        </Link>
      </div>

      {!brokerageOpen ? (
        <p className="pempty" role="status" style={{ padding: "0 0 14px" }}>
          Brokerage operations are switched off, so no new shipment can be
          created. Anything already in flight stays on the board and stays
          operable — an admin turns creation back on with the{" "}
          <code>brokerage_active</code> switch in Settings.
        </p>
      ) : null}

      {Array.isArray(board) ? (
        <ShipmentBoard columns={board} {...shared} />
      ) : (
        <ShipmentColumnView result={board} {...shared} />
      )}
    </main>
  );
}
