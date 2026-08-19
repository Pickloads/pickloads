import "server-only";

import { recordAuditEvent } from "@/lib/audit";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import type {
  CarrierVerificationStatus,
  Locale,
} from "@/lib/supabase/database.types";
import { unconfiguredCreditProvider } from "./credit-provider";
import { fmcsaQcMobileProvider } from "./fmcsa-qcmobile";
import {
  compareIdentity,
  type EnteredIdentity,
  type IdentityComparison,
} from "./identity-match";
import type {
  AuthorityLookupResult,
  CarrierAuthorityProvider,
  DocketLookupResult,
} from "./provider";
import {
  APPLICANT_SAFE_REASON_CODES,
  assessCarrierRisk,
  type PrequalDecision,
  type ReasonCode,
  type RiskAssessment,
} from "./risk-engine";

/**
 * M-94 — the pre-registration gate: M-93's engine, wired to the real public
 * onboarding.
 *
 * ── WHAT THIS MODULE IS FOR ──────────────────────────────────────────────
 *
 * M-93 shipped a provider, an identity matcher, a risk engine and three
 * tables, and nothing in `src/` imported any of it. The public wizard still
 * created a `carriers` row the moment somebody typed a company name. This
 * module is the join: it runs the check, records the evidence, and produces
 * the ONE piece of state — a pre-registration whose stored `decision` is
 * `eligible_to_continue` — that `startOnboarding` is now allowed to proceed on.
 *
 * ── THE TRUST BOUNDARY, STATED ONCE ──────────────────────────────────────
 *
 * Nothing the browser sends is evidence. The applicant supplies a legal name,
 * a USDOT and (optionally) an MC; every conclusion drawn from them is computed
 * here, stored here, and re-read here. There is no parameter on any exported
 * function through which a caller can assert a decision, and the outcome
 * handed back to the browser carries no field a browser could usefully forge:
 * the pre-registration id is returned ONLY when the decision was eligible, and
 * even then it is re-validated against the database on every later use.
 *
 * ── FAILURE IS NOT A VERDICT ─────────────────────────────────────────────
 *
 * Every provider failure, every database failure and every unexpected throw in
 * this file resolves to MANUAL_REVIEW. Not to eligible (which would onboard an
 * unverified carrier on our outage) and not to not-eligible (which would
 * accuse a legitimate carrier of something our own dependency did). §12.
 */

/* ── Pure core ──────────────────────────────────────────────────────────── */

export interface PrecheckEvidence {
  /** The carrier lookup, with the docket set merged in when it was retrieved. */
  lookup: AuthorityLookupResult;
  identity: IdentityComparison | null;
  assessment: RiskAssessment;
  /** What `carrier_verifications.status` / `verification_status` become. */
  verificationStatus: CarrierVerificationStatus;
}

/**
 * Merge the two FMCSA calls into one record, then decide.
 *
 * PURE — no clock, no network, no database. Every §26 decision-matrix case is
 * a call to this function, which is the point: the rules are testable without
 * reproducing a session.
 *
 * ── WHY THE DOCKET RESULT IS MERGED RATHER THAN CHECKED SEPARATELY ───────
 *
 * `/carriers/{dot}` does not carry the docket SET — the adapter leaves
 * `dockets: null`, meaning "not retrieved". `matchDocketRelationship` reads
 * that null as `unavailable` and the risk engine routes it to manual review.
 * So a docket call that timed out, was rate-limited, or was never made keeps
 * its fail-closed meaning for free, and only an actually-retrieved list can
 * produce a confirmed MC↔USDOT relationship (§6).
 */
export function evaluatePrecheck(input: {
  entered: EnteredIdentity;
  lookup: AuthorityLookupResult;
  dockets: DocketLookupResult;
  creditConfigured: boolean;
}): PrecheckEvidence {
  const lookup: AuthorityLookupResult =
    input.lookup.status === "found"
      ? {
          status: "found",
          record: {
            ...input.lookup.record,
            // `found` → the real list (possibly empty, which IS a finding).
            // Anything else → null, i.e. "we did not retrieve it".
            dockets:
              input.dockets.status === "found" ? input.dockets.dockets : null,
          },
        }
      : input.lookup;

  const identity =
    lookup.status === "found"
      ? compareIdentity(input.entered, lookup.record)
      : null;

  const assessment = assessCarrierRisk({
    lookup,
    identity,
    creditConfigured: input.creditConfigured,
  });

  return {
    lookup,
    identity,
    assessment,
    verificationStatus: verificationStatusFor(lookup, assessment.decision),
  };
}

/**
 * The stored verification status.
 *
 * `provider_unavailable` is reachable ONLY from a provider-level outcome, and
 * `verified` ONLY from a found record that the risk engine cleared. A failure
 * cannot reach either end of this function's range.
 */
function verificationStatusFor(
  lookup: AuthorityLookupResult,
  decision: PrequalDecision,
): CarrierVerificationStatus {
  if (lookup.status === "not_configured" || lookup.status === "provider_unavailable") {
    return "provider_unavailable";
  }
  if (lookup.status === "not_found") return "not_verified";
  switch (decision) {
    case "eligible_to_continue":
      return "verified";
    case "manual_review":
      return "manual_review";
    case "not_eligible":
      return "not_verified";
  }
}

/**
 * The reason codes an APPLICANT may see.
 *
 * M-93 §6: a rejected applicant who learns exactly which rule failed learns
 * exactly what to change. Everything outside `APPLICANT_SAFE_REASON_CODES` is
 * stored and shown to staff, and never leaves the server.
 */
export function publicReasonCodes(codes: readonly ReasonCode[]): ReasonCode[] {
  return codes.filter((c) => APPLICANT_SAFE_REASON_CODES.has(c));
}

/* ── The public outcome ─────────────────────────────────────────────────── */

export interface PrecheckOutcome {
  decision: PrequalDecision;
  /**
   * Handed back ONLY for `eligible_to_continue`, and even then it is a bearer
   * id the server re-validates on every use. A manual-review or refused
   * applicant is given nothing to carry forward, because there is nothing they
   * are allowed to do next with it.
   */
  preRegistrationId: string | null;
  publicReasonCodes: ReasonCode[];
}

const MANUAL_REVIEW_OUTCOME: PrecheckOutcome = {
  decision: "manual_review",
  preRegistrationId: null,
  publicReasonCodes: [],
};

export interface PrecheckSubmission {
  legalName: string;
  /** Canonical digits (see `src/lib/validation/carrier-precheck.ts`). */
  usdotNumber: string;
  mcNumber: string | null;
  email: string;
  locale: Locale;
}

export interface PrecheckDeps {
  provider: CarrierAuthorityProvider;
  creditConfigured: boolean;
  admin: ReturnType<typeof tryCreateAdminClient>;
}

function defaultDeps(): PrecheckDeps {
  return {
    provider: fmcsaQcMobileProvider,
    creditConfigured: unconfiguredCreditProvider.isConfigured(),
    admin: tryCreateAdminClient(),
  };
}

/**
 * Run the pre-check and persist the pre-registration.
 *
 * The row is created BEFORE the provider is called, in `pending`, so that a
 * lookup which times out still leaves a record a human can pick up — an
 * applicant whose FMCSA call failed is exactly the applicant manual review
 * exists for, and losing them because the request died is not acceptable.
 */
export async function runCarrierPrecheck(
  submission: PrecheckSubmission,
  deps: PrecheckDeps = defaultDeps(),
): Promise<PrecheckOutcome> {
  const { admin, provider, creditConfigured } = deps;

  // No service-role key (secretless dev/preview). We cannot store a
  // pre-registration, so there is no verified state to hand forward — and
  // inventing one to keep the wizard walkable is precisely the fabrication
  // §"Do not fabricate FMCSA results" forbids.
  if (!admin) return MANUAL_REVIEW_OUTCOME;

  let preRegistrationId: string;
  try {
    const { data, error } = await admin
      .from("carrier_pre_registrations")
      .insert({
        legal_name_entered: submission.legalName,
        usdot_number_entered: submission.usdotNumber,
        mc_number_entered: submission.mcNumber,
        email: submission.email,
        locale: submission.locale,
        verification_status: "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    preRegistrationId = data.id;
  } catch (err) {
    console.error("[precheck] pre-registration insert failed", err);
    return MANUAL_REVIEW_OUTCOME;
  }

  await recordAuditEvent({
    actorId: null,
    action: "pre_registration_created",
    targetTable: "carrier_pre_registrations",
    targetId: preRegistrationId,
    // Identifiers and decisions only — never the raw payload, never the email.
    detail: { has_mc: submission.mcNumber !== null },
  });

  await recordAuditEvent({
    actorId: null,
    action: "fmcsa_check_started",
    targetTable: "carrier_pre_registrations",
    targetId: preRegistrationId,
    detail: { provider: provider.name, configured: provider.isConfigured() },
  });

  const entered: EnteredIdentity = {
    legalName: submission.legalName,
    usdotNumber: submission.usdotNumber,
    mcNumber: submission.mcNumber,
  };

  // Both calls are independent; running them in sequence would double the
  // worst case an applicant waits through for no benefit. Neither can throw —
  // the adapter converts every failure into a status.
  const [lookup, dockets] = await Promise.all([
    provider.lookupByUsdot(submission.usdotNumber),
    provider.lookupDocketNumbers(submission.usdotNumber),
  ]);

  const evidence = evaluatePrecheck({
    entered,
    lookup,
    dockets,
    creditConfigured,
  });

  try {
    await persistEvidence(admin, preRegistrationId, evidence);
  } catch (err) {
    // The decision was computed but not stored. The row keeps `decision: null`
    // and the gate therefore refuses it — the applicant is told to expect a
    // review rather than being handed an eligibility we did not record.
    console.error("[precheck] verification persist failed", err);
    return MANUAL_REVIEW_OUTCOME;
  }

  await recordAuditEvent({
    actorId: null,
    action: "fmcsa_check_completed",
    targetTable: "carrier_pre_registrations",
    targetId: preRegistrationId,
    detail: {
      provider: provider.name,
      lookup_status: evidence.lookup.status,
      docket_status: dockets.status,
      verification_status: evidence.verificationStatus,
      decision: evidence.assessment.decision,
      // Staff-facing. `audit_events` has no policy granting insert or update
      // to any browser role and SELECT only to staff (0009).
      reason_codes: evidence.assessment.reasonCodes,
    },
  });

  await recordAuditEvent({
    actorId: null,
    action: decisionAuditAction(evidence.assessment.decision),
    targetTable: "carrier_pre_registrations",
    targetId: preRegistrationId,
    detail: { risk_tier: evidence.assessment.tier },
  });

  return {
    decision: evidence.assessment.decision,
    preRegistrationId:
      evidence.assessment.decision === "eligible_to_continue"
        ? preRegistrationId
        : null,
    publicReasonCodes: publicReasonCodes(evidence.assessment.reasonCodes),
  };
}

function decisionAuditAction(decision: PrequalDecision): string {
  switch (decision) {
    case "eligible_to_continue":
      return "pre_registration_eligible";
    case "manual_review":
      return "manual_review_required";
    case "not_eligible":
      return "pre_registration_not_eligible";
  }
}

async function persistEvidence(
  admin: NonNullable<ReturnType<typeof tryCreateAdminClient>>,
  preRegistrationId: string,
  evidence: PrecheckEvidence,
): Promise<void> {
  const record =
    evidence.lookup.status === "found" ? evidence.lookup.record : null;

  const { error: verificationError } = await admin
    .from("carrier_verifications")
    .insert({
      pre_registration_id: preRegistrationId,
      provider: "fmcsa_qcmobile",
      provider_record_id: record?.providerRecordId ?? null,
      status: evidence.verificationStatus,
      legal_name: record?.legalName ?? null,
      dba_name: record?.dbaName ?? null,
      usdot_number: record?.usdotNumber ?? null,
      mc_number: record?.mcNumber ?? null,
      allowed_to_operate: record?.allowedToOperate ?? null,
      out_of_service: record?.outOfService ?? null,
      out_of_service_date: record?.outOfServiceDate ?? null,
      name_match: evidence.identity?.nameMatch ?? null,
      mc_match: evidence.identity?.mcMatch ?? null,
      dot_match: evidence.identity?.dotMatch ?? null,
      // The digest, never the payload (0032 / M-93 §2, §21).
      raw_response_sha256: record?.rawResponseSha256 ?? null,
      source_retrieved_at: record?.sourceRetrievedAt ?? null,
    });
  if (verificationError) throw new Error(verificationError.message);

  const { error: updateError } = await admin
    .from("carrier_pre_registrations")
    .update({
      verification_status: evidence.verificationStatus,
      risk_tier: evidence.assessment.tier,
      decision: evidence.assessment.decision,
      manual_review_required: evidence.assessment.manualReviewRequired,
      reason_codes: evidence.assessment.reasonCodes,
    })
    .eq("id", preRegistrationId)
    // Never re-decide a pre-registration that has already been spent.
    .is("claimed_carrier_id", null);
  if (updateError) throw new Error(updateError.message);
}

/* ── The gate ───────────────────────────────────────────────────────────── */

/**
 * Why a pre-registration may not be used to create an account.
 *
 * INTERNAL. The applicant is told one neutral sentence; the distinction here
 * exists for the audit trail, because "expired" and "somebody is replaying a
 * spent token" are very different operational events (§18, §21).
 */
export type GateDenialReason =
  | "missing"
  | "malformed"
  | "unknown"
  | "expired"
  | "already_claimed"
  | "not_eligible"
  | "unavailable";

export interface EligiblePreRegistration {
  id: string;
  legalNameEntered: string;
  usdotNumberEntered: string;
  mcNumberEntered: string | null;
  email: string;
  /** As stored. `text` in 0032, so it is not narrowed on the way out. */
  locale: string;
}

export type GateResult =
  | { ok: true; preRegistration: EligiblePreRegistration }
  | { ok: false; reason: GateDenialReason };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read the pre-registration and decide whether onboarding may proceed.
 *
 * Every condition is re-read from the database on every call. Nothing is
 * cached, nothing is passed in, and there is no argument by which a caller can
 * assert eligibility — §17: the browser must not be able to manufacture it,
 * and neither must a careless server call site.
 */
export async function loadEligiblePreRegistration(
  id: string | null | undefined,
  admin: ReturnType<typeof tryCreateAdminClient>,
  now: Date = new Date(),
): Promise<GateResult> {
  if (!id) return { ok: false, reason: "missing" };
  if (!UUID_RE.test(id)) return { ok: false, reason: "malformed" };
  // Without the service role we cannot verify anything, and an unverifiable
  // claim is refused rather than assumed. This is why the secretless dev
  // walkthrough stops at step 1 (documented in M-94).
  if (!admin) return { ok: false, reason: "unavailable" };

  const { data, error } = await admin
    .from("carrier_pre_registrations")
    // One literal, not a concatenation: supabase-js derives the row type from
    // the select string, and `a + b` widens it to `string`, which silently
    // degrades every column below to `GenericStringError`.
    .select(
      "id, legal_name_entered, usdot_number_entered, mc_number_entered, email, locale, decision, expires_at, claimed_carrier_id",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[precheck] gate read failed", error.message);
    return { ok: false, reason: "unavailable" };
  }
  if (!data) return { ok: false, reason: "unknown" };
  if (data.claimed_carrier_id !== null) {
    return { ok: false, reason: "already_claimed" };
  }
  if (new Date(data.expires_at).getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  if (data.decision !== "eligible_to_continue") {
    return { ok: false, reason: "not_eligible" };
  }

  return {
    ok: true,
    preRegistration: {
      id: data.id,
      legalNameEntered: data.legal_name_entered,
      usdotNumberEntered: data.usdot_number_entered,
      mcNumberEntered: data.mc_number_entered,
      email: data.email,
      locale: data.locale,
    },
  };
}

/**
 * Bind a pre-registration to the carrier row it produced. Returns false when
 * it was already spent.
 *
 * ── WHY THE CONDITIONS ARE IN THE UPDATE AND NOT AROUND IT ───────────────
 *
 * `where claimed_carrier_id is null` is evaluated by Postgres under the row
 * lock, so two requests racing on one pre-registration cannot both succeed:
 * exactly one UPDATE matches a row, the other matches none. Checking first and
 * updating second would leave a window between the two wide enough to create
 * two carrier accounts from one verification (§18).
 *
 * The expiry and decision are re-asserted here as well. `loadEligiblePreRegistration`
 * already checked them, but a claim that can only succeed on a live, eligible,
 * unspent row does not depend on its caller having checked.
 */
export async function claimPreRegistration(
  admin: NonNullable<ReturnType<typeof tryCreateAdminClient>>,
  preRegistrationId: string,
  carrierId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { data, error } = await admin
    .from("carrier_pre_registrations")
    .update({
      claimed_carrier_id: carrierId,
      claimed_at: now.toISOString(),
    })
    .eq("id", preRegistrationId)
    .is("claimed_carrier_id", null)
    .eq("decision", "eligible_to_continue")
    .gt("expires_at", now.toISOString())
    .select("id");

  if (error) {
    console.error("[precheck] claim failed", error.message);
    return false;
  }
  return (data?.length ?? 0) === 1;
}
