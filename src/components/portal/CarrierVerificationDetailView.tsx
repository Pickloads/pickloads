import { Link } from "@/i18n/navigation";
import { CarrierReviewForm } from "@/components/portal/CarrierReviewForm";
import {
  DECISION_BADGE,
  VERIFICATION_BADGE,
  isNotableReason,
  matchLabel,
  reasonCodeLabel,
  sortReasonCodes,
  triStateLabel,
} from "@/lib/carrier-authority/review-labels";

/**
 * M-99 — one carrier application, presentationally.
 *
 * ── WHY THIS IS A COMPONENT AND NOT MARKUP IN THE PAGE ───────────────────
 *
 * The page is an async Server Component, which cannot be rendered in jsdom —
 * so as long as the markup lived there, none of it could be measured. This is
 * the same split M-74/M-81 use (`BrokerShipmentDetailView` and friends): the
 * page fetches, the View renders, and `tests/unit/admin-verifications-a11y.
 * test.tsx` renders the View into the browser harness so
 * `tests/e2e/admin-responsive-a11y.spec.ts` can measure it at twelve widths
 * behind the real compiled stylesheet.
 *
 * No data logic moved with it. Every value arrives as a prop, already read and
 * already decided by the page.
 *
 * ── WHAT CHANGED VISUALLY ────────────────────────────────────────────────
 *
 * The information is identical, field for field. What changed is the
 * vocabulary carrying it: `.pcard` instead of `.ptable-wrap` (which is a table
 * scroller with no padding, so headings sat on its border), `.pdl` instead of
 * `.ptable` (dividers between rows rather than through wrapped text), `.psub`
 * instead of `h2.sec` (a marketing display heading at up to 2.7rem), and the
 * shared `.pbadges` / `.pactions` / `.phelp` rows instead of per-call-site
 * inline styles.
 */

export interface VerificationDetail {
  id: string;
  createdAt: string;
  expiresAt: string;
  legalNameEntered: string;
  usdotNumberEntered: string;
  mcNumberEntered: string | null;
  email: string;
  phone: string | null;
  decision: string | null;
  verificationStatus: string;
  riskTier: string | null;
  reasonCodes: string[];
  paymentStatus: string;
  claimedCarrierId: string | null;
  claimedAt: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  reviewerName: string | null;
}

export interface VerificationCheck {
  legalName: string | null;
  dbaName: string | null;
  usdotNumber: string | null;
  mcNumber: string | null;
  allowedToOperate: boolean | null;
  outOfService: boolean | null;
  outOfServiceDate: string | null;
  nameMatch: string | null;
  mcMatch: string | null;
  dotMatch: string | null;
  rawResponseSha256: string | null;
  checkedAt: string;
  sourceRetrievedAt: string | null;
}

const dateTime = (iso: string) => new Date(iso).toLocaleString("en-US");

export function CarrierVerificationDetailView({
  pre,
  latest,
  now = Date.now(),
}: {
  pre: VerificationDetail;
  latest: VerificationCheck | null;
  /** Injected so a fixture renders identically on every run. */
  now?: number;
}) {
  const decision = DECISION_BADGE[pre.decision ?? ""] ?? {
    label: "Pending",
    badge: "",
  };
  const fmcsa = VERIFICATION_BADGE[pre.verificationStatus] ?? {
    label: pre.verificationStatus,
    badge: "",
  };
  const expired = new Date(pre.expiresAt).getTime() <= now;
  const open = pre.decision === "manual_review" && !pre.claimedCarrierId;

  return (
    <>
      <div className="pbar">
        <div>
          <span className="crumb">
            <Link href="/portal/admin/carrier-verifications">
              Dispatch desk / Carrier verifications
            </Link>
          </span>
          <h1>{pre.legalNameEntered}</h1>
        </div>
        <div className="pbadges">
          <span className={`pbadge ${fmcsa.badge}`}>{fmcsa.label}</span>
          <span className={`pbadge ${decision.badge}`}>{decision.label}</span>
          {expired ? <span className="pbadge red">Expired</span> : null}
        </div>
      </div>

      <div className="pgrid2">
        <div>
          <div className="pcard">
            <h2>What the applicant submitted</h2>
            <dl className="pdl">
              <dt>Legal company name</dt>
              <dd>{pre.legalNameEntered}</dd>

              <dt>USDOT</dt>
              <dd className="mono">{pre.usdotNumberEntered}</dd>

              <dt>MC</dt>
              <dd className={pre.mcNumberEntered ? "mono" : undefined}>
                {pre.mcNumberEntered ? (
                  `MC-${pre.mcNumberEntered}`
                ) : (
                  <em>None submitted — legitimate for intrastate or exempt</em>
                )}
              </dd>

              <dt>Email</dt>
              <dd>{pre.email}</dd>

              <dt>Phone</dt>
              <dd>{pre.phone ?? "—"}</dd>

              <dt>Submitted</dt>
              <dd>{dateTime(pre.createdAt)}</dd>

              <dt>Expires</dt>
              <dd>
                {dateTime(pre.expiresAt)}
                {expired ? (
                  <span className="psubvalue">
                    Expired — a new verification is required to continue
                  </span>
                ) : null}
              </dd>
            </dl>
          </div>

          <div className="pcard">
            <h2>What FMCSA returned</h2>
            {latest === null ? (
              <p className="phelp">
                No authority check is recorded against this application. That
                happens when the pre-check could not reach the provider before
                the record was written — treat it as unverified, not as a
                finding.
              </p>
            ) : (
              <dl className="pdl">
                <dt>Legal name on record</dt>
                <dd>{latest.legalName ?? "Not reported"}</dd>

                <dt>DBA</dt>
                <dd>{latest.dbaName ?? "—"}</dd>

                <dt>USDOT on record</dt>
                <dd className="mono">{latest.usdotNumber ?? "—"}</dd>

                <dt>MC on record</dt>
                <dd className="mono">{latest.mcNumber ?? "—"}</dd>

                <dt>Allowed to operate</dt>
                <dd>{triStateLabel(latest.allowedToOperate)}</dd>

                <dt>Out of service</dt>
                <dd>
                  {triStateLabel(latest.outOfService)}
                  {latest.outOfServiceDate ? (
                    <span className="psubvalue">
                      Since {latest.outOfServiceDate}
                    </span>
                  ) : null}
                </dd>

                <dt>Name match</dt>
                <dd>{matchLabel(latest.nameMatch)}</dd>

                <dt>USDOT match</dt>
                <dd>{matchLabel(latest.dotMatch)}</dd>

                <dt>MC field match</dt>
                <dd>{matchLabel(latest.mcMatch)}</dd>

                <dt>Checked</dt>
                <dd>{dateTime(latest.checkedAt)}</dd>

                <dt>Source freshness</dt>
                <dd>
                  {latest.sourceRetrievedAt
                    ? dateTime(latest.sourceRetrievedAt)
                    : "Not reported"}
                </dd>

                <dt>Response digest</dt>
                <dd className="mono">
                  {latest.rawResponseSha256
                    ? `${latest.rawResponseSha256.slice(0, 16)}…`
                    : "—"}
                  <span className="psubvalue">
                    SHA-256. The payload itself is never stored.
                  </span>
                </dd>
              </dl>
            )}
            <p className="phelp">
              An FMCSA insurance filing is <b>not</b> shown here and is never
              read as compliance. PickLoads insurance requirements are judged
              from the uploaded COI and the expiry on the carrier record,
              separately.
            </p>
          </div>
        </div>

        <div>
          <div className="pcard">
            <h2>Why the engine decided this</h2>
            <dl className="pdl">
              <dt>Risk tier</dt>
              <dd>{pre.riskTier ?? "—"}</dd>

              <dt>Payment</dt>
              <dd>{pre.paymentStatus}</dd>

              <dt>Onboarded</dt>
              <dd>
                {pre.claimedCarrierId ? (
                  <>
                    Yes — carrier account created
                    {pre.claimedAt ? (
                      <span className="psubvalue">
                        {dateTime(pre.claimedAt)}
                      </span>
                    ) : null}
                  </>
                ) : (
                  "No carrier account exists for this application"
                )}
              </dd>
            </dl>

            <h3 className="psub">Reason codes</h3>
            <ul className="preasons">
              {sortReasonCodes(pre.reasonCodes).map((code) => (
                <li
                  key={code}
                  className={isNotableReason(code) ? "is-finding" : undefined}
                >
                  <span className="rlabel">{reasonCodeLabel(code)}</span>
                  <span className="rcode">{code}</span>
                </li>
              ))}
            </ul>
          </div>

          {pre.reviewedAt ? (
            <div className="pcard">
              <h2>Staff review</h2>
              <dl className="pdl">
                <dt>Reviewed by</dt>
                <dd>{pre.reviewerName ?? "Staff"}</dd>

                <dt>Reviewed at</dt>
                <dd>{dateTime(pre.reviewedAt)}</dd>

                <dt>Note</dt>
                <dd>{pre.reviewNote ?? "—"}</dd>
              </dl>
            </div>
          ) : null}

          <div className="pcard">
            <h2>Decision</h2>
            {open ? (
              <>
                <p className="phelp">
                  Clearing this application lets the carrier continue to the
                  verification fee and document upload. It does <b>not</b>{" "}
                  approve them, does <b>not</b> activate an account, and does{" "}
                  <b>not</b> change what FMCSA said — the activation
                  requirements are evaluated separately and in full, later.
                </p>
                <CarrierReviewForm preRegistrationId={pre.id} />
              </>
            ) : (
              <p className="phelp">
                {pre.claimedCarrierId
                  ? "This application has already been used to create a carrier account and can no longer be re-decided."
                  : "This application is not awaiting review."}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
