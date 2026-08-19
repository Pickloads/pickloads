import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CarrierReviewForm } from "@/components/portal/CarrierReviewForm";
import {
  DECISION_BADGE,
  VERIFICATION_BADGE,
  matchLabel,
  reasonCodeLabel,
  sortReasonCodes,
  triStateLabel,
} from "@/lib/carrier-authority/review-labels";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Carrier verification — PickLoads",
  robots: { index: false, follow: false },
};

/**
 * M-94 — one application, with the evidence behind its decision.
 *
 * ── WHAT A REVIEWER IS SHOWN ─────────────────────────────────────────────
 *
 * Three things, side by side, because the decision is a comparison:
 *
 *   1. what the applicant TYPED — never overwritten, which is the whole
 *      reason 0032 stores it separately;
 *   2. what FMCSA RETURNED, normalized — legal name, authority, out-of-service
 *      and the per-field match results;
 *   3. what the ENGINE concluded, as reason codes with plain-English labels.
 *
 * ── AND WHAT IS NOT HERE ─────────────────────────────────────────────────
 *
 * No raw FMCSA payload — it is never stored, only a SHA-256 digest is, and the
 * digest is shown truncated as provenance ("these two checks saw the same
 * upstream record") rather than as data. No EIN and no physical address: both
 * are in the live FMCSA response and both are dropped at the adapter boundary,
 * so there is no column here that could render them. No WebKey, which exists
 * only in `process.env` inside a `server-only` module.
 *
 * No insurance filing is shown as a compliance signal. FMCSA's bipd/cargo/bond
 * indicators are normalized by M-93 and deliberately not persisted, because a
 * federal filing beside a COI status invites exactly the merge §10 forbids.
 */
export default async function CarrierVerificationDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  await requireStaff(locale);

  const supabase = await createClient();

  const { data: pre } = await supabase
    .from("carrier_pre_registrations")
    .select(
      "id, created_at, updated_at, expires_at, legal_name_entered, usdot_number_entered, mc_number_entered, email, phone, locale, decision, verification_status, risk_tier, manual_review_required, reason_codes, payment_status, claimed_carrier_id, claimed_at, reviewed_by, reviewed_at, review_note",
    )
    .eq("id", id)
    .maybeSingle();

  if (!pre) notFound();

  const { data: checks } = await supabase
    .from("carrier_verifications")
    .select(
      "id, provider, provider_record_id, status, legal_name, dba_name, usdot_number, mc_number, allowed_to_operate, out_of_service, out_of_service_date, name_match, mc_match, dot_match, raw_response_sha256, checked_at, source_retrieved_at",
    )
    .eq("pre_registration_id", id)
    .order("checked_at", { ascending: false })
    .limit(5);

  const latest = checks?.[0] ?? null;

  const { data: reviewer } = pre.reviewed_by
    ? await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", pre.reviewed_by)
        .maybeSingle()
    : { data: null };

  const decision = DECISION_BADGE[pre.decision ?? ""] ?? {
    label: "Pending",
    badge: "",
  };
  const fmcsa = VERIFICATION_BADGE[pre.verification_status] ?? {
    label: pre.verification_status,
    badge: "",
  };
  const expired = new Date(pre.expires_at).getTime() <= Date.now();
  const open = pre.decision === "manual_review" && !pre.claimed_carrier_id;

  const row = (label: string, value: React.ReactNode) => (
    <tr>
      <th
        scope="row"
        style={{ textAlign: "left", whiteSpace: "nowrap", paddingRight: 18 }}
      >
        {label}
      </th>
      <td>{value}</td>
    </tr>
  );

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">
            <Link href="/portal/admin/carrier-verifications">
              DISPATCH / CARRIER VERIFICATIONS
            </Link>
          </span>
          <h1>{pre.legal_name_entered}</h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className={`pbadge ${fmcsa.badge}`}>{fmcsa.label}</span>
          <span className={`pbadge ${decision.badge}`}>{decision.label}</span>
          {expired ? <span className="pbadge red">Expired</span> : null}
        </div>
      </div>

      <div className="ptable-wrap">
        <h2 className="sec" style={{ fontSize: "1rem" }}>
          What the applicant submitted
        </h2>
        <table className="ptable">
          <tbody>
            {row("Legal company name", pre.legal_name_entered)}
            {row("USDOT", <span className="mono">{pre.usdot_number_entered}</span>)}
            {row(
              "MC",
              pre.mc_number_entered ? (
                <span className="mono">MC-{pre.mc_number_entered}</span>
              ) : (
                <em>none submitted — legitimate for intrastate/exempt</em>
              ),
            )}
            {row("Email", pre.email)}
            {row("Phone", pre.phone ?? "—")}
            {row("Submitted", new Date(pre.created_at).toLocaleString("en-US"))}
            {row(
              "Expires",
              `${new Date(pre.expires_at).toLocaleString("en-US")}${expired ? " (expired)" : ""}`,
            )}
          </tbody>
        </table>
      </div>

      <div className="ptable-wrap">
        <h2 className="sec" style={{ fontSize: "1rem" }}>
          What FMCSA returned
        </h2>
        {latest === null ? (
          <p className="pempty">
            No authority check is recorded against this application. That
            happens when the pre-check could not reach the provider before the
            record was written — treat it as unverified, not as a finding.
          </p>
        ) : (
          <table className="ptable">
            <tbody>
              {row("Legal name on record", latest.legal_name ?? "Not reported")}
              {row("DBA", latest.dba_name ?? "—")}
              {row(
                "USDOT on record",
                <span className="mono">{latest.usdot_number ?? "—"}</span>,
              )}
              {row(
                "MC on record",
                <span className="mono">{latest.mc_number ?? "—"}</span>,
              )}
              {row("Allowed to operate", triStateLabel(latest.allowed_to_operate))}
              {row(
                "Out of service",
                `${triStateLabel(latest.out_of_service)}${latest.out_of_service_date ? ` (${latest.out_of_service_date})` : ""}`,
              )}
              {row("Name match", matchLabel(latest.name_match))}
              {row("USDOT match", matchLabel(latest.dot_match))}
              {row("MC field match", matchLabel(latest.mc_match))}
              {row("Checked", new Date(latest.checked_at).toLocaleString("en-US"))}
              {row(
                "Source freshness",
                latest.source_retrieved_at
                  ? new Date(latest.source_retrieved_at).toLocaleString("en-US")
                  : "Not reported",
              )}
              {row(
                "Response digest",
                <span className="mono" style={{ fontSize: ".7rem" }}>
                  {latest.raw_response_sha256
                    ? `${latest.raw_response_sha256.slice(0, 12)}… (SHA-256; the payload itself is never stored)`
                    : "—"}
                </span>,
              )}
            </tbody>
          </table>
        )}
        <p className="pempty" style={{ paddingLeft: 0 }}>
          An FMCSA insurance filing is <b>not</b> shown here and is never read
          as compliance. PickLoads insurance requirements are judged from the
          uploaded COI and the expiry on the carrier record, separately.
        </p>
      </div>

      <div className="ptable-wrap">
        <h2 className="sec" style={{ fontSize: "1rem" }}>
          Why the engine decided this
        </h2>
        <table className="ptable">
          <tbody>
            {row("Risk tier", pre.risk_tier ?? "—")}
            {row("Payment", pre.payment_status)}
            {row(
              "Onboarded",
              pre.claimed_carrier_id
                ? `Yes — carrier account created ${pre.claimed_at ? new Date(pre.claimed_at).toLocaleString("en-US") : ""}`
                : "No carrier account exists for this application",
            )}
          </tbody>
        </table>
        <ul style={{ margin: "14px 0 0", paddingLeft: 20 }}>
          {sortReasonCodes(pre.reason_codes).map((code) => (
            <li key={code} style={{ padding: "3px 0" }}>
              {reasonCodeLabel(code)}
              <span
                className="mono"
                style={{
                  fontSize: ".62rem",
                  color: "var(--color-steel)",
                  marginLeft: 8,
                }}
              >
                {code}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {pre.reviewed_at ? (
        <div className="ptable-wrap">
          <h2 className="sec" style={{ fontSize: "1rem" }}>
            Staff review
          </h2>
          <table className="ptable">
            <tbody>
              {row("Reviewed by", reviewer?.full_name ?? "Staff")}
              {row(
                "Reviewed at",
                new Date(pre.reviewed_at).toLocaleString("en-US"),
              )}
              {row("Note", pre.review_note ?? "—")}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="ptable-wrap">
        <h2 className="sec" style={{ fontSize: "1rem" }}>
          Decision
        </h2>
        {open ? (
          <>
            <p className="pempty" style={{ paddingLeft: 0 }}>
              Clearing this application lets the carrier continue to the
              verification fee and document upload. It does <b>not</b> approve
              them, does <b>not</b> activate an account, and does <b>not</b>{" "}
              change what FMCSA said — the activation requirements are
              evaluated separately and in full, later.
            </p>
            <CarrierReviewForm preRegistrationId={pre.id} />
          </>
        ) : (
          <p className="pempty" style={{ paddingLeft: 0 }}>
            {pre.claimed_carrier_id
              ? "This application has already been used to create a carrier account and can no longer be re-decided."
              : "This application is not awaiting review."}
          </p>
        )}
      </div>
    </main>
  );
}
