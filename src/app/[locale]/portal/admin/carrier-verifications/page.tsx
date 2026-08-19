import type { Metadata } from "next";

import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LegacyCarrierAdoptForm } from "@/components/portal/LegacyCarrierAdoptForm";
import {
  DECISION_BADGE,
  VERIFICATION_BADGE,
  reasonCodeLabel,
  sortReasonCodes,
} from "@/lib/carrier-authority/review-labels";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Carrier verifications — PickLoads",
  robots: { index: false, follow: false },
};

/**
 * M-94 — the manual-review queue.
 *
 * ── WHY THIS PAGE EXISTS ─────────────────────────────────────────────────
 *
 * M-94 shipped the gate without it, and that left a real hole: MANUAL_REVIEW
 * is where the engine puts every case it refuses to decide alone — an FMCSA
 * timeout, a docket endpoint that was down, a legal name that differs by more
 * than punctuation — and most of those applicants are legitimate carriers. A
 * queue nobody can see is a queue nobody works, and the applicant is left
 * holding a screen that says "we'll come back to you" while nothing brings
 * them to anyone's attention.
 *
 * ── WHAT IT READS, AND WHAT IT REFUSES TO READ ───────────────────────────
 *
 * The `select` below is the enumeration of what a reviewer operationally
 * needs: what the applicant typed, when, what the engine decided, and how to
 * reach them. It does NOT select — and the tables do not carry —
 * `raw_response`, an EIN, a physical address, an insurance filing or the
 * FMCSA WebKey. The digest is available on the detail page as provenance and
 * is not a payload.
 *
 * ── THE READ IS COOKIE-BOUND, NOT SERVICE-ROLE ───────────────────────────
 *
 * So RLS enforces the staff check a second time, at the database, under
 * 0032's `staff manage pre registrations` policy. `requireStaff` above is the
 * gate; the policy is what makes a hole in the gate not a hole in the system.
 * §18 of the RLS suite proves no browser role but staff can read these rows at
 * all — a carrier cannot even read the pre-registration bound to its own
 * carrier row.
 */
export default async function CarrierVerificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const { locale } = await params;
  await requireStaff(locale);
  const { show } = await searchParams;
  const showAll = show === "all";

  const supabase = await createClient();
  let query = supabase
    .from("carrier_pre_registrations")
    .select(
      "id, created_at, legal_name_entered, usdot_number_entered, mc_number_entered, email, decision, verification_status, risk_tier, reason_codes, expires_at, claimed_carrier_id, reviewed_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  // The default view is the WORK: open manual reviews that nobody has spent.
  // "All" exists because a reviewer needs to look up what they decided last
  // week, not because the queue should show resolved rows by default.
  if (!showAll) {
    query = query.eq("decision", "manual_review").is("claimed_carrier_id", null);
  }

  const { data, error } = await query;
  const rows = data ?? [];
  const now = Date.now();

  /* ── Pre-M-94 applications that cannot finish ──────────────────────────
   *
   * Unclaimed `carriers` rows (no auth user) with no pre-registration bound to
   * them. Two queries and a filter rather than a join, because PostgREST has
   * no left-anti-join and the alternative — an RPC — would be a database
   * function to answer a question that disappears once the backlog is worked.
   *
   * `profile_id is null` is the whole of the affected set. A carrier who
   * already has an account is refused by `completeOnboarding` for an older
   * reason ("sign in instead") and nothing else in the product reads a
   * pre-registration, so they are not listed and are not affected.
   */
  const { data: unclaimed } = await supabase
    .from("carriers")
    .select("id, company_name, mc_number, dot_number, created_at")
    .is("profile_id", null)
    .order("created_at", { ascending: false })
    .limit(50);

  const candidateIds = (unclaimed ?? []).map((c) => c.id);
  const { data: bound } = candidateIds.length
    ? await supabase
        .from("carrier_pre_registrations")
        .select("claimed_carrier_id")
        .in("claimed_carrier_id", candidateIds)
    : { data: [] };
  const boundIds = new Set(
    (bound ?? []).map((b) => b.claimed_carrier_id).filter(Boolean),
  );
  const legacy = (unclaimed ?? []).filter((c) => !boundIds.has(c.id));

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">DISPATCH / CARRIER VERIFICATIONS</span>
          <h1>{showAll ? "All carrier applications" : "Awaiting review"}</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link
            className={`btn btn-ghost btn-sm${showAll ? "" : " active"}`}
            href="/portal/admin/carrier-verifications"
          >
            Awaiting review
          </Link>
          <Link
            className={`btn btn-ghost btn-sm${showAll ? " active" : ""}`}
            href="/portal/admin/carrier-verifications?show=all"
          >
            All
          </Link>
        </div>
      </div>

      {error ? (
        // Never an empty table on a failed read: "no carriers are waiting" and
        // "we could not ask" look identical to a reviewer and only one of them
        // means they can go home.
        <p className="pempty" role="alert">
          The verification queue could not be read. Nothing has been lost —
          refresh, and if it persists this is a database issue, not an empty
          queue.
        </p>
      ) : rows.length === 0 ? (
        <p className="pempty">
          {showAll
            ? "No carrier applications yet."
            : "Nothing awaiting review. Applications the engine could not decide alone appear here."}
        </p>
      ) : (
        <div className="ptable-wrap">
          <table className="ptable">
            <thead>
              <tr>
                <th>Submitted</th>
                <th>Applicant</th>
                <th>USDOT / MC</th>
                <th>FMCSA</th>
                <th>Decision</th>
                <th>Why it is here</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const decision = DECISION_BADGE[r.decision ?? ""] ?? {
                  label: "Pending",
                  badge: "",
                };
                const fmcsa = VERIFICATION_BADGE[r.verification_status] ?? {
                  label: r.verification_status,
                  badge: "",
                };
                const expired = new Date(r.expires_at).getTime() <= now;
                const top = sortReasonCodes(r.reason_codes).slice(0, 2);
                return (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {new Date(r.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                      {expired ? (
                        <span
                          className="pbadge red"
                          style={{ display: "block", marginTop: 4 }}
                        >
                          Expired
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {r.legal_name_entered}
                      <span
                        className="mono"
                        style={{
                          display: "block",
                          fontSize: ".62rem",
                          color: "var(--color-steel)",
                        }}
                      >
                        {r.email}
                      </span>
                    </td>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>
                      {r.usdot_number_entered}
                      <span
                        style={{
                          display: "block",
                          fontSize: ".62rem",
                          color: "var(--color-steel)",
                        }}
                      >
                        {r.mc_number_entered
                          ? `MC-${r.mc_number_entered}`
                          : "no MC submitted"}
                      </span>
                    </td>
                    <td>
                      <span className={`pbadge ${fmcsa.badge}`}>
                        {fmcsa.label}
                      </span>
                    </td>
                    <td>
                      <span className={`pbadge ${decision.badge}`}>
                        {decision.label}
                      </span>
                      {r.claimed_carrier_id ? (
                        <span
                          className="mono"
                          style={{
                            display: "block",
                            fontSize: ".62rem",
                            color: "var(--color-steel)",
                            marginTop: 4,
                          }}
                        >
                          onboarded
                        </span>
                      ) : null}
                    </td>
                    <td style={{ fontSize: ".82rem" }}>
                      {top.length === 0
                        ? "—"
                        : top.map((c) => (
                            <span key={c} style={{ display: "block" }}>
                              {reasonCodeLabel(c)}
                            </span>
                          ))}
                    </td>
                    <td>
                      <Link
                        className="btn btn-ghost btn-sm"
                        href={`/portal/admin/carrier-verifications/${r.id}`}
                      >
                        Review →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="pempty" style={{ paddingLeft: 0 }}>
        Clearing an application lets the carrier continue to the verification
        fee and document upload. It is <b>not</b> approval and it does not
        activate anything — activation still requires the documents, the
        agreement, the fee and the compliance checks in full.
      </p>

      {/* ── Pre-M-94 applications ───────────────────────────────────────────
          These `carriers` rows were created by the old flow, which made one
          the moment somebody typed a company name. They have no verification
          bound to them, so `completeOnboarding` refuses them — correctly, and
          through no fault of the applicant, who applied before the rule
          existed.

          The button runs the SAME pre-check a new applicant runs. It is not an
          exemption: an application that fails still fails, and one the engine
          cannot decide alone lands in the queue above like any other. */}
      {legacy.length > 0 ? (
        <div className="ptable-wrap" style={{ marginTop: 28 }}>
          <h2 className="sec" style={{ fontSize: "1rem" }}>
            Applications that predate verification ({legacy.length})
          </h2>
          <p className="pempty" style={{ paddingLeft: 0 }}>
            Unfinished applications from before the FMCSA gate existed. They
            cannot create a portal account until they have been verified. A
            carrier who <em>already has an account</em> is not affected and is
            not listed here.
          </p>
          <table className="ptable">
            <thead>
              <tr>
                <th>Started</th>
                <th>Company</th>
                <th>USDOT / MC on file</th>
                <th>Run the check</th>
              </tr>
            </thead>
            <tbody>
              {legacy.map((c) => (
                <tr key={c.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {new Date(c.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </td>
                  <td>{c.company_name}</td>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>
                    {c.dot_number ?? (
                      <span style={{ color: "var(--color-amber-aa)" }}>
                        no USDOT on file
                      </span>
                    )}
                    <span
                      style={{
                        display: "block",
                        fontSize: ".62rem",
                        color: "var(--color-steel)",
                      }}
                    >
                      {c.mc_number ? `MC-${c.mc_number}` : "no MC on file"}
                    </span>
                  </td>
                  <td>
                    <LegacyCarrierAdoptForm
                      carrierId={c.id}
                      needsUsdot={!c.dot_number}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
