import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditEvent } from "@/lib/audit";
import { getSessionProfile, isStaffRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * M-97 — journal a staff MFA event, from a surface that cannot log anybody out.
 *
 * ── WHY THIS IS A ROUTE HANDLER AND NOT A SERVER ACTION ──────────────────
 *
 * It was a Server Action, and that is what broke the login.
 *
 * A Server Action called from a client component POSTs to the CURRENT route
 * and Next re-renders that route with the response. The current route here is
 * `/portal/admin/mfa`, whose first line is `requireStaffNoMfa()` — and
 * `requireProfile()` inside it calls `redirect("/login")` when the request
 * carries no readable session. So the sequence was:
 *
 *   mfa.verify() succeeds → Supabase rotates the auth cookies client-side
 *   → this call POSTs immediately, mid-rotation
 *   → the re-render sees no session → redirect("/login")
 *   → Next answers the action POST with 303 → the browser follows it
 *   → the admin lands on /login having just completed MFA correctly.
 *
 * The audit write itself never failed. A best-effort journal entry was simply
 * sitting on the critical path of an auth transition, holding the power to
 * redirect. A Route Handler has neither property: it renders no page, so no
 * page gate can fire, and it is outside the middleware matcher (`api|…` in
 * `src/middleware.ts`), so no middleware redirect can fire either. It returns
 * a status code and nothing else.
 *
 * ── WHAT IT STILL ENFORCES ───────────────────────────────────────────────
 *
 * Everything the action did. Identity is re-derived from the request cookies
 * via `getUser()` — never from the body — and only staff may write. The body
 * carries one value from a two-item enum and cannot carry a factor id, a
 * secret, or anything else.
 */

const bodySchema = z.object({
  kind: z.enum(["enrolled", "verified"]),
});

export async function POST(request: Request) {
  /**
   * Same-origin only. The impact of a forged call is small — a spurious audit
   * row for a signed-in staff member — but an endpoint that writes to the
   * security ledger should not accept a cross-site POST, and the check costs
   * one header comparison.
   */
  const origin = request.headers.get("origin");
  if (origin) {
    const host = request.headers.get("host");
    let sameOrigin = false;
    try {
      sameOrigin = new URL(origin).host === host;
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }
  }

  let parsed;
  try {
    parsed = bodySchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Server-side identity. `getSessionProfile()` authenticates through
  // `supabase.auth.getUser()`, which contacts the Auth server — the request
  // body has no say in who this is.
  const session = await getSessionProfile();
  if (!session || !isStaffRole(session.role)) {
    // 204 either way: this endpoint reports nothing about who is signed in,
    // and a caller learning "you are not staff" from a journaling endpoint is
    // a needless oracle. Nothing is written.
    return new NextResponse(null, { status: 204 });
  }

  await recordAuditEvent({
    actorId: session.userId,
    action:
      parsed.data.kind === "enrolled"
        ? "staff.mfa_enrolled"
        : "staff.mfa_verified",
    targetTable: "profiles",
    targetId: session.userId,
    detail: { role: session.role },
  });

  return new NextResponse(null, { status: 204 });
}
