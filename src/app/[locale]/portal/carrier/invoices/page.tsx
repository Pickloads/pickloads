import type { Metadata } from "next";
import { requireCarrier } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyCarrierId } from "@/lib/memberships";
import { getV4 } from "@/i18n/v4-server";
import { formatLane, formatMoney } from "@/lib/loads";
import type { InvoiceStatus } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Invoices & Payments — PickLoads Carrier Portal",
  robots: { index: false, follow: false },
};

const STATUS_BADGE: Record<InvoiceStatus, { cls: string; label: string }> = {
  draft: { cls: "", label: "Draft" },
  open: { cls: "amber", label: "Open" },
  paid: { cls: "green", label: "Paid" },
  void: { cls: "", label: "Void" },
  uncollectible: { cls: "red", label: "Uncollectible" },
};

/**
 * M-55 — invoices & payments from the 0008 `invoices` mirror table (written
 * by the billing action, updated by the Stripe webhook — Stripe remains the
 * system of record for money). Reads run cookie-bound under "member read
 * invoices". Hosted Stripe payment links render when present.
 */
export default async function CarrierInvoicesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireCarrier(locale);
  const tv = await getV4(locale);
  const supabase = await createClient();

  const carrierId = await getMyCarrierId(supabase);
  if (!carrierId) {
    return (
      <main id="main">
        <div className="pbar">
          <div>
            <span className="crumb">{tv("Carrier portal")}</span>
            <h1>{tv("Invoices & Payments")}</h1>
          </div>
        </div>
        <p className="pempty">
          {tv(
            "Your account isn't linked to a carrier record yet. If you just onboarded, our team activates the link during document review — or call (908) 404-5373.",
          )}
        </p>
      </main>
    );
  }

  const { data: invoiceRows } = await supabase
    .from("invoices")
    .select("id, load_id, amount_cents, status, hosted_url, issued_at, due_at, paid_at")
    .eq("carrier_id", carrierId)
    .order("created_at", { ascending: false })
    .limit(100);
  const invoices = invoiceRows ?? [];

  // Resolve lanes for linked loads (two-step, hand-authored types).
  const loadIds = [...new Set(invoices.map((i) => i.load_id).filter((v): v is string => v !== null))];
  const { data: loadRows } = loadIds.length
    ? await supabase
        .from("loads")
        .select("id, origin_city, origin_state, dest_city, dest_state")
        .in("id", loadIds)
    : { data: [] };
  const laneOf = (loadId: string | null) => {
    const load = (loadRows ?? []).find((l) => l.id === loadId);
    return load ? formatLane(load) : "—";
  };

  const openTotal = invoices
    .filter((i) => i.status === "open")
    .reduce((sum, i) => sum + i.amount_cents, 0);
  const paidTotal = invoices
    .filter((i) => i.status === "paid")
    .reduce((sum, i) => sum + i.amount_cents, 0);

  const dateFmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "—";

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">{tv("Carrier portal")}</span>
          <h1>{tv("Invoices & Payments")}</h1>
        </div>
      </div>

      <div className="ptiles">
        <div className={`ptile ${openTotal > 0 ? "warn" : "good"}`}>
          <b>{formatMoney(openTotal / 100)}</b>
          <span>{tv("Outstanding")}</span>
        </div>
        <div className="ptile good">
          <b>{formatMoney(paidTotal / 100)}</b>
          <span>{tv("Paid to date")}</span>
        </div>
        <div className="ptile">
          <b>{invoices.length}</b>
          <span>{tv("Invoices total")}</span>
        </div>
      </div>

      <div className="ptable-wrap">
        {invoices.length === 0 ? (
          <p className="pempty">
            {tv(
              "No invoices yet. After a delivered load, your dispatch-fee invoice shows up here with a secure payment link.",
            )}
          </p>
        ) : (
          <table className="ptable ptable--cards">
            <thead>
              <tr>
                <th>{tv("Issued")}</th>
                <th>{tv("Load")}</th>
                <th>{tv("Amount")}</th>
                <th>{tv("Due")}</th>
                <th>{tv("Status")}</th>
                <th>{tv("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td style={{ whiteSpace: "nowrap" }} data-th={tv("Issued")}>{dateFmt(i.issued_at)}</td>
                  <td style={{ whiteSpace: "nowrap" }} data-th={tv("Load")}>{laneOf(i.load_id)}</td>
                  <td data-th={tv("Amount")}>{formatMoney(i.amount_cents / 100)}</td>
                  <td data-th={tv("Due")}>{i.status === "paid" ? dateFmt(i.paid_at) : dateFmt(i.due_at)}</td>
                  <td data-th={tv("Status")}>
                    <span className={`pbadge ${STATUS_BADGE[i.status].cls}`}>
                      {tv(STATUS_BADGE[i.status].label)}
                    </span>
                  </td>
                  <td data-th={tv("Actions")}>
                    {i.hosted_url ? (
                      <a
                        className="btn btn-ghost btn-sm"
                        href={i.hosted_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {i.status === "open" ? tv("Pay invoice →") : tv("View →")}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="pempty" style={{ paddingLeft: 0 }}>
        {tv(
          "Only the dispatch fee is invoiced through PickLoads. Freight payments go broker → you (or your factoring company) and never touch us.",
        )}
      </p>
    </main>
  );
}
