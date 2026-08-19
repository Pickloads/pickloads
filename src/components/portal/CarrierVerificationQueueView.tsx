import { Link } from "@/i18n/navigation";
import { LegacyCarrierAdoptForm } from "@/components/portal/LegacyCarrierAdoptForm";
import {
  DECISION_BADGE,
  VERIFICATION_BADGE,
  reasonCodeLabel,
  sortReasonCodes,
} from "@/lib/carrier-authority/review-labels";

/**
 * M-99 — the manual-review queue, presentationally.
 *
 * Split out of the async page for the same reason as the detail view: markup
 * inside a Server Component cannot be rendered in jsdom, so none of it could
 * be measured. See `CarrierVerificationDetailView` for the full note.
 *
 * ── WHAT CHANGED ─────────────────────────────────────────────────────────
 *
 * The columns and the data are identical. The table keeps `.ptable` — it IS
 * tabular here, which is exactly where `.ptable` belongs — and gains the
 * `.stacked` / `.wrap` cell modifiers so a company name over an email address
 * gets top alignment and its own leading instead of colliding with the row
 * divider. The legacy section moved out of a `.ptable-wrap` (a scroller with
 * no padding) into a `.pcard`, and every explanatory paragraph is `.phelp`
 * rather than `.pempty`, which is a 26px empty-state box.
 */

export interface QueueRow {
  id: string;
  createdAt: string;
  legalNameEntered: string;
  usdotNumberEntered: string;
  mcNumberEntered: string | null;
  email: string;
  decision: string | null;
  verificationStatus: string;
  reasonCodes: string[];
  expiresAt: string;
  claimedCarrierId: string | null;
}

export interface LegacyRow {
  id: string;
  companyName: string;
  mcNumber: string | null;
  dotNumber: string | null;
  createdAt: string;
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function CarrierVerificationQueueView({
  rows,
  legacy,
  showAll,
  failed,
  now = Date.now(),
}: {
  rows: readonly QueueRow[];
  legacy: readonly LegacyRow[];
  showAll: boolean;
  failed: boolean;
  /** Injected so a fixture renders identically on every run. */
  now?: number;
}) {
  return (
    <>
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk / Carrier verifications</span>
          <h1>{showAll ? "All carrier applications" : "Awaiting review"}</h1>
        </div>
        {/* Controls, not status — `.pbadges` is for badges. */}
        <div className="pbar-actions">
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

      {failed ? (
        <div className="pcard">
          <p className="phelp" role="alert">
            The verification queue could not be read. Nothing has been lost —
            refresh, and if it persists this is a database issue, not an empty
            queue.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="pcard">
          <p className="phelp">
            {showAll
              ? "No carrier applications yet."
              : "Nothing awaiting review. Applications the engine could not decide alone appear here."}
          </p>
        </div>
      ) : (
        <div className="ptable-wrap">
          <table className="ptable">
            <thead>
              <tr>
                <th scope="col">Submitted</th>
                <th scope="col">Applicant</th>
                <th scope="col">USDOT / MC</th>
                <th scope="col">FMCSA</th>
                <th scope="col">Decision</th>
                <th scope="col">Why it is here</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const decision = DECISION_BADGE[r.decision ?? ""] ?? {
                  label: "Pending",
                  badge: "",
                };
                const fmcsa = VERIFICATION_BADGE[r.verificationStatus] ?? {
                  label: r.verificationStatus,
                  badge: "",
                };
                const expired = new Date(r.expiresAt).getTime() <= now;
                const top = sortReasonCodes([...r.reasonCodes]).slice(0, 2);
                return (
                  <tr key={r.id}>
                    <td className="stacked nw">
                      {shortDate(r.createdAt)}
                      {expired ? (
                        <span className="tsub">
                          <span className="pbadge red">Expired</span>
                        </span>
                      ) : null}
                    </td>
                    <td className="stacked wrap">
                      {r.legalNameEntered}
                      <span className="tsub">{r.email}</span>
                    </td>
                    <td className="stacked nw">
                      <span className="mono">{r.usdotNumberEntered}</span>
                      <span className="tsub">
                        {r.mcNumberEntered
                          ? `MC-${r.mcNumberEntered}`
                          : "no MC submitted"}
                      </span>
                    </td>
                    <td className="stacked">
                      <span className={`pbadge ${fmcsa.badge}`}>
                        {fmcsa.label}
                      </span>
                    </td>
                    <td className="stacked">
                      <span className={`pbadge ${decision.badge}`}>
                        {decision.label}
                      </span>
                      {r.claimedCarrierId ? (
                        <span className="tsub">onboarded</span>
                      ) : null}
                    </td>
                    <td className="stacked wrap">
                      {top.length === 0
                        ? "—"
                        : top.map((c) => (
                            <span key={c} className="treason">
                              {reasonCodeLabel(c)}
                            </span>
                          ))}
                    </td>
                    <td className="stacked nw">
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

      <p className="phelp">
        Clearing an application lets the carrier continue to the verification
        fee and document upload. It is <b>not</b> approval and it does not
        activate anything — activation still requires the documents, the
        agreement, the fee and the compliance checks in full.
      </p>

      {legacy.length > 0 ? (
        <div className="pcard pgap">
          <h2>Applications that predate verification ({legacy.length})</h2>
          <p className="phelp">
            Unfinished applications from before the FMCSA gate existed. They
            cannot create a portal account until they have been verified. A
            carrier who <b>already has an account</b> is not affected and is not
            listed here.
          </p>
          <div className="ptable-wrap pgap-sm">
            <table className="ptable">
              <thead>
                <tr>
                  <th scope="col">Started</th>
                  <th scope="col">Company</th>
                  <th scope="col">USDOT / MC on file</th>
                  <th scope="col">Run the check</th>
                </tr>
              </thead>
              <tbody>
                {legacy.map((c) => (
                  <tr key={c.id}>
                    <td className="stacked nw">
                      {new Date(c.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="stacked wrap">{c.companyName}</td>
                    <td className="stacked">
                      <span className="mono">
                        {c.dotNumber ?? "no USDOT on file"}
                      </span>
                      <span className="tsub">
                        {c.mcNumber ? `MC-${c.mcNumber}` : "no MC on file"}
                      </span>
                    </td>
                    <td className="stacked">
                      <LegacyCarrierAdoptForm
                        carrierId={c.id}
                        needsUsdot={!c.dotNumber}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </>
  );
}
