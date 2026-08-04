"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import { createClient } from "@/lib/supabase/client";

/**
 * M-02b portal sign-in. Auth flows are the one legitimate browser-client
 * surface (decision Q3 — the anon key still writes no tables). On success we
 * do a full navigation so the middleware sees the fresh session cookies.
 */

/**
 * Only same-origin relative paths — prevents open-redirect via ?next=.
 * M-54: the fallback is /portal (the server-side role router), so every
 * role — carrier/shipper/dispatcher/admin — lands on its own home.
 */
function safeNext(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/portal";
}

export function LoginForm() {
  const tv = useV4();
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // M-52: landing spot of the Supabase email-verification link.
  const verified = searchParams.get("verified") === "1";
  // M-54: clear auth states — expired session (middleware-detected stale
  // cookies), suspension (requireProfile bounce), plain auth-wall redirect.
  const expired = searchParams.get("expired") === "1";
  const suspended = searchParams.get("error") === "suspended";
  const hasNext = searchParams.get("next") !== null;

  const configured =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("placeholder");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!configured) {
      setError(
        "Portal sign-in is not configured in this environment. Call (908) 404-5373 for help.",
      );
      return;
    }
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (authError) {
        // M-54: distinguish the unverified-email state (M-52 signups are
        // never auto-confirmed) from bad credentials.
        setError(
          /confirm/i.test(authError.message)
            ? "Verify your email first — click the confirmation link we sent you, then sign in."
            : "Invalid email or password. Please try again.",
        );
        setPending(false);
        return;
      }
      // Full navigation: middleware + server components must see the cookies.
      window.location.assign(safeNext(searchParams.get("next")));
    } catch {
      setError(
        "We couldn't reach the sign-in service. Please try again in a moment.",
      );
      setPending(false);
    }
  }

  return (
    <div className="bigform" style={{ maxWidth: 460, margin: "44px auto 0" }}>
      <h2>{tv("Carrier & staff sign in")}</h2>
      <p>{tv("Access your documents, agreement status and dispatch tools.")}</p>
      {verified ? (
        <div className="form-ok show" role="status" style={{ marginBottom: 18 }}>
          {tv("✓ Email verified — you can sign in now.")}
        </div>
      ) : null}
      {suspended ? (
        <div className="form-err show" role="alert" style={{ marginBottom: 18 }}>
          {tv(
            "Your account is suspended. Call (908) 404-5373 or email support@pickloads.com to resolve it.",
          )}
        </div>
      ) : expired ? (
        <div className="form-err show" role="alert" style={{ marginBottom: 18 }}>
          {tv("Your session expired — sign in again to continue.")}
        </div>
      ) : hasNext ? (
        <p className="mono" style={{ fontSize: ".74rem", margin: "0 0 18px" }}>
          {"// "}
          {tv("Sign in to continue where you left off.")}
        </p>
      ) : null}
      <form onSubmit={handleSubmit}>
        <div className="field" style={{ marginBottom: 16 }}>
          <label htmlFor="login-email">{tv("Email")}</label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
          />
        </div>
        <div className="field" style={{ marginBottom: 8 }}>
          <label htmlFor="login-password">{tv("Password")}</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            aria-describedby="login-err"
          />
        </div>
        <p style={{ textAlign: "right", margin: "0 0 20px", fontSize: ".82rem" }}>
          <Link
            href="/forgot-password"
            style={{ color: "var(--color-amber-aa)", textDecoration: "underline" }}
          >
            {tv("Forgot password?")}
          </Link>
        </p>
        <button
          className="btn btn-amber"
          type="submit"
          aria-busy={pending}
          disabled={pending}
          style={{ width: "100%" }}
        >
          {pending ? tv("Signing in…") : tv("Sign In →")}
        </button>
      </form>
      <div
        id="login-err"
        className={`form-err${error ? " show" : ""}`}
        role="alert"
      >
        {error ? tv(error) : null}
      </div>
      <p className="mono" style={{ fontSize: ".72rem", marginTop: 22 }}>
        {"// "}
        {tv("New here? Onboard first — it takes about 10 minutes.")}{" "}
        <Link
          href="/become-a-carrier"
          style={{ color: "var(--color-amber-aa)", textDecoration: "underline" }}
        >
          {tv("Become a Carrier")}
        </Link>
      </p>
    </div>
  );
}
