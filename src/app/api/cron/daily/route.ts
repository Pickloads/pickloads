import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { EMAIL_INTERNAL_TO, sendEmail } from "@/lib/email/send";
import { InsuranceExpiryEmail } from "@/emails/InsuranceExpiryEmail";
import {
  InternalNotification,
  type NotificationRow,
} from "@/emails/InternalNotification";

export const dynamic = "force-dynamic";

/**
 * O-01 (M-35) — daily operations cron, invoked by Vercel Cron (vercel.json,
 * 11:00 UTC = 7am ET) with `Authorization: Bearer ${CRON_SECRET}` (Vercel
 * sends the header automatically when the env var is set).
 *
 * Tasks:
 * 1. Insurance expiring ≤30 days (active carriers): carrier-facing email at
 *    the 30/14/7/3/1/0-day thresholds (not every day — a daily nag trains
 *    people to ignore it), plus ONE staff digest listing everything in the
 *    window, every run.
 * 2. Callbacks due today (open leads): one digest per assigned dispatcher,
 *    unassigned callbacks to the internal inbox.
 *
 * Uses the ADMIN client throughout: a cron has no user session, and it needs
 * auth-email lookups (profiles carries no email column). Graceful: without
 * CRON_SECRET or service credentials it returns 503 and does nothing.
 * Day boundaries are UTC — the 7am-ET run time makes "today (UTC)" align
 * with the ET working day closely enough for a digest.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const ALERT_THRESHOLDS = new Set([30, 14, 7, 3, 1, 0]);

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
  const admin = tryCreateAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Service credentials not configured" },
      { status: 503 },
    );
  }

  const now = Date.now();
  const todayUtc = new Date(now).toISOString().slice(0, 10);
  const windowEnd = new Date(now + 31 * DAY_MS).toISOString().slice(0, 10);

  /* ------------- 1. Insurance expiring ≤ 30 days ------------- */
  const { data: expiring } = await admin
    .from("carriers")
    .select("id, company_name, profile_id, insurance_expiry")
    .eq("active", true)
    .not("insurance_expiry", "is", null)
    .lte("insurance_expiry", windowEnd)
    .order("insurance_expiry", { ascending: true })
    .limit(200);

  let carrierAlerts = 0;
  const digestRows: NotificationRow[] = [];
  for (const carrier of expiring ?? []) {
    if (!carrier.insurance_expiry) continue;
    const daysLeft = Math.floor(
      (new Date(`${carrier.insurance_expiry}T00:00:00Z`).getTime() -
        new Date(`${todayUtc}T00:00:00Z`).getTime()) /
        DAY_MS,
    );
    digestRows.push({
      label: carrier.company_name,
      value: `${carrier.insurance_expiry} (${daysLeft <= 0 ? "EXPIRED" : `${daysLeft}d left`})`,
    });

    if (!ALERT_THRESHOLDS.has(daysLeft) || !carrier.profile_id) continue;
    const { data: authUser } = await admin.auth.admin.getUserById(
      carrier.profile_id,
    );
    const email = authUser?.user?.email;
    if (!email) continue;
    await sendEmail({
      to: email,
      subject:
        daysLeft <= 0
          ? "Action required: your insurance certificate has expired"
          : `Insurance renewal needed — ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`,
      template: "insurance-expiry-carrier",
      react: InsuranceExpiryEmail({
        companyName: carrier.company_name,
        expiryDate: carrier.insurance_expiry,
        daysLeft,
      }),
    });
    carrierAlerts += 1;
  }

  if (digestRows.length > 0) {
    await sendEmail({
      to: EMAIL_INTERNAL_TO,
      subject: `Insurance watch — ${digestRows.length} carrier(s) expiring ≤30d`,
      template: "insurance-expiry-digest",
      react: InternalNotification({
        eyebrow: "Daily ops cron",
        title: "Insurance expiring within 30 days",
        preview: `${digestRows.length} active carrier(s) with COI expiring soon`,
        rows: digestRows.slice(0, 40),
        footNote:
          "// Carriers at the 30/14/7/3/1/0-day thresholds were emailed directly today.",
      }),
    });
  }

  /* ------------- 2. Callbacks due today ------------- */
  const startOfDay = `${todayUtc}T00:00:00Z`;
  const endOfDay = new Date(
    new Date(startOfDay).getTime() + DAY_MS,
  ).toISOString();
  const { data: callbacks } = await admin
    .from("carrier_leads")
    .select("id, full_name, phone, status, callback_at, assigned_to")
    .not("callback_at", "is", null)
    .lt("callback_at", endOfDay)
    .not("status", "in", "(inactive,lost)")
    .order("callback_at", { ascending: true })
    .limit(200);

  const byDispatcher = new Map<string, NotificationRow[]>();
  for (const lead of callbacks ?? []) {
    const key = lead.assigned_to ?? "unassigned";
    const rows = byDispatcher.get(key) ?? [];
    const at = lead.callback_at
      ? new Date(lead.callback_at).toISOString().slice(0, 16).replace("T", " ")
      : "—";
    const overdue =
      lead.callback_at !== null &&
      new Date(lead.callback_at).getTime() < new Date(startOfDay).getTime();
    rows.push({
      label: `${lead.full_name ?? "Lead"} · ${lead.phone}`,
      value: `${at} UTC · status ${lead.status}${overdue ? " · OVERDUE" : ""}`,
    });
    byDispatcher.set(key, rows);
  }

  let callbackDigests = 0;
  for (const [dispatcherId, rows] of byDispatcher) {
    let to = EMAIL_INTERNAL_TO;
    if (dispatcherId !== "unassigned") {
      const { data: authUser } =
        await admin.auth.admin.getUserById(dispatcherId);
      to = authUser?.user?.email ?? EMAIL_INTERNAL_TO;
    }
    await sendEmail({
      to,
      subject: `Callbacks due today — ${rows.length} lead(s)`,
      template: "callbacks-due-digest",
      react: InternalNotification({
        eyebrow: "Daily ops cron",
        title:
          dispatcherId === "unassigned"
            ? "Unassigned callbacks due today"
            : "Your callbacks due today",
        preview: `${rows.length} callback(s) due — open the CRM`,
        rows: rows.slice(0, 40),
        footNote:
          "// Full context in the Leads CRM: /portal/admin/leads. Overdue items include everything unresolved before today.",
      }),
    });
    callbackDigests += 1;
  }

  return NextResponse.json({
    ok: true,
    date: todayUtc,
    insurance: {
      expiringWithin30d: digestRows.length,
      carrierAlertsSent: carrierAlerts,
      staffDigestSent: digestRows.length > 0,
    },
    callbacks: {
      dueToday: (callbacks ?? []).length,
      digestsSent: callbackDigests,
    },
  });
}
