import { Link } from "@/i18n/navigation";
import { getMfaState, MFA_GRACE_DAYS } from "@/lib/mfa";
import type { SessionProfile } from "@/lib/auth";

/**
 * M-61 — the D3 dispatcher countdown banner.
 *
 * Rendered by the portal shell so it follows staff across every page while
 * the grace window is open, and disappears the moment a factor is confirmed.
 * Server component: the MFA state is already known server-side, so nothing
 * about the account's security posture ships to the client beyond the copy.
 *
 * Renders NOTHING when: auth env is absent, the role isn't in grace, or a
 * verified factor already exists — no nagging, no fake urgency.
 */
export async function MfaGraceBanner({ session }: { session: SessionProfile }) {
  if (session.role !== "admin" && session.role !== "dispatcher") return null;
  const state = await getMfaState(session.role, session.createdAt);
  if (!state.configured || state.requirement !== "grace" || state.verified) {
    return null;
  }

  const days = state.graceDaysLeft ?? 0;
  return (
    <div
      className="pcard"
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
        flexWrap: "wrap",
        padding: "14px 18px",
        marginBottom: 18,
      }}
    >
      <span style={{ fontSize: ".88rem", color: "#cfd6da" }}>
        <span className="pbadge amber" style={{ marginRight: 10 }}>
          {days} day{days === 1 ? "" : "s"} left
        </span>
        Two-factor authentication becomes mandatory for your account{" "}
        {state.graceEndsAt
          ? `on ${new Date(state.graceEndsAt).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
            })}`
          : `${MFA_GRACE_DAYS} days after account creation`}
        .
      </span>
      <Link className="btn btn-amber btn-sm" href="/portal/admin/mfa">
        Set it up
      </Link>
    </div>
  );
}
