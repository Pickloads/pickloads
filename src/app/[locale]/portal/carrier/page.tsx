import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { requireProfile, portalHomeFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getV4 } from "@/i18n/v4-server";
import {
  CarrierDocs,
  type CarrierDocRow,
} from "@/components/portal/CarrierDocs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My Documents — PickLoads Carrier Portal",
  robots: { index: false, follow: false },
};

/**
 * M-25 — carrier portal v1: my documents + agreement status. Every read is
 * RLS-scoped through the cookie-bound server client ("carrier own record" /
 * "carrier own docs read") — no carrier id comes from the request.
 */
export default async function CarrierPortalPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireProfile(locale);
  if (session.role !== "carrier") {
    redirect(getPathname({ href: portalHomeFor(session.role), locale }));
  }
  const tv = await getV4(locale);
  const supabase = await createClient();

  const { data: carrier } = await supabase
    .from("carriers")
    .select(
      "id, company_name, agreement_signed_at, active, insurance_expiry",
    )
    .eq("profile_id", session.userId)
    .maybeSingle();

  if (!carrier) {
    return (
      <main>
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
    <main>
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
          <span className="sub">
            {tv("Reviewed within one business day")}
          </span>
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
