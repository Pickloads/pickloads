import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { requireStaffNoMfa } from "@/lib/auth";
import { getMfaState, MFA_GRACE_DAYS } from "@/lib/mfa";
import { MfaEnrollment } from "@/components/portal/MfaEnrollment";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Two-Factor Authentication — PickLoads",
  robots: { index: false, follow: false },
};

/**
 * M-61 — the staff MFA surface (audit §6.1, decision D3).
 *
 * This is the ONE staff route gated by `requireStaffNoMfa` instead of
 * `requireStaff`: an admin who has not enrolled is redirected here from every
 * other /portal/admin route, so gating it with the MFA check would loop.
 *
 * Honest states, no fake progress:
 *   * placeholder env  → says so plainly; nothing is gated, nothing pretends.
 *   * admin, no factor → hard-required banner, enrollment.
 *   * dispatcher in grace → countdown to the deadline, enrollment optional.
 *   * verified but AAL1 → step-up challenge only.
 */
export default async function StaffMfaPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireStaffNoMfa(locale);
  const state = await getMfaState(session.role, session.createdAt);

  const badge = !state.configured
    ? { label: "Not available here", tone: "" }
    : state.satisfied && state.verified
      ? { label: "Active", tone: " green" }
      : state.requirement === "hard"
        ? { label: "Required", tone: " red" }
        : { label: "Recommended", tone: " amber" };

  return (
    <main id="main" className="a-page">
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk / Security</span>
          <h1>Two-factor authentication</h1>
        </div>
        <span className={`pbadge${badge.tone}`}>{badge.label}</span>
      </div>

      {state.configured && state.requirement === "hard" && !state.satisfied ? (
        <div className="pcard alert">
          <h2>
            {session.role === "admin"
              ? "Admin accounts require a second factor"
              : "Your two-factor grace period has ended"}
          </h2>
          <p className="plede">
            {session.role === "admin"
              ? "Admins can change roles, company settings and account status. Until an authenticator is registered and confirmed on this session, the rest of the dispatch desk stays locked."
              : `Dispatchers get ${MFA_GRACE_DAYS} days from account creation to enroll. That window has closed for this account, so the dispatch desk stays locked until you finish setup.`}
          </p>
        </div>
      ) : null}

      {state.configured && state.requirement === "grace" ? (
        <div className="pcard">
          <h2>Enrollment due in {state.graceDaysLeft} day{state.graceDaysLeft === 1 ? "" : "s"}</h2>
          <p className="plede">
            Dispatcher accounts have {MFA_GRACE_DAYS} days from creation to add
            an authenticator. After{" "}
            {state.graceEndsAt
              ? new Date(state.graceEndsAt).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })
              : "the deadline"}
            , the dispatch desk locks until it&apos;s done. You can finish now —
            it takes about a minute.
          </p>
        </div>
      ) : null}

      <div className="pgrid2">
        <MfaEnrollment
          configured={state.configured}
          hasVerifiedFactor={state.verified}
          friendlyName={`PickLoads — ${session.email ?? session.role}`}
          returnTo="/portal/admin"
        />

        <div className="pcard">
          <h2>Status</h2>
          {/* M-99: was a `.ptable`, which is a DATA GRID — one border-bottom
              per row, sized for a single line of tabular text. These are
              label/value pairs, so they are a definition list: the divider
              falls between rows instead of under wrapped text, and a long
              value ("Unknown (no auth service in this environment)") wraps in
              its own column instead of stretching the card. */}
          <dl className="pdl">
            <dt>Account</dt>
            <dd>{session.email ?? "—"}</dd>

            <dt>Role</dt>
            <dd>{session.role}</dd>

            <dt>Policy</dt>
            <dd>
              {state.requirement === "hard"
                ? "Required"
                : state.requirement === "grace"
                  ? `Grace — ${state.graceDaysLeft} day(s) left`
                  : "Not required for this role"}
            </dd>

            <dt>Authenticator</dt>
            <dd>
              {!state.configured
                ? "Unknown (no auth service in this environment)"
                : state.verified
                  ? "Registered and confirmed"
                  : state.enrolled
                    ? "Started but not confirmed"
                    : "None"}
            </dd>

            <dt>This session</dt>
            <dd className="mono">{state.currentLevel ?? "unknown"}</dd>
          </dl>
          <p className="phelp">
            Lost your device? Another admin must remove the factor in the
            Supabase dashboard — there is no self-service reset by design.
          </p>
          {state.satisfied ? (
            <div className="pactions">
              <Link className="btn btn-ghost btn-sm" href="/portal/admin">
                ← Back to the dispatch desk
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
