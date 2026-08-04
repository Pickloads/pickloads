import type { Metadata } from "next";
import { getPathname, Link } from "@/i18n/navigation";
import { requireCarrier } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { getMyCarrierId } from "@/lib/memberships";
import { getV4 } from "@/i18n/v4-server";
import { formatLane, formatMoney, LOAD_STATUS_BADGE, LOAD_STATUS_LABELS } from "@/lib/loads";
import type { DocType } from "@/lib/supabase/database.types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Overview — PickLoads Carrier Portal",
  robots: { index: false, follow: false },
};

/** Documents the dispatch desk needs before activation (M-20 wizard set). */
const REQUIRED_DOCS: ReadonlyArray<{ type: DocType; label: string }> = [
  { type: "mc_authority", label: "MC Authority Letter" },
  { type: "coi", label: "Certificate of Insurance" },
  { type: "w9", label: "W-9 Form" },
  { type: "voided_check", label: "Voided Check" },
];

/**
 * M-55 — carrier portal overview (the directive's dashboard home). Every
 * read is cookie-bound RLS ("member read …" membership policies); the only
 * admin-client use is resolving the assigned dispatcher's display name
 * (staff profiles aren't readable by carrier sessions — name/phone only).
 * Honest empty states everywhere: nothing renders fake data.
 */
export default async function CarrierOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireCarrier(locale);
  const tv = await getV4(locale);
  const supabase = await createClient();

  const carrierId = await getMyCarrierId(supabase);
  if (!carrierId) {
    return (
      <main>
        <div className="pbar">
          <div>
            <span className="crumb">{tv("Carrier portal")}</span>
            <h1>{tv("Overview")}</h1>
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

  const [
    { data: carrier },
    { data: docs },
    { data: activeLoads },
    { data: completedLoads },
    { data: openInvoices },
    { data: notifications },
  ] = await Promise.all([
    supabase
      .from("carriers")
      .select(
        "id, company_name, mc_number, dot_number, agreement_signed_at, active, insurance_expiry, assigned_dispatcher_id",
      )
      .eq("id", carrierId)
      .maybeSingle(),
    supabase
      .from("documents")
      .select("id, type, status")
      .eq("carrier_id", carrierId)
      .limit(200),
    supabase
      .from("loads")
      .select("id, origin_city, origin_state, dest_city, dest_state, pickup_date, status")
      .eq("carrier_id", carrierId)
      .in("status", ["booked", "in_transit"])
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("loads")
      .select("id, origin_city, origin_state, dest_city, dest_state, delivery_date, dispatch_fee, status")
      .eq("carrier_id", carrierId)
      .in("status", ["delivered", "invoiced", "paid"])
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("invoices")
      .select("id, amount_cents, status, hosted_url, due_at")
      .eq("carrier_id", carrierId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("notifications")
      .select("id, title, href, read_at, created_at")
      .eq("profile_id", session.userId)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (!carrier) {
    return (
      <main>
        <p className="pempty">
          {tv(
            "Your account isn't linked to a carrier record yet. If you just onboarded, our team activates the link during document review — or call (908) 404-5373.",
          )}
        </p>
      </main>
    );
  }

  // Assigned dispatcher (name only) — staff profiles aren't carrier-readable.
  let dispatcher: { name: string; phone: string | null } | null = null;
  if (carrier.assigned_dispatcher_id) {
    const admin = tryCreateAdminClient();
    if (admin) {
      const { data } = await admin
        .from("profiles")
        .select("full_name, phone")
        .eq("id", carrier.assigned_dispatcher_id)
        .maybeSingle();
      if (data) {
        dispatcher = { name: data.full_name ?? "PickLoads dispatcher", phone: data.phone };
      }
    }
  }

  const allDocs = docs ?? [];
  const pendingCount = allDocs.filter((d) => d.status === "pending").length;
  const missingDocs = REQUIRED_DOCS.filter(
    (r) => !allDocs.some((d) => d.type === r.type && d.status !== "rejected"),
  );
  const signed = carrier.agreement_signed_at !== null;

  // Onboarding checklist (honest: derived from real rows only).
  const steps: ReadonlyArray<{ label: string; done: boolean }> = [
    { label: "Account created", done: true },
    { label: "MC / USDOT on file", done: carrier.mc_number !== null || carrier.dot_number !== null },
    { label: "Required documents uploaded", done: missingDocs.length === 0 },
    { label: "Dispatch agreement signed", done: signed },
    { label: "Carrier activated for dispatch", done: carrier.active },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  const openInvoiceTotal = (openInvoices ?? []).reduce(
    (sum, i) => sum + i.amount_cents,
    0,
  );
  const accountBadge =
    session.status === "pending" ? (
      <span className="pbadge amber">{tv("Pending verification")}</span>
    ) : carrier.active ? (
      <span className="pbadge green">{tv("Active carrier")}</span>
    ) : (
      <span className="pbadge amber">{tv("Onboarding in progress")}</span>
    );

  const dateFmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <main>
      <div className="pbar">
        <div>
          <span className="crumb">
            {tv("Carrier portal")} / {carrier.company_name}
          </span>
          <h1>{tv("Overview")}</h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{accountBadge}</div>
      </div>

      <div className="ptiles">
        <div className={`ptile ${doneCount === steps.length ? "good" : ""}`}>
          <b>
            {doneCount}/{steps.length}
          </b>
          <span>{tv("Onboarding steps complete")}</span>
        </div>
        <div className={`ptile ${signed ? "good" : ""}`}>
          <b>{signed ? "✓" : "…"}</b>
          <span>{tv("Dispatch agreement")}</span>
          <span className="sub">
            {signed
              ? `${tv("Signed")} ${dateFmt(carrier.agreement_signed_at ?? "")}`
              : tv("Awaiting signature — check your email, or call us")}
          </span>
        </div>
        <div className={`ptile ${pendingCount > 0 ? "" : "good"}`}>
          <b>{pendingCount}</b>
          <span>{tv("Documents in review")}</span>
          <span className="sub">{tv("Reviewed within one business day")}</span>
        </div>
        <div className={`ptile ${missingDocs.length > 0 ? "warn" : "good"}`}>
          <b>{missingDocs.length}</b>
          <span>{tv("Missing documents")}</span>
          {missingDocs.length > 0 ? (
            <span className="sub">{missingDocs.map((d) => tv(d.label)).join(" · ")}</span>
          ) : null}
        </div>
        <div className="ptile">
          <b>{(activeLoads ?? []).length}</b>
          <span>{tv("Active loads")}</span>
        </div>
        <div className={`ptile ${openInvoiceTotal > 0 ? "warn" : "good"}`}>
          <b>{formatMoney(openInvoiceTotal / 100)}</b>
          <span>{tv("Outstanding invoices")}</span>
          <span className="sub">
            {(openInvoices ?? []).length > 0
              ? `${(openInvoices ?? []).length} ${tv("Open")}`
              : tv("Nothing due")}
          </span>
        </div>
      </div>

      <div className="pgrid2">
        <div>
          <div className="pcard">
            <h2>{tv("Onboarding progress")}</h2>
            <ul className="timeline">
              {steps.map((s) => (
                <li className="tl" key={s.label}>
                  <span className="tlt">
                    {s.done ? (
                      <span className="pbadge green">✓ {tv("Done")}</span>
                    ) : (
                      <span className="pbadge amber">{tv("To do")}</span>
                    )}
                  </span>
                  <p>{tv(s.label)}</p>
                </li>
              ))}
            </ul>
            {missingDocs.length > 0 ? (
              <p style={{ marginTop: 12 }}>
                <Link className="btn btn-amber btn-sm" href="/portal/carrier/documents">
                  {tv("Upload documents")} →
                </Link>
              </p>
            ) : null}
          </div>

          <div className="pcard">
            <h2>{tv("Active loads")}</h2>
            {(activeLoads ?? []).length === 0 ? (
              <p className="pempty" style={{ padding: 0 }}>
                {tv(
                  "No loads yet — your dispatcher books them here as soon as you're rolling.",
                )}
              </p>
            ) : (
              <table className="ptable">
                <tbody>
                  {(activeLoads ?? []).map((l) => (
                    <tr key={l.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{formatLane(l)}</td>
                      <td>{l.pickup_date ?? "—"}</td>
                      <td>
                        <span className={`pbadge ${LOAD_STATUS_BADGE[l.status]}`}>
                          {tv(LOAD_STATUS_LABELS[l.status])}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p style={{ marginTop: 10 }}>
              <Link href={getPathname({ href: "/portal/carrier/loads", locale })} className="btn btn-ghost btn-sm">
                {tv("All loads")} →
              </Link>
            </p>
          </div>

          <div className="pcard">
            <h2>{tv("Recently completed")}</h2>
            {(completedLoads ?? []).length === 0 ? (
              <p className="pempty" style={{ padding: 0 }}>
                {tv("Delivered loads appear here with their dispatch fee.")}
              </p>
            ) : (
              <table className="ptable">
                <tbody>
                  {(completedLoads ?? []).map((l) => (
                    <tr key={l.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{formatLane(l)}</td>
                      <td>{formatMoney(l.dispatch_fee)}</td>
                      <td>
                        <span className={`pbadge ${LOAD_STATUS_BADGE[l.status]}`}>
                          {tv(LOAD_STATUS_LABELS[l.status])}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div>
          <div className="pcard">
            <h2>{tv("Your dispatcher")}</h2>
            {dispatcher ? (
              <>
                <p style={{ fontWeight: 700 }}>{dispatcher.name}</p>
                <p className="mono" style={{ fontSize: ".8rem", color: "var(--steel)" }}>
                  {dispatcher.phone ?? "(908) 404-5373"}
                </p>
              </>
            ) : (
              <p className="pempty" style={{ padding: 0 }}>
                {tv(
                  "No dispatcher assigned yet — you'll see yours here once dispatch starts. Meanwhile: (908) 404-5373.",
                )}
              </p>
            )}
            <p style={{ marginTop: 10 }}>
              <Link className="btn btn-ghost btn-sm" href="/portal/carrier/support">
                {tv("Message support")} →
              </Link>
            </p>
          </div>

          <div className="pcard">
            <h2>{tv("Notifications")}</h2>
            {(notifications ?? []).length === 0 ? (
              <p className="pempty" style={{ padding: 0 }}>
                {tv(
                  "Nothing yet — document reviews, load updates and invoices show up here.",
                )}
              </p>
            ) : (
              <ul className="timeline">
                {(notifications ?? []).map((n) => (
                  <li className="tl" key={n.id}>
                    <span className="tlt">
                      {dateFmt(n.created_at)}
                      {n.read_at === null ? (
                        <>
                          {" "}
                          <span className="pbadge amber">{tv("New")}</span>
                        </>
                      ) : null}
                    </span>
                    <p>{n.title}</p>
                  </li>
                ))}
              </ul>
            )}
            <p style={{ marginTop: 10 }}>
              <Link className="btn btn-ghost btn-sm" href="/portal/carrier/notifications">
                {tv("All notifications")} →
              </Link>
            </p>
          </div>

          <div className="pcard">
            <h2>{tv("Insurance expiry")}</h2>
            <p className="mono" style={{ fontSize: ".8rem", color: "var(--steel)" }}>
              {carrier.insurance_expiry ?? "—"}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
