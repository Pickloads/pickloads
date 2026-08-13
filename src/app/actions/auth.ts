"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { portalHomeFor } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/form-state";

/**
 * P0 — portal sign-in, moved onto the server.
 *
 * ── WHY THIS ACTION EXISTS ───────────────────────────────────────────────
 *
 * `LoginForm` authenticated in the browser: `<form onSubmit={handleSubmit}>`
 * calling `supabase.auth.signInWithPassword` from a client component. The
 * handler was correct and it called `preventDefault()`. That was the entire
 * problem.
 *
 * A `<form>` with no `method` and no `action` submits **GET to its own URL**.
 * The `onSubmit` handler was the only thing standing between a password and
 * the address bar, which meant the security of the login form was contingent
 * on React hydrating successfully — every time, on every browser, before the
 * user could press Enter. When that contingency failed the browser did what
 * the markup told it to:
 *
 *     GET /login?email=<email>&password=<password> 200
 *
 * and the password was in the URL, the history, the referrer and the access
 * log. There is no partial version of this failure: either JS wins the race
 * or the credential is disclosed.
 *
 * A server action cannot fail that way. Next renders a real
 * `action="…" method="POST"` into the HTML, so the unhydrated form POSTs —
 * credentials in the body, never the query string. The fix is not "add
 * preventDefault more carefully"; it is to stop relying on JavaScript to
 * prevent a disclosure.
 *
 * ── WHY THE SERVER CLIENT AND NOT THE BROWSER ONE ────────────────────────
 *
 * `@/lib/supabase/server` is bound to the request's cookie jar, so
 * `signInWithPassword` writes the session cookies through the SSR adapter as
 * part of the POST response. Middleware and every server component see the
 * session on the very next request, with no client-side navigation needed to
 * "make the cookies stick".
 *
 * ── WHAT THIS ACTION DELIBERATELY DOES NOT RETURN ────────────────────────
 *
 * Supabase's own error text, ever. `invalid_credentials`, `email_not_confirmed`
 * and a project misconfiguration are three very different facts about an
 * account, and only the account's owner is entitled to any of them. The one
 * distinction kept is unverified-email — it is actionable, the user already
 * knows they signed up, and M-52 never auto-confirms, so without it a verified
 * signup flow dead-ends on "invalid password".
 */

/** The only credential message the client is ever given. */
const INVALID_MESSAGE = "Invalid email or password. Please try again.";
const UNVERIFIED_MESSAGE =
  "Verify your email first — click the confirmation link we sent you, then sign in.";
const UNAVAILABLE_MESSAGE =
  "We couldn't reach the sign-in service. Please try again in a moment.";
const RATE_LIMITED_MESSAGE =
  "Too many sign-in attempts from your network. Please wait a few minutes and try again — or call (908) 404-5373.";
const NOT_CONFIGURED_MESSAGE =
  "Portal sign-in is not configured in this environment. Call (908) 404-5373 for help.";

/**
 * Same-origin relative paths only — an open redirect on the login form hands
 * an attacker a credible PickLoads-branded landing page for harvested
 * sessions. `//evil.com` is a protocol-relative ABSOLUTE url, which is why
 * the second test is not redundant.
 */
function safeNext(next: string | null): string | null {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return null;
}

function isConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url) && !url?.includes("placeholder");
}

export async function signInAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const locale = String(formData.get("locale") ?? "en");
  const next = safeNext(
    typeof formData.get("next") === "string"
      ? String(formData.get("next"))
      : null,
  );

  if (!email || !password) {
    return { status: "error", message: INVALID_MESSAGE };
  }

  if (!isConfigured()) {
    return { status: "error", message: NOT_CONFIGURED_MESSAGE };
  }

  // Brute force protection. This endpoint now accepts passwords, so it needs
  // a bucket of its own — `checkRateLimit` fails OPEN on a Redis outage, so
  // an infrastructure problem degrades to Supabase's own limits rather than
  // locking every customer out of the portal.
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  if (!(await checkRateLimit("login", ip))) {
    return { status: "error", message: RATE_LIMITED_MESSAGE };
  }

  let role: Parameters<typeof portalHomeFor>[0];
  let suspended = false;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      // The message is inspected, never forwarded.
      return {
        status: "error",
        message: /confirm/i.test(error?.message ?? "")
          ? UNVERIFIED_MESSAGE
          : INVALID_MESSAGE,
      };
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, status")
      .eq("id", data.user.id)
      .maybeSingle();

    if (!profile) {
      // Authenticated with no profile row: the signup trigger did not run.
      // Not the user's fault and not a credential problem, but there is no
      // portal to send them to, so the session is dropped rather than left
      // half-established.
      await supabase.auth.signOut();
      return { status: "error", message: UNAVAILABLE_MESSAGE };
    }

    // Suspension is enforced by `requireProfile` on every portal page. Left
    // to that alone, a suspended user would sign in, get bounced, and land
    // back here — so it is resolved before the redirect instead.
    suspended = profile.status === "suspended";
    role = profile.role;
  } catch {
    return { status: "error", message: UNAVAILABLE_MESSAGE };
  }

  // `redirect()` throws NEXT_REDIRECT, so it must be outside the try — inside,
  // the catch above would swallow the control flow and report a service
  // outage on a successful sign-in.
  if (suspended) {
    redirect(`${getPathname({ href: "/login", locale })}?error=suspended`);
  }
  redirect(getPathname({ href: next ?? portalHomeFor(role), locale }));
}
