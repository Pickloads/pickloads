import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getStaffScope } from "@/lib/staff-scope";
import { LoadStatusActions } from "@/components/portal/LoadForms";
import { GenerateInvoiceButton } from "@/components/portal/InvoiceActions";
import { isStripeConfigured } from "@/lib/stripe";
import {
  LOAD_STATUSES,
  LOAD_STATUS_BADGE,
  LOAD_STATUS_LABELS,
  formatLane,
  formatMoney,
  formatLoadedRpm,
  formatTrueRpm,
} from "@/lib/loads";
import type { LoadStatus } from "@/lib/supabase/database.types";
import { ScrollRegion } from "@/components/portal/ScrollRegion";

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
 * M-31 adds "Generate invoice" on delivered rows + Stripe payment history
 * (read from the webhook_events ledger). Reads run under the staff RLS
 * policies (cookie-bound client).
 */
export default async function AdminLoadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const session = await requireStaff(locale);
  const sp = await searchParams;
  const filterStatus = parseStatus(typeof sp.status === "string" ? sp.status : undefined);
  const filterCarrier =
    typeof sp.carrier === "string" && UUID.test(sp.carrier) ? sp.carrier : null;
  const filterDispatcher =
    typeof sp.dispatcher === "string" && UUID.test(sp.dispatcher)
      ? sp.dispatcher
      : null;

  const supabase = await createClient();
  // M-58 least privilege: dispatchers see only their assigned carriers.
  const scope = await getStaffScope(supabase, session);

  let query = supabase
    .from("loads")
    .select(
      "id, carrier_id, dispatcher_id, broker_name, origin_city, origin_state, dest_city, dest_state, pickup_date, delivery_date, equipment, gross_rate, miles, deadhead_miles, fee_pct_applied, dispatch_fee, status, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (scope.carrierIds !== null) query = query.in("carrier_id", scope.carrierIds);
  if (filterStatus) query = query.eq("status", filterStatus);
  if (filterCarrier) query = query.eq("carrier_id", filterCarrier);
  if (filterDispatcher) query = query.eq("dispatcher_id", filterDispatcher);

  let carrierQuery = supabase
    .from("carriers")
    .select("id, company_name, dispatch_fee_pct")
    .order("company_name");
  if (scope.carrierIds !== null) {
    carrierQuery = carrierQuery.in("id", scope.carrierIds);
  }

  const [{ data: loadRows, error }, { data: carrierRows }, { data: staffRows }] =
    await Promise.all([
      query,
      carrierQuery,
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

  // M-31 payment history — Stripe events recorded by the invoice action and
  // the signature-verified webhook (no schema change: webhook_events is the
  // audit ledger; Stripe itself stays the billing source of truth).
  const { data: stripeEvents } = await supabase
    .from("webhook_events")
    .select("id, event_type, payload, status, created_at")
    .eq("provider", "stripe")
    .order("created_at", { ascending: false })
    .limit(25);
  const stripeReady = isStripeConfigured();

  const totals = {
    gross: loads.reduce((sum, l) => sum + (l.gross_rate ?? 0), 0),
    fees: loads.reduce((sum, l) => sum + l.dispatch_fee, 0),
  };

  return (
    <main id="main" className="a-page">
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk / Operations</span>
          <h1>Loads</h1>
        </div>
        <Link className="btn btn-amber btn-sm" href="/portal/admin/loads/new">
          + Book a load
        </Link>
      </div>

      {scope.restricted ? (
        <p className="pempty lede">
          Scoped view: your assigned carriers only ({scope.carrierIds?.length ?? 0}).
          Ask an admin to assign carriers on the Users page.
        </p>
      ) : null}

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

      <ScrollRegion label="Loads">
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
                {/* M-69/P-7: "RPM" was gross / LOADED miles only. Labelled
                    honestly now, with true RPM (deadhead + loaded) beside
                    it — "—" until deadhead_miles is captured (0016). */}
                <th>Loaded RPM</th>
                <th>True RPM</th>
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
                  <td className="nw">{formatLane(l)}</td>
                  <td>{l.pickup_date ?? "—"}</td>
                  <td>{l.equipment ?? "—"}</td>
                  <td>{formatMoney(l.gross_rate)}</td>
                  <td>{formatLoadedRpm(l.gross_rate, l.miles)}</td>
                  <td>{formatTrueRpm(l.gross_rate, l.miles, l.deadhead_miles)}</td>
                  <td>
                    {formatMoney(l.dispatch_fee)}
                    <span
                      style={{
                        display: "block",
                        fontFamily: "var(--font-mono)",
                        fontSize: ".62rem",
                        color: "var(--color-steel)",
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
                    {l.status === "delivered" ? (
                      <GenerateInvoiceButton
                        loadId={l.id}
                        fee={l.dispatch_fee}
                        configured={stripeReady}
                      />
                    ) : null}{" "}
                    <LoadStatusActions loadId={l.id} status={l.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ScrollRegion>

      <span className="psec">Billing — Stripe payment history</span>
      <p className="pempty lede">
        {/* Compliance rule (src/lib/stripe.ts): dispatch fee only. */}
        Only the dispatch fee is invoiced through Stripe. Freight payments go
        broker → carrier/factoring and never touch PickLoads.
      </p>
      <ScrollRegion label="Stripe payment history">
        {stripeEvents && stripeEvents.length > 0 ? (
          <table className="ptable">
            <thead>
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Invoice</th>
                <th>Load</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {stripeEvents.map((e) => {
                const p =
                  typeof e.payload === "object" && e.payload !== null
                    ? (e.payload as Record<string, unknown>)
                    : {};
                const invoiceId =
                  typeof p.invoice_id === "string" ? p.invoice_id : null;
                const hostedUrl =
                  typeof p.hosted_invoice_url === "string"
                    ? p.hosted_invoice_url
                    : null;
                const loadId = typeof p.load_id === "string" ? p.load_id : null;
                const amount =
                  typeof p.amount_usd === "number"
                    ? formatMoney(p.amount_usd)
                    : "—";
                return (
                  <tr key={e.id}>
                    <td className="nw">
                      {new Date(e.created_at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                    <td>{e.event_type}</td>
                    <td className="mono-sm">
                      {invoiceId && hostedUrl ? (
                        <a href={hostedUrl} target="_blank" rel="noreferrer">
                          {invoiceId}
                        </a>
                      ) : (
                        (invoiceId ?? "—")
                      )}
                    </td>
                    <td className="mono-sm">
                      {loadId ? `${loadId.slice(0, 8)}…` : "—"}
                    </td>
                    <td>{amount}</td>
                    <td>
                      <span
                        className={`pbadge ${e.status === "processed" ? "green" : e.status === "failed" ? "red" : "amber"}`}
                      >
                        {e.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="pempty">
            {stripeReady
              ? "No Stripe activity yet. Invoices appear here once a delivered load is invoiced."
              : "Stripe isn't connected (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET). Invoicing buttons activate once keys are set."}
          </p>
        )}
      </ScrollRegion>
    </main>
  );
}
