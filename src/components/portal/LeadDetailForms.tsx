"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "@/i18n/navigation";
import { addLeadActivity, updateLeadMeta } from "@/app/actions/crm";
import { initialFormState } from "@/lib/form-state";
import type { StaffOption } from "@/components/portal/KanbanBoard";
import type {
  LeadStatus,
  PriorityLevel,
} from "@/lib/supabase/database.types";

/** M-23 lead detail — meta editor + activity logger (staff server actions). */

const STATUSES: ReadonlyArray<{ value: LeadStatus; label: string }> = [
  { value: "new", label: "New" },
  { value: "call", label: "Call" },
  { value: "qualified", label: "Qualified" },
  { value: "appointment", label: "Appointment" },
  { value: "agreement", label: "Agreement" },
  { value: "waiting_documents", label: "Waiting documents" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "lost", label: "Lost" },
];

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LeadMetaForm({
  leadId,
  status,
  assignedTo,
  priority,
  tags,
  callbackAt,
  staff,
}: {
  leadId: string;
  status: LeadStatus;
  assignedTo: string | null;
  priority: PriorityLevel;
  tags: string[];
  callbackAt: string | null;
  staff: StaffOption[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    updateLeadMeta,
    initialFormState,
  );
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);

  return (
    <form action={formAction}>
      <input type="hidden" name="lead_id" value={leadId} />
      <div className="pform-row">
        <div className="field">
          <label htmlFor="lm-status">Status</label>
          <select id="lm-status" name="status" defaultValue={status}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="lm-assigned">Dispatcher</label>
          <select id="lm-assigned" name="assigned_to" defaultValue={assignedTo ?? ""}>
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="lm-priority">Priority</label>
          <select id="lm-priority" name="priority" defaultValue={priority}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="lm-callback">Next callback</label>
          <input
            id="lm-callback"
            name="callback_at"
            type="datetime-local"
            defaultValue={toLocalInput(callbackAt)}
          />
        </div>
      </div>
      <div className="field" style={{ marginBottom: 14 }}>
        <label htmlFor="lm-tags">Tags (comma-separated)</label>
        <input
          id="lm-tags"
          name="tags"
          type="text"
          defaultValue={tags.join(", ")}
          placeholder="reefer, west-coast, spanish"
        />
      </div>
      <button
        className="btn btn-amber btn-sm"
        type="submit"
        aria-busy={pending}
        disabled={pending}
      >
        {pending ? "Saving…" : "Save lead"}
      </button>
      <div
        className={`form-err${state.status === "error" ? " show" : ""}`}
        role="alert"
      >
        {state.status === "error" ? state.message : null}
      </div>
      <div
        className={`form-ok${state.status === "success" ? " show" : ""}`}
        role="status"
      >
        ✓ Saved — status changes are journaled automatically.
      </div>
    </form>
  );
}

export function ActivityForm({ leadId }: { leadId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    addLeadActivity,
    initialFormState,
  );
  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  return (
    <form ref={formRef} action={formAction}>
      <input type="hidden" name="lead_id" value={leadId} />
      <div className="pform-row">
        <div className="field">
          <label htmlFor="la-type">Activity</label>
          <select id="la-type" name="type" defaultValue="note">
            <option value="note">Note</option>
            <option value="call">Call logged</option>
            <option value="callback">Schedule callback</option>
            <option value="appointment">Schedule appointment</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="la-when">When (callback/appointment)</label>
          <input id="la-when" name="callback_at" type="datetime-local" />
        </div>
      </div>
      <div className="field" style={{ marginBottom: 14 }}>
        <label htmlFor="la-body">Details</label>
        <textarea
          id="la-body"
          name="body"
          rows={3}
          placeholder="Spoke with the owner — running reefer out of NJ, wants weekend coverage…"
        />
      </div>
      <button
        className="btn btn-ghost btn-sm"
        type="submit"
        aria-busy={pending}
        disabled={pending}
      >
        {pending ? "Logging…" : "Log activity"}
      </button>
      <div
        className={`form-err${state.status === "error" ? " show" : ""}`}
        role="alert"
      >
        {state.status === "error" ? state.message : null}
      </div>
    </form>
  );
}
