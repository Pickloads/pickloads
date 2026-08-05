import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { applyUnsubscribe } from "@/lib/newsletter-unsubscribe";
import {
  isUnsubscribeSuccess,
  normalizeUnsubscribeToken,
  ONE_CLICK_BODY,
  UNSUBSCRIBE_PATH,
} from "@/lib/newsletter";

/**
 * M-69 / P-1 — RFC 8058 one-click unsubscribe endpoint.
 *
 * This is the URI advertised in the `List-Unsubscribe` header of every
 * marketing send, paired with `List-Unsubscribe-Post: List-Unsubscribe=
 * One-Click`. Gmail and Yahoo bulk-sender requirements make the pair
 * mandatory; the mailbox provider POSTs here on the recipient's behalf when
 * they hit the provider's own "unsubscribe" affordance.
 *
 * Deliberate properties:
 *   * GET NEVER MUTATES. It redirects to the locale-aware confirmation page,
 *     where a human presses a button. Outlook Safe Links, Proofpoint and
 *     friends prefetch every URL in an email — a GET side effect would
 *     unsubscribe people who never clicked anything.
 *   * IDEMPOTENT. Repeat POSTs return 200 (`already`), because providers
 *     retry and a 4xx on retry reads as a broken opt-out.
 *   * Token-only, never an email address in the URL — no enumeration oracle.
 *   * Rate limited per IP (generously: one provider egress IP can legitimately
 *     carry many unsubscribes).
 *   * Returns text/plain, no redirect on POST: RFC 8058 §3.2 says the response
 *     body is not shown to the user, and providers dislike redirects here.
 */
function callerIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function GET(request: NextRequest) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin;
  const token = request.nextUrl.searchParams.get("token");
  const target = new URL(UNSUBSCRIBE_PATH, siteUrl);
  if (token) target.searchParams.set("token", token);
  return NextResponse.redirect(target);
}

export async function POST(request: NextRequest) {
  // Token may arrive on the query string (how we advertise it) or in the
  // form body (some providers echo the whole thing) — accept both.
  let token = normalizeUnsubscribeToken(
    request.nextUrl.searchParams.get("token"),
  );
  let oneClick = false;

  const contentType = request.headers.get("content-type") ?? "";
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    try {
      const form = await request.formData();
      oneClick = form.get("List-Unsubscribe") === "One-Click";
      token ??= normalizeUnsubscribeToken(form.get("token"));
    } catch {
      // Malformed body — fall through on the query-string token.
    }
  } else if (contentType.includes("text/plain")) {
    try {
      oneClick = (await request.text()).trim() === ONE_CLICK_BODY;
    } catch {
      /* ignore */
    }
  }

  if (!token) {
    return new NextResponse("Invalid or missing unsubscribe token.\n", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  if (!(await checkRateLimit("newsletter-unsubscribe-oneclick", callerIp(request), 60))) {
    return new NextResponse("Too many requests.\n", {
      status: 429,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const outcome = await applyUnsubscribe(token);

  if (isUnsubscribeSuccess(outcome)) {
    return new NextResponse("Unsubscribed.\n", {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        // Records that the provider used the RFC 8058 path, for support
        // triage. No PII, no token.
        "x-unsubscribe-mode": oneClick ? "one-click" : "direct",
      },
    });
  }
  if (outcome === "invalid") {
    return new NextResponse("Invalid or missing unsubscribe token.\n", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  // `unavailable` — the list could not be reached. 503 is honest and tells
  // the provider to retry, which our idempotency makes safe.
  return new NextResponse("Subscriber list unavailable — please retry.\n", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
