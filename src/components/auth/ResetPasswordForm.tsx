"use client";

import { useEffect, useMemo, useState } from "react";
import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import { createClient } from "@/lib/supabase/client";

/**
 * M-42 password recovery, step 2: set the new password.
 * The visitor arrives from the Supabase recovery email; the browser client
 * (detectSessionInUrl) exchanges the code in the URL for a recovery session
 * on load, after which `updateUser` may set a new password. Without a valid
 * session (expired/used link, or placeholder env) the form degrades to a
 * clear error instead of a dead end.
 */
export function ResetPasswordForm() {
  const tv = useV4();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  const configured = useMemo(
    () =>
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("placeholder"),
    [],
  );

  useEffect(() => {
    if (!configured) {
      setHasSession(false);
      return;
    }
    const supabase = createClient();
    let cancelled = false;
    // The code exchange may still be in flight on first render — subscribe
    // so PASSWORD_RECOVERY / SIGNED_IN flips the form live.
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setHasSession((prev) => prev ?? Boolean(data.session));
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!cancelled && session) setHasSession(true);
      },
    );
    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [configured]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!configured) {
      setError(
        "Password reset is not configured in this environment. Call (908) 404-5373 for help.",
      );
      return;
    }
    const form = new FormData(e.currentTarget);
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
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) {
        setError(
          "This reset link is invalid or has expired. Request a new one below.",
        );
        setPending(false);
        return;
      }
      setDone(true);
      setPending(false);
    } catch {
      setError(
        "We couldn't reach the sign-in service. Please try again in a moment.",
      );
      setPending(false);
    }
  }

  return (
    <div className="bigform" style={{ maxWidth: 460, margin: "44px auto 0" }}>
      <h2>{tv("Choose a new password")}</h2>
      <p>
        {tv(
          "Minimum 8 characters. You'll stay signed in on this device after saving.",
        )}
      </p>
      {hasSession === false && !done ? (
        <div className="form-err show" role="alert">
          {tv(
            "This reset link is invalid or has expired. Request a new one below.",
          )}
        </div>
      ) : null}
      <form onSubmit={handleSubmit}>
        <div className="field" style={{ marginBottom: 16 }}>
          <label htmlFor="reset-password">{tv("New password")}</label>
          <input
            id="reset-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="••••••••"
          />
        </div>
        <div className="field" style={{ marginBottom: 20 }}>
          <label htmlFor="reset-confirm">{tv("Confirm new password")}</label>
          <input
            id="reset-confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="••••••••"
            aria-describedby="reset-err"
          />
        </div>
        <button
          className="btn btn-amber"
          type="submit"
          aria-busy={pending}
          disabled={pending || done}
          style={{ width: "100%" }}
        >
          {pending ? tv("Saving…") : tv("Save New Password →")}
        </button>
      </form>
      <div className={`form-ok${done ? " show" : ""}`} role="status">
        {tv("✓ Password updated. You're signed in — head to your portal.")}{" "}
        <Link
          href="/portal"
          style={{ color: "inherit", textDecoration: "underline" }}
        >
          {tv("Open portal →")}
        </Link>
      </div>
      <div
        id="reset-err"
        className={`form-err${error ? " show" : ""}`}
        role="alert"
      >
        {error ? tv(error) : null}
      </div>
      <p className="mono" style={{ fontSize: ".72rem", marginTop: 22 }}>
        {"// "}
        {tv("Link expired?")}{" "}
        <Link
          href="/forgot-password"
          style={{ color: "var(--amber-deep)", textDecoration: "underline" }}
        >
          {tv("Request a new reset link")}
        </Link>
      </p>
    </div>
  );
}
