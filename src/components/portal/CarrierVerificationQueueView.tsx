import { Link } from "@/i18n/navigation";
import { LegacyCarrierAdoptForm } from "@/components/portal/LegacyCarrierAdoptForm";
import { ScrollRegion } from "@/components/portal/ScrollRegion";
import {
  AdminCardShell,
  AdminPage,
  AdminPageHeader,
  EmptyState,
  InfoCallout,
  StatusBadge,
  type Tone,
} from "@/components/portal/admin-ui";
import {
  DECISION_BADGE,
  VERIFICATION_BADGE,
  reasonCodeLabel,
  sortReasonCodes,
} from "@/lib/carrier-authority/review-labels";

/**
 * M-100 — the manual-review queue, on the admin design system.
 *
 * This one keeps its table, because it IS tabular: the same seven facts about
 * many applications. What changed is everything around it — the page header
 * gained a description, the table moved into a card, the badges come from the
 * one badge system, and rows pick up a hover so a wide table stays scannable.
 *
 * The columns, the filters, the ordering and the data are unchanged.
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

const TONE_OF: Readonly<Record<string, Tone>> = {
  green: "success",
  amber: "warning",
  red: "danger",
};
const toneOf = (badge: string): Tone => TONE_OF[badge] ?? "neutral";

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
    <AdminPage>
      <AdminPageHeader
        crumb="Dispatch desk / Carrier verifications"
        title={showAll ? "All carrier applications" : "Awaiting review"}
        description="Applications the verification engine could not decide on its own. Clearing one lets the carrier continue to the fee and document upload — it is not approval, and it activates nothing."
        actions={
          <>
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
          </>
        }
      />

      <AdminCardShell title={showAll ? "All applications" : "Review queue"}>
        {failed ? (
          <div role="alert">
            <EmptyState title="The verification queue could not be read">
              Nothing has been lost — refresh, and if it persists this is a
              database issue, not an empty queue.
            </EmptyState>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={
              showAll ? "No carrier applications yet" : "Nothing awaiting review"
            }
          >
            {showAll
              ? "Applications appear here as carriers submit them."
              : "Applications the engine could not decide alone appear here."}
          </EmptyState>
        ) : (
          <ScrollRegion label="Carrier applications awaiting review">
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
                            <StatusBadge tone="danger">Expired</StatusBadge>
                          </span>
                        ) : null}
                      </td>
                      <td className="stacked wrap is-wide">
                        {r.legalNameEntered}
                        <span className="tsub">{r.email}</span>
                      </td>
                      <td className="stacked nw">
                        <span className="tid">{r.usdotNumberEntered}</span>
                        <span className="tsub">
                          {r.mcNumberEntered
                            ? `MC-${r.mcNumberEntered}`
                            : "no MC submitted"}
                        </span>
                      </td>
                      <td className="stacked">
                        <StatusBadge tone={toneOf(fmcsa.badge)}>
                          {fmcsa.label}
                        </StatusBadge>
                      </td>
                      <td className="stacked">
                        <StatusBadge tone={toneOf(decision.badge)}>
                          {decision.label}
                        </StatusBadge>
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
          </ScrollRegion>
        )}
      </AdminCardShell>

      {legacy.length > 0 ? (
        <div className="a-stack">
          <AdminCardShell
            title={`Applications that predate verification (${legacy.length})`}
          >
            <InfoCallout inset>
              Unfinished applications from before the FMCSA gate existed. They
              cannot create a portal account until they have been verified. A
              carrier who <b>already has an account</b> is not affected and is
              not listed here.
            </InfoCallout>
            <ScrollRegion label="Applications that predate verification">
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
                      <td className="stacked wrap is-wide">{c.companyName}</td>
                      <td className="stacked">
                        <span className="tid">
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
            </ScrollRegion>
          </AdminCardShell>
        </div>
      ) : null}
    </AdminPage>
  );
}
