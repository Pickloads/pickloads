"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { updateCompanySetting } from "@/app/actions/admin";
import { initialFormState } from "@/lib/form-state";

/** M-24 — one editable company_settings key (admin-only server action). */
export function SettingRow({
  settingKey,
  value,
  description,
  updatedAt,
}: {
  settingKey: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    updateCompanySetting,
    initialFormState,
  );
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);

  return (
    <div className="pcard">
      <h2 style={{ marginBottom: 4 }}>
        <span className="mono" style={{ color: "var(--amber)" }}>
          {settingKey}
        </span>
      </h2>
      <p className="mono" style={{ fontSize: ".7rem", color: "var(--steel)", marginBottom: 12 }}>
        {description ?? "—"} · last updated{" "}
        {new Date(updatedAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}
      </p>
      <form action={formAction} style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <input type="hidden" name="key" value={settingKey} />
        <div className="field" style={{ flex: 1, minWidth: 260 }}>
          <label htmlFor={`setting-${settingKey}`}>Value (JSON)</label>
          <textarea
            id={`setting-${settingKey}`}
            name="value"
            rows={2}
            defaultValue={JSON.stringify(value, null, value && typeof value === "object" ? 1 : 0)}
            className="mono"
            style={{ fontSize: ".82rem" }}
          />
        </div>
        <button
          className="btn btn-amber btn-sm"
          type="submit"
          aria-busy={pending}
          disabled={pending}
          style={{ marginTop: 24 }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
      <div className={`form-err${state.status === "error" ? " show" : ""}`} role="alert">
        {state.status === "error" ? state.message : null}
      </div>
      <div className={`form-ok${state.status === "success" ? " show" : ""}`} role="status">
        ✓ Saved — the public site reflects this immediately.
      </div>
    </div>
  );
}
