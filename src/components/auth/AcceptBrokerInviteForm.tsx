"use client";

import { useActionState } from "react";
import { Link } from "@/i18n/navigation";
import { acceptBrokerInviteAction } from "@/app/actions/broker-partners";
import { initialFormState } from "@/lib/form-state";

/**
 * M-81 — broker-partner invite accept form (§12 *"invited by an admin"*).
 *
 * M-58's `AcceptInviteForm`, in the partner's vocabulary. The token is the
 * credential; the server action validates hash, expiry, single-use AND
 * revocation, then assigns `role = 'broker'` and the organization membership
 * service-side. Nothing on this form names either.
 *
 * ── THE SUCCESS COPY IS DELIBERATELY NOT "YOU'RE IN" ────────────────────
 *
 * §12 makes verification a separate admin act, so an accepted invite into an
 * unverified organization produces a working login that reads nothing. The
 * success state says the account is ready AND that shipments appear once
 * PickLoads verifies the organization — §30's honest-states rule applied to a
 * permission rather than to a tracking status.
 *
 * English by scope, like M-58's: the recipient is a business counterparty
 * being onboarded by an admin, and the invitation email that brought them
 * here is English too.
 */
export function AcceptBrokerInviteForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(
    acceptBrokerInviteAction,
    initialFormState,
  );

  if (state.status === "success") {
    return (
      <div className="bigform" style={{ maxWidth: 460, margin: "44px auto 0" }}>
        <h2>Your partner account is ready</h2>
        <div className="form-ok show" role="status">
          ✓ ACCOUNT CREATED — sign in to open the partner portal. Shipments
          appear once a PickLoads admin has verified your organization.
        </div>
        <p style={{ marginTop: 22 }}>
          <Link className="btn btn-amber" href="/login">
            Sign In →
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="bigform" style={{ maxWidth: 460, margin: "44px auto 0" }}>
      <h2>Accept your partner invite</h2>
      <p>
        Set your name and password. Your organization was chosen by the
        PickLoads admin who invited you.
      </p>
      <form action={formAction}>
        <input type="hidden" name="token" value={token} />
        <div className="field" style={{ marginBottom: 16 }}>
          <label htmlFor="bi-name">Your Full Name</label>
          <input
            id="bi-name"
            name="full_name"
            type="text"
            required
            minLength={2}
            autoComplete="name"
          />
        </div>
        <div className="field" style={{ marginBottom: 20 }}>
          <label htmlFor="bi-pass">Password (8+ characters)</label>
          <input
            id="bi-pass"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="••••••••"
          />
        </div>
        <button
          className="btn btn-amber"
          type="submit"
          aria-busy={pending}
          disabled={pending}
          style={{ width: "100%" }}
        >
          {pending ? "Creating account…" : "Accept Invite →"}
        </button>
      </form>
      <div
        className={`form-err${state.status === "error" ? " show" : ""}`}
        role="alert"
      >
        {state.status === "error" && state.message ? state.message : null}
      </div>
      <p className="mono" style={{ fontSize: ".72rem", marginTop: 22 }}>
        {"// "}The partner portal shows shipment status, timeline, BOL and POD
        for freight PickLoads shares with you. It never shows carrier records,
        billing or rates.
      </p>
    </div>
  );
}
