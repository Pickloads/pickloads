import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  CarrierVerificationDetailView,
  type VerificationCheck,
  type VerificationDetail,
} from "@/components/portal/CarrierVerificationDetailView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Carrier verification — PickLoads",
  robots: { index: false, follow: false },
};

/**
 * M-94 — one application, with the evidence behind its decision. M-99 moved
 * the MARKUP into `CarrierVerificationDetailView`; the reads are unchanged.
 *
 * ── WHAT A REVIEWER IS SHOWN ─────────────────────────────────────────────
 *
 * Three things, because the decision is a comparison: what the applicant
 * TYPED (never overwritten — that is why 0032 stores it separately), what
 * FMCSA RETURNED normalized, and what the ENGINE concluded as reason codes.
 *
 * ── AND WHAT IS NOT HERE ─────────────────────────────────────────────────
 *
 * No raw FMCSA payload — it is never stored, only a SHA-256 digest is, and the
 * digest is shown truncated as provenance rather than as data. No EIN and no
 * physical address: both are in the live FMCSA response and both are dropped
 * at the adapter boundary, so there is no column here that could render them.
 * No WebKey, which exists only in `process.env` inside a `server-only` module.
 *
 * No insurance filing is shown as a compliance signal. FMCSA's bipd/cargo/bond
 * indicators are normalized by M-93 and deliberately not persisted, because a
 * federal filing beside a COI status invites exactly the merge §10 forbids.
 */
export default async function CarrierVerificationDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  await requireStaff(locale);

  const supabase = await createClient();

  const { data: pre } = await supabase
    .from("carrier_pre_registrations")
    .select(
      "id, created_at, updated_at, expires_at, legal_name_entered, usdot_number_entered, mc_number_entered, email, phone, locale, decision, verification_status, risk_tier, manual_review_required, reason_codes, payment_status, claimed_carrier_id, claimed_at, reviewed_by, reviewed_at, review_note",
    )
    .eq("id", id)
    .maybeSingle();

  if (!pre) notFound();

  const { data: checks } = await supabase
    .from("carrier_verifications")
    .select(
      "id, provider, provider_record_id, status, legal_name, dba_name, usdot_number, mc_number, allowed_to_operate, out_of_service, out_of_service_date, name_match, mc_match, dot_match, raw_response_sha256, checked_at, source_retrieved_at",
    )
    .eq("pre_registration_id", id)
    .order("checked_at", { ascending: false })
    .limit(5);

  const row = checks?.[0] ?? null;

  const { data: reviewer } = pre.reviewed_by
    ? await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", pre.reviewed_by)
        .maybeSingle()
    : { data: null };

  const detail: VerificationDetail = {
    id: pre.id,
    createdAt: pre.created_at,
    expiresAt: pre.expires_at,
    legalNameEntered: pre.legal_name_entered,
    usdotNumberEntered: pre.usdot_number_entered,
    mcNumberEntered: pre.mc_number_entered,
    email: pre.email,
    phone: pre.phone,
    decision: pre.decision,
    verificationStatus: pre.verification_status,
    riskTier: pre.risk_tier,
    reasonCodes: pre.reason_codes,
    paymentStatus: pre.payment_status,
    claimedCarrierId: pre.claimed_carrier_id,
    claimedAt: pre.claimed_at,
    reviewedAt: pre.reviewed_at,
    reviewNote: pre.review_note,
    reviewerName: reviewer?.full_name ?? null,
  };

  const latest: VerificationCheck | null = row
    ? {
        legalName: row.legal_name,
        dbaName: row.dba_name,
        usdotNumber: row.usdot_number,
        mcNumber: row.mc_number,
        allowedToOperate: row.allowed_to_operate,
        outOfService: row.out_of_service,
        outOfServiceDate: row.out_of_service_date,
        nameMatch: row.name_match,
        mcMatch: row.mc_match,
        dotMatch: row.dot_match,
        rawResponseSha256: row.raw_response_sha256,
        checkedAt: row.checked_at,
        sourceRetrievedAt: row.source_retrieved_at,
      }
    : null;

  return (
    <main id="main">
      <CarrierVerificationDetailView pre={detail} latest={latest} />
    </main>
  );
}
