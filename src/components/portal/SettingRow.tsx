"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "@/i18n/navigation";
import { updateCompanySetting } from "@/app/actions/admin";
import { initialFormState } from "@/lib/form-state";
import {
  controlFits,
  settingSpec,
  settingSummary,
} from "@/lib/settings/presentation";

/**
 * M-24 — one editable `company_settings` key (admin-only server action).
 * M-102 — the decision first, the database second.
 *
 * ── WHAT THIS SUBMITS ────────────────────────────────────────────────────
 *
 * `updateCompanySetting` reads one field, `value`, and `JSON.parse`s it. Every
 * control below therefore submits the JSON ENCODING of the value, not the
 * value: a boolean posts `true`/`false`, an integer posts `90`, a choice posts
 * `"sample"` with the quotes. The stored type is unchanged, which matters
 * because `location_retention_days` is read as an integer and
 * `brokerage_active` as a boolean by code elsewhere.
 *
 * ── WHY A SELECT AND NOT A SWITCH ────────────────────────────────────────
 *
 * A checkbox submits nothing when unchecked, so "off" would arrive as a
 * missing field and the action would reject it — or worse, a hidden-input
 * workaround would post two `value` fields and leave which one wins up to
 * form-encoding order. A select always submits exactly one value. On a screen
 * whose stated risk is "flip the wrong switch on the live site", that
 * certainty is worth more than the appearance of a toggle.
 *
 * ── WHEN THE MAP AND THE DATA DISAGREE ───────────────────────────────────
 *
 * `controlFits` checks the stored value against the control the map wants. A
 * boolean key holding an object falls back to the JSON editor rather than
 * rendering a toggle that cannot express what is there — saving through such
 * a control would quietly destroy the setting.
 */
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

  const spec = settingSpec(settingKey);
  const fits = controlFits(settingKey, value);
  const kind = fits ? spec.kind : "json";
  const fieldId = `setting-${settingKey}`;
  const hintId = `${fieldId}-hint`;
  const rawJson = JSON.stringify(
    value,
    null,
    value && typeof value === "object" ? 1 : 0,
  );

  return (
    <section className="a-card a-setting">
      <div className="a-card-head">
        <h2>{spec.label}</h2>
        <div className="a-head-actions">
          <span className="a-badge is-neutral">
            {settingSummary(settingKey, value)}
          </span>
        </div>
      </div>

      <form action={formAction}>
        <input type="hidden" name="key" value={settingKey} />
        <div className="a-field">
          <p id={hintId} className="a-hint a-setting-desc">
            {spec.description}
          </p>

          {kind === "boolean" ? (
            <div className="a-setting-control">
              <label htmlFor={fieldId}>{spec.label}</label>
              <select
                id={fieldId}
                name="value"
                defaultValue={value === true ? "true" : "false"}
                aria-describedby={hintId}
              >
                <option value="true">{spec.onLabel ?? "On"}</option>
                <option value="false">{spec.offLabel ?? "Off"}</option>
              </select>
            </div>
          ) : kind === "integer" ? (
            <div className="a-setting-control">
              <label htmlFor={fieldId}>
                {spec.label}
                {spec.unit ? ` (${spec.unit})` : ""}
              </label>
              <input
                id={fieldId}
                name="value"
                type="number"
                inputMode="numeric"
                defaultValue={typeof value === "number" ? String(value) : ""}
                {...(spec.min !== undefined ? { min: spec.min } : {})}
                {...(spec.max !== undefined ? { max: spec.max } : {})}
                aria-describedby={hintId}
              />
            </div>
          ) : kind === "choice" ? (
            <div className="a-setting-control">
              <label htmlFor={fieldId}>{spec.label}</label>
              <select
                id={fieldId}
                name="value"
                // The option values carry the JSON encoding, quotes included,
                // so the stored string is byte-identical to what was there.
                defaultValue={JSON.stringify(value)}
                aria-describedby={hintId}
              >
                {(spec.options ?? []).map((o) => (
                  <option key={o.value} value={JSON.stringify(o.value)}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="a-setting-control is-json">
              <label htmlFor={fieldId}>Configuration (JSON)</label>
              <textarea
                id={fieldId}
                name="value"
                rows={value && typeof value === "object" ? 4 : 2}
                defaultValue={rawJson}
                aria-describedby={hintId}
                spellCheck={false}
              />
            </div>
          )}

          {kind === "boolean" || kind === "integer" || kind === "choice" ? (
            // The encoded value the control cannot express as an input value.
            <BooleanEncodingNote kind={kind} />
          ) : null}

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
            ✓ Saved — the public site reflects this immediately.
          </div>
        </div>

        <div className="a-actions">
          <button
            className="btn btn-amber btn-sm"
            type="submit"
            aria-busy={pending}
            disabled={pending}
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <details className="a-disclosure">
            <summary>Advanced</summary>
            <div className="a-disclosure-body">
              <dl className="slog-tech">
                <div>
                  <dt>Setting key</dt>
                  <dd>
                    <code className="a-code">{settingKey}</code>
                  </dd>
                </div>
                <div>
                  <dt>Stored value</dt>
                  <dd>
                    <code className="a-code">{rawJson}</code>
                  </dd>
                </div>
                <div>
                  <dt>Last updated</dt>
                  <dd>
                    {new Date(updatedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </dd>
                </div>
                {description ? (
                  <div>
                    <dt>Engineering note</dt>
                    <dd>{description}</dd>
                  </div>
                ) : null}
              </dl>
              {!fits ? (
                <p className="a-hint">
                  The stored value does not match the shape this setting
                  usually holds, so it is being edited as JSON rather than
                  through its normal control.
                </p>
              ) : null}
            </div>
          </details>
        </div>
      </form>
    </section>
  );
}

/** Explains, once per control, what will actually be written. */
function BooleanEncodingNote({ kind }: { kind: "boolean" | "integer" | "choice" }) {
  const what =
    kind === "boolean"
      ? "a true/false value"
      : kind === "integer"
        ? "a whole number"
        : "a single stored option";
  return <p className="a-hint">Saving writes {what} — the format has not changed.</p>;
}
