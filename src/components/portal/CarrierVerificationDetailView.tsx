import { Link } from "@/i18n/navigation";
import { CarrierReviewForm } from "@/components/portal/CarrierReviewForm";
import {
  AdminCard,
  AdminCardShell,
  AdminColumn,
  AdminGrid,
  AdminPage,
  AdminPageHeader,
  DetailGroup,
  DetailList,
  DetailRow,
  InfoCallout,
  ReasonItem,
  ReasonList,
  ReviewNote,
  StateBlock,
  StatusBadge,
  type Tone,
} from "@/components/portal/admin-ui";
import {
  DECISION_BADGE,
  PAYMENT_BADGE,
  RISK_TIER_BADGE,
  VERIFICATION_BADGE,
  affirmativeTone,
  badgeFor,
  isNotableReason,
  matchLabel,
  matchTone,
  negativeTone,
  reasonCodeLabel,
  sortReasonCodes,
  triStateLabel,
} from "@/lib/carrier-authority/review-labels";

/**
 * M-100 — one carrier application, on the admin design system.
 *
 * ── WHAT CHANGED, AND WHY ────────────────────────────────────────────────
 *
 * The information is identical, field for field: nothing was removed, no
 * value was re-derived, and every decision still arrives as a prop that the
 * page already read. What changed is how it is structured.
 *
 * 1. DIVIDERS. The reported defect — "lines don't align" — was `.pdl` putting
 *    `border-top` on the `dt` AND the `dd` under `align-items:baseline`. Two
 *    boxes at two different Y values drew two rules per row. `DetailRow` puts
 *    one wrapper around the pair and `.drow + .drow` draws one border. See the
 *    note in `admin-ui.tsx`.
 *
 * 2. FMCSA IS NO LONGER A WALL. Twelve identical rows became four labelled
 *    bands — IDENTITY, AUTHORITY, MATCHING, SOURCE — and the four values that
 *    are actually compliance outcomes (allowed to operate, out of service,
 *    the three matches) became badges. `MISMATCH` as a danger chip is read in
 *    a glance; `MISMATCH` as body text is not.
 *
 * 3. RAW ENUMS ARE GONE FROM THE SCREEN. `manual_review` and `unpaid` were
 *    rendered verbatim. They are now `Manual review` and `Unpaid` on toned
 *    badges, via maps in `review-labels.ts`. The stored values are untouched.
 *
 * 4. THE REVIEW NOTE IS A RECORD, not a table cell. It gets its own panel.
 *
 * 5. THE DECISION CARD HAS STATES. Awaiting review / cleared / not eligible /
 *    already onboarded each render an icon, a badge and a sentence, and the
 *    two actions sit in a footer bar rather than loose under a textarea.
 *
 * Colour never carries a state by itself: every badge spells the state out,
 * and the "finding" reason codes are marked with a rule down the left edge as
 * well as being sorted to the top.
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

/** The existing `.pbadge` maps use V4 colour words; the design system uses
 *  tones. One translation, in one place, so both vocabularies stay honest. */
const TONE_OF: Readonly<Record<string, Tone>> = {
  green: "success",
  amber: "warning",
  red: "danger",
};
const toneOf = (badge: string): Tone => TONE_OF[badge] ?? "neutral";

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

  const risk = badgeFor(RISK_TIER_BADGE, pre.riskTier);
  const payment = badgeFor(PAYMENT_BADGE, pre.paymentStatus);

  return (
    <AdminPage>
      <AdminPageHeader
        crumb={
          <Link href="/portal/admin/carrier-verifications">
            Dispatch desk / Carrier verifications
          </Link>
        }
        title={pre.legalNameEntered}
        description="Carrier authority verification — what the applicant submitted, what FMCSA returned, and what the engine concluded."
        identifiers={
          <>
            <span>
              USDOT <b>{pre.usdotNumberEntered}</b>
            </span>
            <span>
              MC{" "}
              <b>
                {pre.mcNumberEntered ? `MC-${pre.mcNumberEntered}` : "none"}
              </b>
            </span>
            <span>
              Submitted <b>{dateTime(pre.createdAt)}</b>
            </span>
            <span>
              Expires <b>{dateTime(pre.expiresAt)}</b>
            </span>
          </>
        }
        badges={
          <>
            <StatusBadge tone={toneOf(fmcsa.badge)} dot>
              {fmcsa.label}
            </StatusBadge>
            <StatusBadge tone={toneOf(decision.badge)} dot>
              {decision.label}
            </StatusBadge>
            {expired ? <StatusBadge tone="danger">Expired</StatusBadge> : null}
          </>
        }
      />

      <AdminGrid>
        <AdminColumn>
          {/* ── §9 ────────────────────────────────────────────────────── */}
          <AdminCard title="What the applicant submitted" flush>
            <DetailList>
              <DetailRow label="Legal company name">
                {pre.legalNameEntered}
              </DetailRow>
              <DetailRow label="USDOT" id>
                {pre.usdotNumberEntered}
              </DetailRow>
              <DetailRow
                label="MC"
                id={pre.mcNumberEntered !== null}
                muted={pre.mcNumberEntered === null}
              >
                {pre.mcNumberEntered ? (
                  `MC-${pre.mcNumberEntered}`
                ) : (
                  <em>None submitted — legitimate for intrastate or exempt</em>
                )}
              </DetailRow>
              <DetailRow label="Email">{pre.email}</DetailRow>
              <DetailRow label="Phone" muted={pre.phone === null}>
                {pre.phone ?? "—"}
              </DetailRow>
              <DetailRow label="Submitted">{dateTime(pre.createdAt)}</DetailRow>
              <DetailRow
                label="Expires"
                {...(expired
                  ? {
                      sub: "Expired — a new verification is required to continue",
                    }
                  : {})}
              >
                {dateTime(pre.expiresAt)}
              </DetailRow>
            </DetailList>
          </AdminCard>

          {/* ── §10 ───────────────────────────────────────────────────── */}
          <AdminCardShell title="What FMCSA returned">
            {latest === null ? (
              <div className="a-card-body">
                <InfoCallout>
                  No authority check is recorded against this application. That
                  happens when the pre-check could not reach the provider before
                  the record was written — treat it as unverified, not as a
                  finding.
                </InfoCallout>
              </div>
            ) : (
              <>
                <DetailGroup>Identity</DetailGroup>
                <DetailList>
                  <DetailRow
                    label="Legal name on record"
                    muted={latest.legalName === null}
                  >
                    {latest.legalName ?? "Not reported"}
                  </DetailRow>
                  <DetailRow label="DBA" muted={latest.dbaName === null}>
                    {latest.dbaName ?? "—"}
                  </DetailRow>
                  <DetailRow
                    label="USDOT on record"
                    id={latest.usdotNumber !== null}
                    muted={latest.usdotNumber === null}
                  >
                    {latest.usdotNumber ?? "—"}
                  </DetailRow>
                  <DetailRow
                    label="MC on record"
                    id={latest.mcNumber !== null}
                    muted={latest.mcNumber === null}
                  >
                    {latest.mcNumber ?? "—"}
                  </DetailRow>

                </DetailList>
                <DetailGroup>Authority</DetailGroup>
                <DetailList>
                  <DetailRow label="Allowed to operate">
                    <StatusBadge tone={affirmativeTone(latest.allowedToOperate)}>
                      {triStateLabel(latest.allowedToOperate)}
                    </StatusBadge>
                  </DetailRow>
                  <DetailRow
                    label="Out of service"
                    {...(latest.outOfServiceDate
                      ? { sub: `Since ${latest.outOfServiceDate}` }
                      : {})}
                  >
                    <StatusBadge tone={negativeTone(latest.outOfService)}>
                      {triStateLabel(latest.outOfService)}
                    </StatusBadge>
                  </DetailRow>

                </DetailList>
                <DetailGroup>Matching</DetailGroup>
                <DetailList>
                  <DetailRow label="Name match">
                    <StatusBadge tone={matchTone(latest.nameMatch)}>
                      {matchLabel(latest.nameMatch)}
                    </StatusBadge>
                  </DetailRow>
                  <DetailRow label="USDOT match">
                    <StatusBadge tone={matchTone(latest.dotMatch)}>
                      {matchLabel(latest.dotMatch)}
                    </StatusBadge>
                  </DetailRow>
                  <DetailRow label="MC field match">
                    <StatusBadge tone={matchTone(latest.mcMatch)}>
                      {matchLabel(latest.mcMatch)}
                    </StatusBadge>
                  </DetailRow>

                </DetailList>
                <DetailGroup>Source</DetailGroup>
                <DetailList>
                  <DetailRow label="Checked">
                    {dateTime(latest.checkedAt)}
                  </DetailRow>
                  <DetailRow
                    label="Source freshness"
                    muted={latest.sourceRetrievedAt === null}
                  >
                    {latest.sourceRetrievedAt
                      ? dateTime(latest.sourceRetrievedAt)
                      : "Not reported"}
                  </DetailRow>
                  <DetailRow
                    label="Response digest"
                    id={latest.rawResponseSha256 !== null}
                    muted={latest.rawResponseSha256 === null}
                    sub="SHA-256. The payload itself is never stored."
                  >
                    {latest.rawResponseSha256
                      ? `${latest.rawResponseSha256.slice(0, 16)}…`
                      : "—"}
                  </DetailRow>
                </DetailList>
                <InfoCallout inset>
                  An FMCSA insurance filing is <b>not</b> shown here and is
                  never read as compliance. PickLoads insurance requirements are
                  judged from the uploaded COI and the expiry on the carrier
                  record, separately.
                </InfoCallout>
              </>
            )}
          </AdminCardShell>
        </AdminColumn>

        <AdminColumn>
          {/* ── §11 ───────────────────────────────────────────────────── */}
          <AdminCardShell title="Why the engine decided this">
            <DetailList>
              <DetailRow label="Risk tier">
                <StatusBadge tone={risk.tone}>{risk.label}</StatusBadge>
              </DetailRow>
              <DetailRow label="Payment">
                <StatusBadge tone={payment.tone}>{payment.label}</StatusBadge>
              </DetailRow>
              <DetailRow
                label="Onboarded"
                {...(pre.claimedCarrierId && pre.claimedAt
                  ? { sub: dateTime(pre.claimedAt) }
                  : {})}
              >
                {pre.claimedCarrierId ? (
                  <StatusBadge tone="success">Carrier account created</StatusBadge>
                ) : (
                  <StatusBadge tone="neutral">No carrier account</StatusBadge>
                )}
              </DetailRow>
            </DetailList>
            <DetailGroup>Reason codes</DetailGroup>
            <ReasonList>
              {sortReasonCodes(pre.reasonCodes).map((code) => (
                <ReasonItem
                  key={code}
                  text={reasonCodeLabel(code)}
                  code={code}
                  finding={isNotableReason(code)}
                />
              ))}
            </ReasonList>
          </AdminCardShell>

          {/* ── §12 ───────────────────────────────────────────────────── */}
          {pre.reviewedAt ? (
            <AdminCardShell title="Staff review">
              <DetailList>
                <DetailRow label="Reviewed by">
                  {pre.reviewerName ?? "Staff"}
                </DetailRow>
                <DetailRow label="Reviewed at">
                  {dateTime(pre.reviewedAt)}
                </DetailRow>
              </DetailList>
              <div className="a-field">
                {/* A heading, not a <label> — there is no control here to
                    label; this is the written record, read-only. */}
                <h3 className="a-sublabel">Review note</h3>
                <ReviewNote>{pre.reviewNote}</ReviewNote>
              </div>
            </AdminCardShell>
          ) : null}

          {/* ── §13 ───────────────────────────────────────────────────── */}
          <AdminCardShell title="Decision">
            {open ? (
              <>
                <div className="a-card-body">
                  <StateBlock
                    tone="warning"
                    icon="!"
                    title="Awaiting review"
                  >
                    Clearing this application lets the carrier continue to the
                    verification fee and document upload. It does <b>not</b>{" "}
                    approve them, does <b>not</b> activate an account, and does{" "}
                    <b>not</b> change what FMCSA said — the activation
                    requirements are evaluated separately and in full, later.
                  </StateBlock>
                </div>
                <CarrierReviewForm preRegistrationId={pre.id} />
              </>
            ) : (
              <div className="a-card-body">
                <StateBlock
                  tone={pre.claimedCarrierId ? "success" : toneOf(decision.badge)}
                  // The marker follows the decision rather than being a
                  // generic dot: a cleared file reads as cleared at a glance,
                  // a refused one as refused. The title still states it in
                  // words, so the glyph is decoration, not the signal.
                  icon={
                    pre.claimedCarrierId || decision.badge === "green"
                      ? "✓"
                      : decision.badge === "red"
                        ? "✕"
                        : "•"
                  }
                  title={pre.claimedCarrierId ? "Completed" : decision.label}
                >
                  {pre.claimedCarrierId
                    ? "This application has already been used to create a carrier account and can no longer be re-decided."
                    : "This application is not awaiting review."}
                </StateBlock>
              </div>
            )}
          </AdminCardShell>
        </AdminColumn>
      </AdminGrid>
    </AdminPage>
  );
}
