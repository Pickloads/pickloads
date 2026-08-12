import type { Metadata } from "next";
import { requireCarrier } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyCarrierId } from "@/lib/memberships";
import { getV4 } from "@/i18n/v4-server";
import {
  CarrierDocs,
  type CarrierDocRow,
} from "@/components/portal/CarrierDocs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Documents — PickLoads Carrier Portal",
  robots: { index: false, follow: false },
};

/**
 * M-25 carrier documents (upload/replace/review/download), relocated in M-55
 * from the portal home to its own nav entry. Reads/writes stay RLS-scoped;
 * the carrier lookup now goes through the membership helper (M-57 doctrine).
 */
export default async function CarrierDocumentsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireCarrier(locale);
  const tv = await getV4(locale);
  const supabase = await createClient();

  const carrierId = await getMyCarrierId(supabase);
  const { data: carrier } = carrierId
    ? await supabase
        .from("carriers")
        .select("id, company_name, agreement_signed_at, active, insurance_expiry")
        .eq("id", carrierId)
        .maybeSingle()
    : { data: null };

  if (!carrier) {
    return (
      <main id="main">
        <div className="pbar">
          <div>
            <span className="crumb">{tv("Carrier portal")}</span>
            <h1>{tv("My Documents")}</h1>
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

  const { data: docs } = await supabase
    .from("documents")
    .select("id, type, file_name, status, review_note, created_at")
    .eq("carrier_id", carrier.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const documents: CarrierDocRow[] = docs ?? [];

  const pendingCount = documents.filter((d) => d.status === "pending").length;
  const signed = carrier.agreement_signed_at !== null;

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">
            {tv("Carrier portal")} / {carrier.company_name}
          </span>
          <h1>{tv("My Documents")}</h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {carrier.active ? (
            <span className="pbadge green">{tv("Active carrier")}</span>
          ) : (
            <span className="pbadge amber">{tv("Onboarding in progress")}</span>
          )}
        </div>
      </div>

      <div className="ptiles">
        <div className={`ptile ${signed ? "good" : ""}`}>
          <b>{signed ? "✓" : "…"}</b>
          <span>{tv("Dispatch agreement")}</span>
          <span className="sub">
            {signed
              ? `${tv("Signed")} ${new Date(carrier.agreement_signed_at ?? "").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
              : tv("Awaiting signature — check your email, or call us")}
          </span>
        </div>
        <div className={`ptile ${pendingCount > 0 ? "" : "good"}`}>
          <b>{pendingCount}</b>
          <span>{tv("Documents in review")}</span>
          <span className="sub">{tv("Typically reviewed within one business day")}</span>
        </div>
        <div className="ptile">
          <b>{carrier.insurance_expiry ?? "—"}</b>
          <span>{tv("Insurance expiry")}</span>
        </div>
      </div>

      <CarrierDocs carrierId={carrier.id} documents={documents} />
    </main>
  );
}
