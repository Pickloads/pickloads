import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runNotificationWorker } from "@/lib/shipments/notification-worker";

export const dynamic = "force-dynamic";

/**
 * M-79 — the shipment-notification WORKER ROUTE
 * (`docs/DIRECTIVE-tracking.md` §17, §25, §26).
 *
 * §25 requires a *"background notification processing architecture"*. This is
 * its entry point: the queue is drained here, on a schedule, by a request that
 * carries no user session and no user data — never inside the request that
 * caused the shipment to move.
 *
 * ── THE GUARD IS M-35'S, VERBATIM ─────────────────────────────────────────
 *
 * `Authorization: Bearer ${CRON_SECRET}`, compared in CONSTANT TIME, with a
 * 503 when the secret is unset and a 401 when it does not match. The pattern
 * is copied from `src/app/api/cron/daily/route.ts` on purpose rather than
 * improved: two cron routes that authenticate differently is how one of them
 * ends up weaker, and Vercel sends the header automatically for both.
 *
 * A constant-time compare matters more here than on a digest cron. This
 * endpoint SENDS MAIL. A timing oracle on the secret would let an attacker
 * recover it and then drain — or replay — a customer's notification queue.
 *
 * ── WHY GET ───────────────────────────────────────────────────────────────
 *
 * Vercel Cron issues GET. The operation is not idempotent in the HTTP sense —
 * it sends email — but every row it touches is idempotent in the DOMAIN sense:
 * a claimed row cannot be claimed twice, a settled row is terminal, and a
 * duplicate enqueue collapses on the unique key. Two overlapping invocations
 * therefore split the batch rather than double-sending it, which is exactly
 * what `for update skip locked` buys.
 *
 * ── WHAT IT RETURNS ───────────────────────────────────────────────────────
 *
 * Counts only. No addresses, no tracking numbers, no payloads, no error
 * bodies — §26's never-log list applies to a response body that lands in a
 * Vercel log as much as to a `console.error`. `notes` carries machine codes
 * (`claim write_failed`), never provider text.
 */

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const received = Buffer.from(header, "utf8");
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "Cron not configured (CRON_SECRET)" },
      { status: 503 },
    );
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runNotificationWorker();

  // A run that could not reach the database is a 503, not a green 200 with
  // zeros in it: the honest-states rule the whole product is held to applies
  // to a health-checkable endpoint more than anywhere else.
  return NextResponse.json(summary, { status: summary.ok ? 200 : 503 });
}
