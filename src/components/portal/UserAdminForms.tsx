"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "@/i18n/navigation";
import {
  assignDispatcher,
  createStaffInvite,
  setAccountStatus,
  setCarrierActive,
} from "@/app/actions/staff";
import { initialFormState } from "@/lib/form-state";
import type { AccountStatus } from "@/lib/supabase/database.types";

/** M-58 — admin user-management forms (staff surface, English by scope). */

export function AccountStatusActions({
  profileId,
  status,
}: {
  profileId: string;
  status: AccountStatus;
}) {
  const router = useRouter();
  const [reasonFor, setReasonFor] = useState<"suspend" | null>(null);
  const [state, formAction, pending] = useActionState(
    setAccountStatus,
    initialFormState,
  );
  useEffect(() => {
    if (state.status === "success") {
      setReasonFor(null);
      router.refresh();
    }
  }, [state, router]);

  return (
    <div>
      <form action={formAction} style={{ display: "inline" }}>
        <input type="hidden" name="profile_id" value={profileId} />
        {status === "pending" ? (
          <button className="btn btn-amber btn-sm" name="action" value="approve" aria-busy={pending} disabled={pending}>
            Approve
          </button>
        ) : null}{" "}
        {status === "suspended" ? (
          <button className="btn btn-ghost btn-sm" name="action" value="reactivate" aria-busy={pending} disabled={pending}>
            Reactivate
          </button>
        ) : null}
      </form>{" "}
      {status !== "suspended" ? (
        reasonFor === "suspend" ? (
          <form action={formAction} style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            <input type="hidden" name="profile_id" value={profileId} />
            <input type="hidden" name="action" value="suspend" />
            <input
              name="reason"
              type="text"
              required
              minLength={3}
              maxLength={500}
              placeholder="Reason (sent to the customer)"
              style={{ minWidth: 220 }}
            />
            <button className="btn btn-ghost btn-sm" type="submit" aria-busy={pending} disabled={pending}>
              Confirm suspend
            </button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setReasonFor(null)}>
              Cancel
            </button>
          </form>
        ) : (
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setReasonFor("suspend")}>
            Suspend
          </button>
        )
      ) : null}
      {state.status === "error" && state.message ? (
        <span className="mono" role="alert" style={{ display: "block", color: "#f2c9c9", fontSize: ".66rem", marginTop: 4 }}>
          {state.message}
        </span>
      ) : null}
    </div>
  );
}

export interface DispatcherOption {
  id: string;
  name: string;
}

export function AssignDispatcherSelect({
  carrierId,
  current,
  dispatchers,
}: {
  carrierId: string;
  current: string | null;
  dispatchers: DispatcherOption[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    assignDispatcher,
    initialFormState,
  );
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);
  return (
    <form
      action={formAction}
      style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
    >
      <input type="hidden" name="carrier_id" value={carrierId} />
      <select
        name="dispatcher_id"
        defaultValue={current ?? ""}
        aria-label="Assigned dispatcher"
      >
        <option value="">Unassigned</option>
        {dispatchers.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <button className="btn btn-ghost btn-sm" type="submit" aria-busy={pending} disabled={pending}>
        {pending ? "…" : "Save"}
      </button>
      {state.status === "error" && state.message ? (
        <span className="mono" role="alert" style={{ color: "#f2c9c9", fontSize: ".66rem" }}>
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

export function StaffInviteForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    createStaffInvite,
    initialFormState,
  );
  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);
  return (
    <form action={formAction} ref={formRef}>
      <div className="pform-row" style={{ alignItems: "end" }}>
        <div className="field">
          <label htmlFor="si-email">Email</label>
          <input id="si-email" name="email" type="email" required placeholder="dispatcher@pickloads.com" />
        </div>
        <div className="field">
          <label htmlFor="si-role">Role</label>
          <select id="si-role" name="role" defaultValue="dispatcher">
            <option value="dispatcher">Dispatcher</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>
      <button className="btn btn-amber btn-sm" type="submit" aria-busy={pending} disabled={pending}>
        {pending ? "Sending…" : "Send invite"}
      </button>
      <div className={`form-ok${state.status === "success" ? " show" : ""}`} role="status">
        ✓ Invite emailed — single-use link, expires in 7 days.
      </div>
      <div className={`form-err${state.status === "error" ? " show" : ""}`} role="alert">
        {state.status === "error" && state.message ? state.message : null}
      </div>
    </form>
  );
}

/** M-60 — flip carriers.active; activation emails the "carrier approved"
 *  notice + portal notification (see setCarrierActive). */
export function CarrierActiveToggle({
  carrierId,
  active,
}: {
  carrierId: string;
  active: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    setCarrierActive,
    initialFormState,
  );
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} style={{ display: "inline" }}>
      <input type="hidden" name="carrier_id" value={carrierId} />
      <input type="hidden" name="active" value={active ? "0" : "1"} />
      <button
        className={active ? "btn btn-ghost btn-sm" : "btn btn-amber btn-sm"}
        type="submit"
        aria-busy={pending}
        disabled={pending}
      >
        {active ? "Deactivate carrier" : "Activate carrier"}
      </button>
      {state.status === "error" ? (
        <span role="alert" className="mono" style={{ display: "block", fontSize: ".66rem", color: "#f2c9c9", marginTop: 4 }}>
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
