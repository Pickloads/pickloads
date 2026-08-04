import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LoadStatusActions } from "@/components/portal/LoadForms";
import {
  LOAD_STATUSES,
  LOAD_STATUS_BADGE,
  LOAD_STATUS_LABELS,
  formatLane,
  formatMoney,
  formatRpm,
} from "@/lib/loads";
import type { LoadStatus } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Loads — PickLoads",
  robots: { index: false, follow: false },
};

function parseStatus(value: string | undefined): LoadStatus | null {
  return LOAD_STATUSES.find((s) => s === value) ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * M-30 — staff loads board: filterable list (status / carrier / dispatcher),
 * RPM display, status transitions per the M-30 state machine.
 * Reads run under the staff RLS policies (cookie-bound client).
 */
export default async function AdminLoadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  await requireStaff(locale);
  const sp = await searchParams;
  const filterStatus = parseStatus(typeof sp.status === "string" ? sp.status : undefined);
  const filterCarrier =
    typeof sp.carrier === "string" && UUID.test(sp.carrier) ? sp.carrier : null;
  const filterDispatcher =
    typeof sp.dispatcher === "string" && UUID.test(sp.dispatcher)
      ? sp.dispatcher
      : null;

  const supabase = await createClient();

  let query = supabase
    .from("loads")
    .select(
      "id, carrier_id, dispatcher_id, broker_name, origin_city, origin_state, dest_city, dest_state, pickup_date, delivery_date, equipment, gross_rate, miles, fee_pct_applied, dispatch_fee, status, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (filterStatus) query = query.eq("status", filterStatus);
  if (filterCarrier) query = query.eq("carrier_id", filterCarrier);
  if (filterDispatcher) query = query.eq("dispatcher_id", filterDispatcher);

  const [{ data: loadRows, error }, { data: carrierRows }, { data: staffRows }] =
    await Promise.all([
      query,
      supabase
        .from("carriers")
        .select("id, company_name, dispatch_fee_pct")
        .order("company_name"),
      supabase
        .from("profiles")
        .select("id, full_name, role")
        .in("role", ["admin", "dispatcher"]),
    ]);

  const loads = loadRows ?? [];
  const carriers = carrierRows ?? [];
  const staff = staffRows ?? [];
  const carrierName = (id: string) =>
    carriers.find((c) => c.id === id)?.company_name ?? "Unknown";
  const dispatcherName = (id: string | null) =>
    id === null ? "—" : (staff.find((s) => s.id === id)?.full_name ?? "Staff");

  const totals = {
    gross: loads.reduce((sum, l) => sum + (l.gross_rate ?? 0), 0),
    fees: loads.reduce((sum, l) => sum + l.dispatch_fee, 0),
  };

  return (
    <main>
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk / Operations</span>
          <h1>Loads</h1>
        </div>
        <Link className="btn btn-amber btn-sm" href="/portal/admin/loads/new">
          + Book a load
        </Link>
      </div>

      <form method="get" className="kfilters">
        <div className="field">
          <label htmlFor="lf-status">Status</label>
          <select id="lf-status" name="status" defaultValue={filterStatus ?? ""}>
            <option value="">All statuses</option>
            {LOAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LOAD_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="lf-carrier">Carrier</label>
          <select id="lf-carrier" name="carrier" defaultValue={filterCarrier ?? ""}>
            <option value="">All carriers</option>
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company_name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="lf-dispatcher">Dispatcher</label>
          <select
            id="lf-dispatcher"
            name="dispatcher"
            defaultValue={filterDispatcher ?? ""}
          >
            <option value="">All dispatchers</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name ?? "Staff"}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-ghost btn-sm" type="submit">
          Filter
        </button>
      </form>

      <div className="ptiles">
        <div className="ptile">
          <b>{loads.length}</b>
          <span>Loads shown</span>
        </div>
        <div className="ptile">
          <b>{formatMoney(totals.gross)}</b>
          <span>Gross (filtered)</span>
        </div>
        <div className="ptile">
          <b>{formatMoney(totals.fees)}</b>
          <span>Dispatch fees (filtered)</span>
        </div>
      </div>

      <div className="ptable-wrap">
        {error ? (
          <p className="pempty">
            Couldn&apos;t load loads ({error.message}). Check the Supabase
            connection.
          </p>
        ) : loads.length === 0 ? (
          <p className="pempty">
            No loads match. Book the first one — the fee % snapshots
            automatically from the carrier&apos;s rate.
          </p>
        ) : (
          <table className="ptable">
            <thead>
              <tr>
                <th>Carrier</th>
                <th>Lane</th>
                <th>Pickup</th>
                <th>Equip</th>
                <th>Gross</th>
                <th>RPM</th>
                <th>Fee</th>
                <th>Dispatcher</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loads.map((l) => (
                <tr key={l.id}>
                  <td>{carrierName(l.carrier_id)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatLane(l)}</td>
                  <td>{l.pickup_date ?? "—"}</td>
                  <td>{l.equipment ?? "—"}</td>
                  <td>{formatMoney(l.gross_rate)}</td>
                  <td>{formatRpm(l.gross_rate, l.miles)}</td>
                  <td>
                    {formatMoney(l.dispatch_fee)}
                    <span
                      style={{
                        display: "block",
                        fontFamily: "var(--font-mono)",
                        fontSize: ".62rem",
                        color: "#5c666d",
                      }}
                    >
                      {l.fee_pct_applied ?? "—"}%
                    </span>
                  </td>
                  <td>{dispatcherName(l.dispatcher_id)}</td>
                  <td>
                    <span className={`pbadge ${LOAD_STATUS_BADGE[l.status]}`}>
                      {LOAD_STATUS_LABELS[l.status]}
                    </span>
                  </td>
                  <td>
                    <LoadStatusActions loadId={l.id} status={l.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </main>
  );
}
