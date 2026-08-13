"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import { createClient } from "@/lib/supabase/client";

/**
 * M-42 password recovery, step 1: request the reset email.
 * Same surface rules as LoginForm (the one legitimate browser-client auth
 * flow, decision Q3) and the same graceful degradation when Supabase env is
 * placeholder/unset. Always reports success on a accepted request — never
 * confirms whether an account exists (no enumeration).
 */
export function ForgotPasswordForm() {
  const tv = useV4();
  const locale = useLocale();
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configured =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("placeholder");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!configured) {
      setError(
        "Password reset is not configured in this environment. Call (908) 404-5373 for help.",
      );
      return;
    }
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    // Keep the visitor's locale through the round-trip (localePrefix
    // "as-needed": en has no prefix).
    const prefix = locale === "en" ? "" : `/${locale}`;
    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email,
        { redirectTo: `${window.location.origin}${prefix}/reset-password` },
      );
      if (resetError) {
        setError(
          "We couldn't send the reset email. Please wait a minute and try again.",
        );
        setPending(false);
        return;
      }
      setSent(true);
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
      <h2>{tv("Reset your password")}</h2>
      <p>
        {tv(
          "Enter the email you signed up with — we'll send you a secure reset link.",
        )}
      </p>
      {/* P0 fail-safe: no password here, but an unhydrated GET would still put
          the account's email address in the URL and the access log. Same rule,
          same one-word fix. See LoginForm. */}
      <form onSubmit={handleSubmit} method="post">
        <div className="field" style={{ marginBottom: 20 }}>
          <label htmlFor="forgot-email">{tv("Email")}</label>
          <input
            id="forgot-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
            aria-describedby="forgot-err"
          />
        </div>
        <button
          className="btn btn-amber"
          type="submit"
          aria-busy={pending}
          disabled={pending || sent}
          style={{ width: "100%" }}
        >
          {pending ? tv("Sending…") : tv("Send Reset Link →")}
        </button>
      </form>
      <div className={`form-ok${sent ? " show" : ""}`} role="status">
        {tv(
          "✓ If an account exists for that email, a reset link is on its way. Check your inbox (and spam folder).",
        )}
      </div>
      <div
        id="forgot-err"
        className={`form-err${error ? " show" : ""}`}
        role="alert"
      >
        {error ? tv(error) : null}
      </div>
      <p className="mono" style={{ fontSize: ".72rem", marginTop: 22 }}>
        {"// "}
        {tv("Remembered it?")}{" "}
        <Link
          href="/login"
          style={{ color: "var(--color-amber-aa)", textDecoration: "underline" }}
        >
          {tv("Back to sign in")}
        </Link>
      </p>
    </div>
  );
}
