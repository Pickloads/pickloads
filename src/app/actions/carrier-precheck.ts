"use server";

import { runCarrierPrecheck } from "@/lib/carrier-authority/pre-registration";
import { setPrecheckCookie } from "@/lib/carrier-authority/precheck-session";
import type { PrecheckState } from "@/lib/carrier-precheck-state";
import { field, guardPublicForm } from "@/lib/forms/guard";
import { carrierPrecheckSchema } from "@/lib/validation/carrier-precheck";
import { firstIssueMessage } from "@/lib/validation/shared";

/**
 * M-94 §2 — STEP 1 of carrier onboarding: the FMCSA pre-check.
 *
 * ── WHAT THIS ACTION DOES NOT DO ─────────────────────────────────────────
 *
 * It does not create an auth user, a `carriers` row, a portal account, a
 * membership, a lead, a document folder or a signature request. It does not
 * set `carriers.active`. It does not charge anything. §3 lists those as the
 * architectural requirement of this milestone, and the reason is that all of
 * them used to happen — `startOnboarding` inserted a `carriers` row the moment
 * somebody typed a company name, which is how `carriers` became a table of
 * strangers and how "has this carrier been verified?" became unanswerable.
 *
 * The only thing it creates is a pre-registration: an opaque, expiring,
 * unclaimed record with no auth user attached.
 *
 * ── RATE LIMITING IS A REAL REQUIREMENT HERE, NOT A FORMALITY ────────────
 *
 * §19: an unauthenticated endpoint that performs an FMCSA lookup on demand is
 * an FMCSA enumeration proxy with our credential paying for it. It runs the
 * standard public-form guard — 5 submissions per 10 minutes per IP, plus
 * Turnstile — before the service-role client is touched and before a single
 * byte goes upstream. The response says nothing about which key was used or
 * how the window is computed (§19), and a refused submission looks the same
 * whether it was refused for rate or for Turnstile.
 */
export async function submitCarrierPrecheck(
  _prev: PrecheckState,
  formData: FormData,
): Promise<PrecheckState> {
  const guard = await guardPublicForm("carrier-precheck", formData);
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = carrierPrecheckSchema.safeParse({
    legal_name: field(formData, "legal_name"),
    usdot_number: field(formData, "usdot_number"),
    mc_number: field(formData, "mc_number"),
    email: field(formData, "email"),
    locale: field(formData, "locale"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const input = parsed.data;

  // NOTE what is not read from `formData`: any decision. There is no
  // `verified`, `eligible`, `fmcsaPassed`, `paid`, `approved` or `active`
  // field in the schema above, so §17's forged booleans have nowhere to land —
  // they are not ignored at runtime, they are unrepresentable.
  const outcome = await runCarrierPrecheck({
    legalName: input.legal_name,
    usdotNumber: input.usdot_number,
    mcNumber: input.mc_number,
    email: input.email,
    locale: input.locale,
  });

  switch (outcome.decision) {
    case "eligible_to_continue":
      if (!outcome.preRegistrationId) {
        // Unreachable by construction (the orchestrator only returns an id
        // with this decision), and handled anyway: an eligible screen with no
        // stored record behind it would be a dead end at the next step.
        return { status: "manual_review" };
      }
      await setPrecheckCookie(outcome.preRegistrationId);
      return { status: "eligible" };
    case "manual_review":
      return { status: "manual_review" };
    case "not_eligible":
      return { status: "not_eligible" };
  }
}
