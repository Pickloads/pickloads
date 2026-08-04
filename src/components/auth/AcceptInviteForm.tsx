"use client";

import { useActionState } from "react";
import { Link } from "@/i18n/navigation";
import { acceptStaffInvite } from "@/app/actions/staff";
import { initialFormState } from "@/lib/form-state";

/**
 * M-58 — staff invite accept form (staff-facing, English by scope). The
 * token is the credential; the server action validates hash/expiry/single-use
 * and assigns the role service-side.
 */
export function AcceptInviteForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(
    acceptStaffInvite,
    initialFormState,
  );

  if (state.status === "success") {
    return (
      <div className="bigform" style={{ maxWidth: 460, margin: "44px auto 0" }}>
        <h2>Welcome to the desk</h2>
        <div className="form-ok show" role="status">
          ✓ ACCOUNT CREATED — your staff role is active. Sign in to open the
          dispatch desk.
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
      <h2>Accept your staff invite</h2>
      <p>
        Set your name and password — your role was chosen by the admin who
        invited you.
      </p>
      <form action={formAction}>
        <input type="hidden" name="token" value={token} />
        <div className="field" style={{ marginBottom: 16 }}>
          <label htmlFor="ai-name">Your Full Name</label>
          <input id="ai-name" name="full_name" type="text" required minLength={2} autoComplete="name" />
        </div>
        <div className="field" style={{ marginBottom: 20 }}>
          <label htmlFor="ai-pass">Password (8+ characters)</label>
          <input id="ai-pass" name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="••••••••" />
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
      <div className={`form-err${state.status === "error" ? " show" : ""}`} role="alert">
        {state.status === "error" && state.message ? state.message : null}
      </div>
      <p className="mono" style={{ fontSize: ".72rem", marginTop: 22 }}>
        {"// "}Weren&apos;t expecting this? Ignore the email — nothing happens
        without this link.
      </p>
    </div>
  );
}
