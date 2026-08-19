"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toRenderableQrSrc } from "@/lib/mfa-qr";

/**
 * Journal the security event WITHOUT a server action.
 *
 * This was `await recordMfaEnrollment(...)`, a Server Action — which POSTs to
 * the current route and makes Next re-render it. The current route is
 * `/portal/admin/mfa`, gated by `requireStaffNoMfa()`, so when the POST landed
 * mid-cookie-rotation (immediately after `verify()` swapped the tokens for
 * AAL2 ones) the re-render found no session, called `redirect("/login")`, and
 * Next answered the action with 303. The admin was bounced to the login page
 * having just passed MFA.
 *
 * A route handler renders no page and sits outside the middleware matcher, so
 * there is no gate left that could redirect. And it is deliberately
 * best-effort: the factor is already active whatever happens here, so a failed
 * journal entry must never cost the user their navigation.
 */
async function journalMfaEvent(kind: "enrolled" | "verified"): Promise<void> {
  try {
    await fetch("/api/portal/mfa-journal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind }),
      credentials: "same-origin",
    });
  } catch {
    /* best effort — see above */
  }
}

/**
 * M-61 — staff TOTP enrollment + step-up challenge (audit §6.1 / decision D3).
 *
 * Two jobs on one surface, because a gated admin can arrive in either state:
 *   1. NO verified factor  → enroll: `mfa.enroll({factorType:'totp'})` returns
 *      `totp.qr_code` (an SVG the caller renders) + `totp.secret` for manual
 *      entry; the 6-digit code is then confirmed with challenge + verify.
 *   2. Verified factor but this session is AAL1 → challenge + verify only
 *      (step-up), no new factor.
 *
 * All calls run against the BROWSER client: enrolling writes to the caller's
 * own auth user, and `verify` mints the AAL2 token that must land in this
 * browser's session cookies. On success we hard-navigate so the server
 * re-reads the upgraded session and the gate opens.
 *
 * Styling is V4/portal.css vocabulary only (.pcard/.field/.btn/.form-ok/
 * .form-err/.pbadge) — no new colors, no new tokens.
 */

type Phase = "idle" | "enrolling" | "confirming" | "done";

export function MfaEnrollment({
  configured,
  hasVerifiedFactor,
  friendlyName,
  returnTo,
}: {
  configured: boolean;
  hasVerifiedFactor: boolean;
  friendlyName: string;
  returnTo: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The normalized, renderable data URL — never the provider's raw payload. */
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  /**
   * The image was handed a source and still failed to paint.
   *
   * This exists because the reported bug was invisible: enrollment succeeded,
   * the QR frame rendered, and the picture inside it was blank on a
   * same-coloured card — indistinguishable from the button doing nothing. A
   * QR that cannot be shown must now SAY so and hand over the manual key.
   */
  const [qrFailed, setQrFailed] = useState(false);

  async function startEnrollment() {
    setError(null);
    setPending(true);
    try {
      const supabase = createClient();
      // A previous abandoned attempt leaves an `unverified` factor behind and
      // the next enroll would collide on the friendly name — clear those out.
      const existing = await supabase.auth.mfa.listFactors();
      for (const factor of existing.data?.all ?? []) {
        if (factor.status !== "verified") {
          await supabase.auth.mfa.unenroll({ factorId: factor.id });
        }
      }
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName,
      });
      if (enrollError || !data) {
        setError(
          "Couldn't start enrollment. Sign out, sign back in, and try again.",
        );
        return;
      }
      /**
       * `totp` is optional on the response union (the phone factor variant
       * has no `totp`), so it is checked rather than assumed. Reading
       * `data.totp.qr_code` off a phone-shaped response would throw inside
       * the try and surface as "we couldn't reach the sign-in service" — a
       * message that would send somebody to look at their network.
       */
      const totp = data.totp;
      if (!totp) {
        setError(
          "Enrollment came back in a form we can't display. Nothing was changed — please contact your administrator.",
        );
        return;
      }
      setFactorId(data.id);
      // Normalized HERE, once, so no render path can ever be handed the
      // provider's unencoded payload. See src/lib/mfa-qr.ts.
      setQrSrc(toRenderableQrSrc(totp.qr_code));
      setSecret(totp.secret ?? null);
      setQrFailed(false);
      setPhase("enrolling");
    } catch {
      setError("We couldn't reach the sign-in service. Try again in a moment.");
    } finally {
      setPending(false);
    }
  }

  async function submitCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setPending(true);
    try {
      const supabase = createClient();
      let targetFactor = factorId;
      if (!targetFactor) {
        // Step-up path: challenge the already-verified factor.
        const list = await supabase.auth.mfa.listFactors();
        targetFactor =
          list.data?.totp.find((f) => f.status === "verified")?.id ?? null;
      }
      if (!targetFactor) {
        setError("No authenticator is registered on this account yet.");
        return;
      }
      const challenge = await supabase.auth.mfa.challenge({
        factorId: targetFactor,
      });
      if (challenge.error || !challenge.data) {
        setError("Couldn't start the verification. Try again.");
        return;
      }
      const verified = await supabase.auth.mfa.verify({
        factorId: targetFactor,
        challengeId: challenge.data.id,
        code,
      });
      if (verified.error) {
        // Deliberately generic: never echo the provider's message, which can
        // carry factor ids and timing hints.
        setError("That code didn't match. Check your app's clock and retry.");
        return;
      }
      setPhase("done");
      await journalMfaEvent(phase === "enrolling" ? "enrolled" : "verified");
      // The hard navigation is what makes the SERVER re-read the upgraded
      // session and open the gate. Nothing between `verify()` and here is
      // allowed to redirect, or the upgrade is lost on the way out.
      window.location.assign(returnTo);
    } catch {
      setError("We couldn't reach the sign-in service. Try again in a moment.");
    } finally {
      setPending(false);
    }
  }

  if (!configured) {
    return (
      <div className="pcard">
        <h2>Two-factor authentication</h2>
        <p className="pempty" style={{ padding: 0 }}>
          Multi-factor enrollment needs a live Supabase project. This
          environment runs on placeholder credentials, so no authenticator can
          be registered and no staff route is gated. Set{" "}
          <code>NEXT_PUBLIC_SUPABASE_URL</code> /{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> and enable TOTP under
          Authentication → Multi-Factor in the Supabase dashboard.
        </p>
      </div>
    );
  }

  const showCodeForm = phase === "enrolling" || hasVerifiedFactor;

  return (
    <div className="pcard">
      <h2>{hasVerifiedFactor ? "Confirm it's you" : "Set up two-factor authentication"}</h2>

      {!hasVerifiedFactor && phase === "idle" ? (
        <>
          <p style={{ fontSize: ".9rem", color: "#cfd6da", marginBottom: 14 }}>
            Install an authenticator app (1Password, Authy, Google
            Authenticator), then generate your QR code below. You&apos;ll need a
            code from the app every time you sign in.
          </p>
          <button
            className="btn btn-amber btn-sm"
            type="button"
            onClick={() => void startEnrollment()}
            aria-busy={pending}
            disabled={pending}
          >
            {pending ? "Generating…" : "Generate QR code"}
          </button>
        </>
      ) : null}

      {phase === "enrolling" ? (
        <div style={{ marginBottom: 16 }} data-testid="mfa-enroll-panel">
          {qrSrc && !qrFailed ? (
            <div
              style={{
                background: "var(--paper)",
                display: "inline-block",
                padding: 10,
                borderRadius: 8,
                border: "1px solid var(--line)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- a data:
                  URL from the auth provider. next/image would proxy a
                  secret-bearing payload through the optimizer, and an <img>
                  renders SVG with scripting disabled, which is what makes an
                  untrusted document safe to show at all. */}
              <img
                src={qrSrc}
                alt="QR code for your authenticator app"
                width={200}
                height={200}
                onError={() => setQrFailed(true)}
              />
            </div>
          ) : (
            /* No renderable QR. The manual key below is the whole setup path
               now, so say so plainly instead of leaving an empty frame that
               reads as a broken button. */
            <p className="form-err show" role="status">
              The QR image couldn&apos;t be displayed. Use the setup key below —
              it works exactly the same way.
            </p>
          )}
          {secret ? (
            <p
              className="mono"
              style={{ fontSize: ".72rem", color: "var(--steel)", marginTop: 10 }}
            >
              {qrSrc && !qrFailed
                ? "Can't scan? Enter this key manually: "
                : "Enter this setup key in your authenticator app: "}
              <span style={{ color: "var(--amber)", overflowWrap: "anywhere" }}>
                {secret}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}

      {showCodeForm ? (
        // P0 fail-safe: a TOTP code is a credential. The MFA challenge is
        // inherently browser-side, so this keeps `onSubmit` — but not the GET
        // fallback that would log the code in the URL. See LoginForm.
        <form onSubmit={submitCode} method="post">
          <div className="field" style={{ maxWidth: 220 }}>
            <label htmlFor="mfa-code">6-digit code</label>
            <input
              id="mfa-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              placeholder="000000"
            />
          </div>
          <button
            className="btn btn-amber btn-sm"
            type="submit"
            aria-busy={pending}
            disabled={pending}
            style={{ marginTop: 12 }}
          >
            {pending ? "Verifying…" : hasVerifiedFactor ? "Verify and continue" : "Activate"}
          </button>
        </form>
      ) : null}

      <div className={`form-ok${phase === "done" ? " show" : ""}`} role="status">
        ✓ Two-factor authentication is active. Returning to the desk…
      </div>
      <div className={`form-err${error ? " show" : ""}`} role="alert">
        {error}
      </div>
    </div>
  );
}
