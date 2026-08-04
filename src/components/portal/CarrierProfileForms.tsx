"use client";

import { useEffect } from "react";
import { useActionState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import {
  submitChangeRequest,
  updateContactInfo,
  updateDispatchPreferences,
} from "@/app/actions/carrier-portal";
import { initialFormState, type FormState } from "@/lib/form-state";
import {
  REGULATED_FIELD_LABELS,
  REGULATED_FIELDS,
} from "@/lib/validation/portal";

/**
 * M-55 — company profile self-service (decision D5): contact info and
 * dispatch preferences save directly; regulated fields go through a
 * staff-reviewed change request (tagged support thread + audit event).
 */

function StatusRow({ state }: { state: FormState }) {
  const tv = useV4();
  return (
    <>
      <div className={`form-ok${state.status === "success" ? " show" : ""}`} role="status">
        {state.status === "success" ? tv("✓ Saved.") : null}
      </div>
      <div className={`form-err${state.status === "error" ? " show" : ""}`} role="alert">
        {state.status === "error" && state.message ? tv(state.message) : null}
      </div>
    </>
  );
}

export function ContactInfoForm({
  fullName,
  phone,
}: {
  fullName: string | null;
  phone: string | null;
}) {
  const tv = useV4();
  const router = useRouter();
  const [state, formAction, pending] = useActionState(updateContactInfo, initialFormState);
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);
  return (
    <form action={formAction}>
      <div className="pform-row" style={{ alignItems: "end" }}>
        <div className="field">
          <label htmlFor="ci-name">{tv("Your Full Name")}</label>
          <input id="ci-name" name="full_name" type="text" required defaultValue={fullName ?? ""} autoComplete="name" />
        </div>
        <div className="field">
          <label htmlFor="ci-phone">{tv("Phone")}</label>
          <input id="ci-phone" name="phone" type="tel" inputMode="tel" defaultValue={phone ?? ""} placeholder="(___) ___-____" autoComplete="tel" />
        </div>
      </div>
      <button className="btn btn-amber btn-sm" type="submit" aria-busy={pending} disabled={pending}>
        {pending ? tv("Saving…") : tv("Save contact info")}
      </button>
      <StatusRow state={state} />
    </form>
  );
}

export function DispatchPreferencesForm({
  preferredLanes,
  homeTimeNotes,
}: {
  preferredLanes: string | null;
  homeTimeNotes: string | null;
}) {
  const tv = useV4();
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    updateDispatchPreferences,
    initialFormState,
  );
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);
  return (
    <form action={formAction}>
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="dp-lanes">{tv("Preferred lanes")}</label>
        <textarea
          id="dp-lanes"
          name="preferred_lanes"
          rows={2}
          maxLength={400}
          defaultValue={preferredLanes ?? ""}
          placeholder={tv("e.g. Midwest → Southeast, no NYC")}
        />
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="dp-home">{tv("Home time")}</label>
        <textarea
          id="dp-home"
          name="home_time_notes"
          rows={2}
          maxLength={400}
          defaultValue={homeTimeNotes ?? ""}
          placeholder={tv("e.g. Home weekends, based in Charlotte NC")}
        />
      </div>
      <button className="btn btn-amber btn-sm" type="submit" aria-busy={pending} disabled={pending}>
        {pending ? tv("Saving…") : tv("Save preferences")}
      </button>
      <StatusRow state={state} />
    </form>
  );
}

export function ChangeRequestForm() {
  const tv = useV4();
  const [state, formAction, pending] = useActionState(
    submitChangeRequest,
    initialFormState,
  );
  if (state.status === "success") {
    return (
      <div className="form-ok show" role="status">
        {tv(
          "✓ Request received. Our team verifies regulated changes and applies them — you'll hear back in Support.",
        )}
      </div>
    );
  }
  return (
    <form action={formAction}>
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="cr-field">{tv("What needs to change?")}</label>
        <select id="cr-field" name="field" required defaultValue="">
          <option value="" disabled>
            {tv("Select…")}
          </option>
          {REGULATED_FIELDS.map((f) => (
            <option key={f} value={f}>
              {tv(REGULATED_FIELD_LABELS[f])}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="cr-message">{tv("Describe the change")}</label>
        <textarea
          id="cr-message"
          name="message"
          rows={4}
          required
          minLength={10}
          maxLength={2000}
          placeholder={tv("New value, effective date, and anything we should verify.")}
        />
      </div>
      <button className="btn btn-amber btn-sm" type="submit" aria-busy={pending} disabled={pending}>
        {pending ? tv("Sending…") : tv("Submit change request")}
      </button>
      <StatusRow state={state} />
    </form>
  );
}
