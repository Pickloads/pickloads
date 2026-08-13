"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { useV4 } from "@/i18n/v4";
import { createClient } from "@/lib/supabase/client";
import { updateAccountPreferences } from "@/app/actions/portal-account";
import { initialFormState } from "@/lib/form-state";

/**
 * M-55 — account settings shared by carrier and shipper portals:
 * password change (browser client → Supabase Auth, same surface as M-42
 * reset), preferred language (profiles.preferred_language) and email
 * preferences (user_preferences). Honest refusal when auth env is absent.
 */

const LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "ru", label: "Русский" },
  { value: "ht", label: "Kreyòl Ayisyen" },
];

export function PasswordChangeForm() {
  const tv = useV4();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = useMemo(
    () =>
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("placeholder"),
    [],
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setDone(false);
    if (!configured) {
      setError(
        "Password changes aren't configured in this environment. Call (908) 404-5373 for help.",
      );
      return;
    }
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError("Couldn't update the password — sign out, sign back in, and retry.");
      } else {
        setDone(true);
        formEl.reset();
      }
    } catch {
      setError("We couldn't reach the sign-in service. Please try again in a moment.");
    } finally {
      setPending(false);
    }
  }

  return (
    // P0 fail-safe: `updateUser({password})` needs the browser's authenticated
    // session, so this stays client-side — but an unhydrated GET would put the
    // new password and its confirmation in the URL. See LoginForm.
    <form onSubmit={handleSubmit} method="post">
      <div className="pform-row">
        <div className="field">
          <label htmlFor="pw-new">{tv("New password")}</label>
          <input id="pw-new" name="password" type="password" autoComplete="new-password" required minLength={8} placeholder="••••••••" />
        </div>
        <div className="field">
          <label htmlFor="pw-confirm">{tv("Confirm new password")}</label>
          <input id="pw-confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} placeholder="••••••••" />
        </div>
      </div>
      <button className="btn btn-amber btn-sm" type="submit" aria-busy={pending} disabled={pending}>
        {pending ? tv("Saving…") : tv("Change password")}
      </button>
      <div className={`form-ok${done ? " show" : ""}`} role="status">
        {tv("✓ Password updated.")}
      </div>
      <div className={`form-err${error ? " show" : ""}`} role="alert">
        {error ? tv(error) : null}
      </div>
    </form>
  );
}

export function AccountPreferencesForm({
  preferredLanguage,
  emailLoadUpdates,
  emailDocumentReviews,
  emailMarketing,
}: {
  preferredLanguage: string;
  emailLoadUpdates: boolean;
  emailDocumentReviews: boolean;
  emailMarketing: boolean;
}) {
  const tv = useV4();
  const [state, formAction, pending] = useActionState(
    updateAccountPreferences,
    initialFormState,
  );

  const checkbox = (
    name: string,
    label: string,
    defaultChecked: boolean,
  ) => (
    <label className="consent-row" style={{ padding: "4px 0", gap: 8 }}>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      <span>{tv(label)}</span>
    </label>
  );

  return (
    <form action={formAction}>
      <div className="field" style={{ marginBottom: 14, maxWidth: 280 }}>
        <label htmlFor="ap-lang">{tv("Preferred language")}</label>
        <select id="ap-lang" name="preferred_language" defaultValue={preferredLanguage}>
          {LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </div>
      <span className="psec" style={{ margin: "0 0 8px" }}>
        {tv("Email notifications")}
      </span>
      <div style={{ display: "grid", gap: 2, marginBottom: 14 }}>
        {checkbox("email_load_updates", "Load status updates", emailLoadUpdates)}
        {checkbox(
          "email_document_reviews",
          "Document review results",
          emailDocumentReviews,
        )}
        {checkbox("email_marketing", "News and offers", emailMarketing)}
      </div>
      <button className="btn btn-amber btn-sm" type="submit" aria-busy={pending} disabled={pending}>
        {pending ? tv("Saving…") : tv("Save settings")}
      </button>
      <div className={`form-ok${state.status === "success" ? " show" : ""}`} role="status">
        {state.status === "success" ? tv("✓ Saved.") : null}
      </div>
      <div className={`form-err${state.status === "error" ? " show" : ""}`} role="alert">
        {state.status === "error" && state.message ? tv(state.message) : null}
      </div>
    </form>
  );
}
