import type { Metadata } from "next";
import { requireCarrier } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyCarrierId } from "@/lib/memberships";
import { getV4 } from "@/i18n/v4-server";
import { DocumentDownloadButton } from "@/components/portal/DocumentDownloadButton";
import { AgreementResendButton } from "@/components/portal/AgreementResendButton";
import { AgreementSendButton } from "@/components/portal/AgreementSendButton";
import {
  STATUS_LABEL,
  STATUS_TONE,
  type DisplayStatus,
} from "@/lib/agreements/status";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Agreements — PickLoads Carrier Portal",
  robots: { index: false, follow: false },
};

/**
 * M-55 — agreements page from AVAILABLE data (honest-states rule): the
 * signed date comes from carriers.agreement_signed_at (M-22 webhook stamps
 * it), executed copies are `dispatch_agreement` documents (≤5-min signed-URL
 * download), and the re-send action reuses the M-22 e-sign flow. Sent/viewed
 * timestamps aren't stored anywhere today — the page says so instead of
 * inventing them.
 */
export default async function CarrierAgreementsPage({
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
            <h1>{tv("Agreements")}</h1>
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

  const [{ data: carrier }, { data: agreementDocs }, { data: request }] =
    await Promise.all([
      supabase
        .from("carriers")
        .select("id, company_name, agreement_signed_at, dispatch_fee_pct")
        .eq("id", carrierId)
        .maybeSingle(),
      supabase
        .from("documents")
        .select("id, file_name, status, created_at")
        .eq("carrier_id", carrierId)
        .eq("type", "dispatch_agreement")
        .order("created_at", { ascending: false })
        .limit(20),
      // M-92: the live SignWell lifecycle. Read through the SESSION client, so
      // the "member read own signature requests" policy is what authorises it
      // — a stolen carrier id in the URL reaches nothing.
      supabase
        .from("signature_requests")
        .select(
          "status, sent_at, viewed_at, carrier_signed_at, completed_at, test_mode",
        )
        .eq("carrier_id", carrierId)
        .eq("agreement_type", "dispatch_agreement")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const signed = carrier?.agreement_signed_at ?? null;
  const executedCopies = agreementDocs ?? [];

  // No row means not sent. The absence IS the state — see lib/agreements/status.
  const displayStatus: DisplayStatus = request?.status ?? "not_sent";
  const statusTone = STATUS_TONE[displayStatus];

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">
            {tv("Carrier portal")}
            {carrier ? ` / ${carrier.company_name}` : ""}
          </span>
          <h1>{tv("Agreements")}</h1>
        </div>
      </div>

      <div className="pgrid2">
        <div className="pcard">
          <h2>{tv("Dispatch service agreement")}</h2>
          <ul className="timeline">
            <li className="tl">
              <span className="tlt">
                {tv("Signature request")}{" "}
                <span className={`pbadge${statusTone ? ` ${statusTone}` : ""}`}>
                  {tv(STATUS_LABEL[displayStatus])}
                </span>
                {request?.test_mode ? (
                  // A test-mode document is NOT legally executed. Saying so is
                  // not optional while test_mode is on.
                  <span className="pbadge" style={{ marginLeft: 6 }}>
                    {tv("Test mode")}
                  </span>
                ) : null}
              </span>
              <p>
                {displayStatus === "not_sent"
                  ? tv(
                      "No signature request has gone out yet. Use the button below, or call (908) 404-5373.",
                    )
                  : tv(
                      "Sent by email — check your inbox (and spam). This status updates automatically as the document is viewed and signed.",
                    )}
              </p>
            </li>
            <li className="tl">
              <span className="tlt">
                {signed ? (
                  <span className="pbadge green">✓ {tv("Signed")}</span>
                ) : (
                  <span className="pbadge amber">
                    {tv("Awaiting signature")}
                  </span>
                )}
              </span>
              <p>
                {signed
                  ? `${tv("Signed")} ${new Date(signed).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
                  : tv("Awaiting signature — check your email, or call us")}
              </p>
            </li>
          </ul>
          {carrier ? (
            <p
              className="mono"
              style={{
                fontSize: ".72rem",
                color: "var(--steel)",
                marginTop: 8,
              }}
            >
              {"// "}
              {tv("Your rate")}: {carrier.dispatch_fee_pct}%{" "}
              {tv("of gross per load")} —{" "}
              {tv("snapshotted per load at booking, never retroactive.")}
            </p>
          ) : null}
          {!signed ? (
            <div style={{ marginTop: 14 }}>
              {/*
                M-92: one control, chosen by state. Nothing sent yet → the
                SignWell send action. A request already in flight → the
                existing re-send. Showing both at once would offer a carrier
                two buttons that do almost the same thing and let them start a
                second agreement while the first is open.
              */}
              {displayStatus === "not_sent" ? (
                <AgreementSendButton />
              ) : (
                <AgreementResendButton />
              )}
            </div>
          ) : null}
        </div>

        <div className="pcard">
          <h2>{tv("Executed copies")}</h2>
          {executedCopies.length === 0 ? (
            <p className="pempty" style={{ padding: 0 }}>
              {signed
                ? tv(
                    "Your signed copy hasn't been filed here yet — it's in your signature-request email, or ask support and we'll upload it.",
                  )
                : tv(
                    "Your signed agreement appears here for download once it's executed.",
                  )}
            </p>
          ) : (
            <table className="ptable">
              <thead>
                <tr>
                  <th>{tv("File")}</th>
                  <th>{tv("Uploaded")}</th>
                  <th>{tv("Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {executedCopies.map((d) => (
                  <tr key={d.id}>
                    <td>{d.file_name ?? tv("Dispatch Agreement")}</td>
                    <td>
                      {new Date(d.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td>
                      <DocumentDownloadButton documentId={d.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
