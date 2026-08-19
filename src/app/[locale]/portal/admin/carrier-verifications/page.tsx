import type { Metadata } from "next";

import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  CarrierVerificationQueueView,
  type LegacyRow,
  type QueueRow,
} from "@/components/portal/CarrierVerificationQueueView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Carrier verifications — PickLoads",
  robots: { index: false, follow: false },
};

/**
 * M-94 — the manual-review queue. M-99 moved the MARKUP into
 * `CarrierVerificationQueueView` so it can be rendered in jsdom and measured in
 * a browser; this file is now reads and nothing else. No query, no filter and
 * no decision changed.
 *
 * ── WHY THIS PAGE EXISTS ─────────────────────────────────────────────────
 *
 * MANUAL_REVIEW is where the engine puts every case it refuses to decide alone
 * — an FMCSA timeout, a docket endpoint that was down, a legal name that
 * differs by more than punctuation — and most of those applicants are
 * legitimate carriers. A queue nobody can see is a queue nobody works.
 *
 * ── WHAT IT READS, AND WHAT IT REFUSES TO READ ───────────────────────────
 *
 * The `select` below is the enumeration of what a reviewer operationally
 * needs. It does NOT select — and the tables do not carry — `raw_response`, an
 * EIN, a physical address, an insurance filing or the FMCSA WebKey.
 *
 * ── THE READ IS COOKIE-BOUND, NOT SERVICE-ROLE ───────────────────────────
 *
 * So RLS enforces the staff check a second time, at the database, under 0032's
 * `staff manage pre registrations` policy. `requireStaff` is the gate; the
 * policy is what makes a hole in the gate not a hole in the system.
 */
export default async function CarrierVerificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const { locale } = await params;
  await requireStaff(locale);
  const { show } = await searchParams;
  const showAll = show === "all";

  const supabase = await createClient();
  let query = supabase
    .from("carrier_pre_registrations")
    .select(
      "id, created_at, legal_name_entered, usdot_number_entered, mc_number_entered, email, decision, verification_status, risk_tier, reason_codes, expires_at, claimed_carrier_id, reviewed_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  // The default view is the WORK: open manual reviews that nobody has spent.
  // "All" exists because a reviewer needs to look up what they decided last
  // week, not because the queue should show resolved rows by default.
  if (!showAll) {
    query = query.eq("decision", "manual_review").is("claimed_carrier_id", null);
  }

  const { data, error } = await query;

  const rows: QueueRow[] = (data ?? []).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    legalNameEntered: r.legal_name_entered,
    usdotNumberEntered: r.usdot_number_entered,
    mcNumberEntered: r.mc_number_entered,
    email: r.email,
    decision: r.decision,
    verificationStatus: r.verification_status,
    reasonCodes: r.reason_codes,
    expiresAt: r.expires_at,
    claimedCarrierId: r.claimed_carrier_id,
  }));

  /* ── Pre-M-94 applications that cannot finish ──────────────────────────
   *
   * Unclaimed `carriers` rows (no auth user) with no pre-registration bound to
   * them. Two queries and a filter rather than a join, because PostgREST has
   * no left-anti-join and the alternative — an RPC — would be a database
   * function to answer a question that disappears once the backlog is worked.
   *
   * `profile_id is null` is the whole of the affected set. A carrier who
   * already has an account is refused by `completeOnboarding` for an older
   * reason ("sign in instead"), so they are not listed and are not affected.
   */
  const { data: unclaimed } = await supabase
    .from("carriers")
    .select("id, company_name, mc_number, dot_number, created_at")
    .is("profile_id", null)
    .order("created_at", { ascending: false })
    .limit(50);

  const candidateIds = (unclaimed ?? []).map((c) => c.id);
  const { data: bound } = candidateIds.length
    ? await supabase
        .from("carrier_pre_registrations")
        .select("claimed_carrier_id")
        .in("claimed_carrier_id", candidateIds)
    : { data: [] };
  const boundIds = new Set(
    (bound ?? []).map((b) => b.claimed_carrier_id).filter(Boolean),
  );
  const legacy: LegacyRow[] = (unclaimed ?? [])
    .filter((c) => !boundIds.has(c.id))
    .map((c) => ({
      id: c.id,
      companyName: c.company_name,
      mcNumber: c.mc_number,
      dotNumber: c.dot_number,
      createdAt: c.created_at,
    }));

  return (
    <main id="main">
      <CarrierVerificationQueueView
        rows={rows}
        legacy={legacy}
        showAll={showAll}
        failed={Boolean(error)}
      />
    </main>
  );
}
