"use client";

import { useActionState } from "react";
import { useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import { signInAction } from "@/app/actions/auth";
import { initialFormState } from "@/lib/form-state";

/**
 * M-02b portal sign-in.
 *
 * ── P0: THIS FORM USED TO SUBMIT PASSWORDS BY GET ────────────────────────
 *
 * It was `<form onSubmit={handleSubmit}>` around a client-side
 * `signInWithPassword`. A `<form>` with no `method` and no `action` submits
 * **GET to its own URL**, so `preventDefault()` inside the handler was the
 * only thing keeping the password out of the address bar — and only for as
 * long as React had finished hydrating. When it had not:
 *
 *     GET /login?email=<email>&password=<password> 200
 *
 * Now the form posts to `signInAction`. Next renders a real
 * `method="POST"` into the HTML, so the browser POSTs whether or not the
 * JavaScript ever arrives; the credential travels in the request body and
 * cannot reach a query string, a history entry, a referrer or an access log.
 *
 * **Do not reintroduce `onSubmit` here, and do not add `method`/`encType`.**
 * React owns the submission contract for a function action and renders POST
 * itself; setting it by hand only produces a warning. Authentication is the
 * one form where the no-JS path has to be safe by construction rather than by
 * handler, and the server action is what makes it so.
 *
 * Role routing, session cookies and error wording all live in the action:
 * `src/app/actions/auth.ts`.
 */

export function LoginForm() {
  const tv = useV4();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [state, formAction, pending] = useActionState(
    signInAction,
    initialFormState,
  );
  const error = state.status === "error" ? (state.message ?? null) : null;
  // M-52: landing spot of the Supabase email-verification link.
  const verified = searchParams.get("verified") === "1";
  // M-54: clear auth states — expired session (middleware-detected stale
  // cookies), suspension (requireProfile bounce), plain auth-wall redirect.
  const expired = searchParams.get("expired") === "1";
  const suspended = searchParams.get("error") === "suspended";
  const nextParam = searchParams.get("next");
  const hasNext = nextParam !== null;

  return (
    <div className="bigform" style={{ maxWidth: 460, margin: "44px auto 0" }}>
      {/* P0/8: this read "Carrier & staff sign in", and BOTH signup flows send
          their verification link here (`?verified=1`). A shipper who had just
          confirmed their email landed on a form that did not mention shippers
          and appeared to be for somebody else. One login page serves every
          role — the destination was right, the heading was wrong. */}
      <h2>{tv("Sign in to your portal")}</h2>
      <p>
        {tv(
          "Carriers, shippers and staff — one sign-in for documents, quotes and dispatch tools.",
        )}
      </p>
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
      {/* NO `method` or `encType` here, deliberately.

          The P0 fix added `method="post"` as a fail-safe. It was redundant and
          wrong: when `action` is a function, React OWNS the submission
          contract and renders `method="POST"` (plus the multipart encType and
          the action reference fields) into the HTML itself — which is what
          makes the unhydrated form POST. Setting it by hand does not add a
          guarantee, it fights the one already there, and React says so:
          "Cannot specify a encType or method for a form that specifies a
          function as the action."

          The no-GET guarantee is unchanged and still tested — but it is
          asserted against the RENDERED html (tests/e2e/login-post.spec.ts),
          which is where it actually lives, rather than against an attribute
          in this file. */}
      <form action={formAction}>
        <input type="hidden" name="locale" value={locale} />
        {nextParam ? (
          <input type="hidden" name="next" value={nextParam} />
        ) : null}
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
