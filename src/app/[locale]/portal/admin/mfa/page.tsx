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
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk / Security</span>
          <h1>Two-factor authentication</h1>
        </div>
        <span className={`pbadge${badge.tone}`}>{badge.label}</span>
      </div>

      {state.configured && state.requirement === "hard" && !state.satisfied ? (
        <div className="pcard" style={{ borderColor: "#7a2a2a" }}>
          <h2>
            {session.role === "admin"
              ? "Admin accounts require a second factor"
              : "Your two-factor grace period has ended"}
          </h2>
          <p style={{ fontSize: ".9rem", color: "#cfd6da" }}>
            {session.role === "admin"
              ? "Admins can change roles, company settings and account status. Until an authenticator is registered and confirmed on this session, the rest of the dispatch desk stays locked."
              : `Dispatchers get ${MFA_GRACE_DAYS} days from account creation to enroll. That window has closed for this account, so the dispatch desk stays locked until you finish setup.`}
          </p>
        </div>
      ) : null}

      {state.configured && state.requirement === "grace" ? (
        <div className="pcard">
          <h2>Enrollment due in {state.graceDaysLeft} day{state.graceDaysLeft === 1 ? "" : "s"}</h2>
          <p style={{ fontSize: ".9rem", color: "#cfd6da" }}>
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
          <table className="ptable">
            <tbody>
              <tr>
                <td>Account</td>
                <td>{session.email ?? "—"}</td>
              </tr>
              <tr>
                <td>Role</td>
                <td>{session.role}</td>
              </tr>
              <tr>
                <td>Policy</td>
                <td>
                  {state.requirement === "hard"
                    ? "Required"
                    : state.requirement === "grace"
                      ? `Grace — ${state.graceDaysLeft} day(s) left`
                      : "Not required for this role"}
                </td>
              </tr>
              <tr>
                <td>Authenticator</td>
                <td>
                  {!state.configured
                    ? "Unknown (no auth service in this environment)"
                    : state.verified
                      ? "Registered and confirmed"
                      : state.enrolled
                        ? "Started but not confirmed"
                        : "None"}
                </td>
              </tr>
              <tr>
                <td>This session</td>
                <td>{state.currentLevel ?? "unknown"}</td>
              </tr>
            </tbody>
          </table>
          <p
            className="mono"
            style={{ fontSize: ".7rem", color: "var(--steel)", marginTop: 12 }}
          >
            Lost your device? Another admin must remove the factor in the
            Supabase dashboard — there is no self-service reset by design.
          </p>
          {state.satisfied ? (
            <p style={{ marginTop: 12 }}>
              <Link className="btn btn-ghost btn-sm" href="/portal/admin">
                ← Back to the dispatch desk
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}
