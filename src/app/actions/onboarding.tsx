"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import {
  field,
  guardPublicForm,
  GUARD_MESSAGES,
  SERVER_ERROR_MESSAGE,
} from "@/lib/forms/guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordAuditEvent } from "@/lib/audit";
import {
  claimPreRegistration,
  loadEligiblePreRegistration,
} from "@/lib/carrier-authority/pre-registration";
import {
  clearPrecheckCookie,
  readPrecheckCookie,
} from "@/lib/carrier-authority/precheck-session";
import {
  onboardingAccountSchema,
  onboardingInfoSchema,
  uploadRequestSchema,
} from "@/lib/validation/onboarding";
import { firstIssueMessage } from "@/lib/validation/shared";
import { encryptPII } from "@/lib/crypto";
import { MAX_UPLOAD_BYTES, sanitizeFileName, sniffMime } from "@/lib/uploads";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { EMAIL_INTERNAL_TO, sendEmail } from "@/lib/email/send";
import { OnboardingNotificationEmail } from "@/emails/OnboardingNotificationEmail";
// M-92: `buildAgreementSentEmail` is no longer imported here. It is still used
// by the SignWell send path; onboarding simply no longer claims an agreement
// went out, because none does.
import {
  buildDocumentsReceivedEmail,
  buildOnboardingStartedEmail,
} from "@/emails/customer-templates";
import { resolveEmailLocale } from "@/emails/i18n";
import { getRecipientByProfile, notifyCustomer } from "@/lib/notify";
import type {
  AccountState,
  StartState,
  UploadResult,
} from "@/lib/onboarding-state";

/**
 * M-20/M-21 — become-a-carrier wizard server actions (decision Q3: every
 * write is server-side; the wizard's public steps run the same guard
 * pipeline as the M-14 forms).
 *
 * Session model: `startOnboarding` creates the `carriers` row and hands its
 * UUID back to the client as the wizard handle (unguessable bearer id). Until
 * the account step links a profile, the row is "unclaimed" (profile_id null,
 * active false). It also records a CRM lead (source `become_a_carrier`) so an
 * abandoned wizard still surfaces in M-23 with a callable phone number.
 *
 * ── M-94: THIS IS NO LONGER STEP 1 ───────────────────────────────────────
 *
 * It used to be. Someone typed a company name and a `carriers` row appeared —
 * before any authority check, before any payment, before anyone had confirmed
 * the applicant was a real motor carrier at all. Step 1 is now the FMCSA
 * pre-check (`src/app/actions/carrier-precheck.ts`), and the two actions below
 * refuse to run without the state it produces:
 *
 *   `startOnboarding`    — requires a live, eligible, UNCLAIMED
 *                          pre-registration, and CLAIMS it in the same call
 *                          that creates the carrier row.
 *   `completeOnboarding` — requires the carrier row to be one that was created
 *                          that way, i.e. to have a pre-registration bound to
 *                          it.
 *
 * Both checks read the database. Neither reads a parameter. §16/§17: hiding a
 * button in React is not security, and a request that arrives directly at
 * either action without the state must fail — which is what
 * `tests/unit/carrier-precheck-gate.test.ts` asserts.
 */

/** One sentence for every gate refusal. §20: the reason is audited, not shown. */
const GATE_MESSAGE =
  "Start with carrier verification — we need your USDOT and MC before onboarding can continue.";

/* --------------------- Step 3 — company details --------------------- */

export async function startOnboarding(
  _prev: StartState,
  formData: FormData,
): Promise<StartState> {
  const guard = await guardPublicForm("onboarding", formData);
  if (!guard.ok) return { status: "error", message: guard.message };

  /* ── THE M-94 GATE ─────────────────────────────────────────────────────
   *
   * Before validation, before any write, before anything: is there a live,
   * eligible, unspent pre-registration behind this request?
   *
   * The id comes from an httpOnly cookie, but where it came from is not what
   * makes this safe — every condition (decision, expiry, claim) is read from
   * the row itself on this call. A forged cookie names a row that either does
   * not exist or does not say `eligible_to_continue`, and both are refused
   * here. There is no `verified=true` this function will accept from anywhere.
   *
   * Note the ordering with `tryCreateAdminClient()`: without the service role
   * the pre-registration cannot be read, so the request is REFUSED rather than
   * waved through. The old secretless-dev shortcut returned a random UUID and
   * a success status here, which is exactly the shape of the bypass §16 asks
   * to close — a caller with no database still got a wizard handle.
   */
  const admin = tryCreateAdminClient();
  const gate = await loadEligiblePreRegistration(
    await readPrecheckCookie(),
    admin,
  );
  if (!gate.ok || !admin) {
    await recordAuditEvent({
      actorId: null,
      action: "onboarding_gate_denied",
      targetTable: "carriers",
      detail: {
        step: "start_onboarding",
        reason: gate.ok ? "unavailable" : gate.reason,
      },
    });
    return { status: "error", message: GATE_MESSAGE };
  }
  const pre = gate.preRegistration;

  const parsed = onboardingInfoSchema.safeParse({
    // ── IDENTITY COMES FROM THE VERIFIED RECORD, NOT FROM THIS FORM ──────
    //
    // The applicant verified USDOT X under legal name Y. Reading the company
    // name, MC and USDOT back out of this submission would let them verify as
    // one carrier and register as another — a one-field change in devtools
    // between two requests, and the whole pre-check would have proved nothing.
    // So the three identity fields are taken from the pre-registration and the
    // form's values for them, if any were sent, are never read.
    company_name: pre.legalNameEntered,
    mc_number: pre.mcNumberEntered ?? "",
    dot_number: pre.usdotNumberEntered,
    full_name: field(formData, "full_name"),
    email: field(formData, "email"),
    phone: field(formData, "phone"),
    home_state: field(formData, "home_state"),
    factoring_company: field(formData, "factoring_company"),
    ein: field(formData, "ein"),
    insurance_expiry: field(formData, "insurance_expiry"),
    locale: field(formData, "locale"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const info = parsed.data;

  let carrierId: string;
  let leadId: string | undefined;
  try {
    const { data, error } = await admin
      .from("carriers")
      .insert({
        company_name: info.company_name,
        mc_number: info.mc_number,
        dot_number: info.dot_number,
        home_state: info.home_state,
        factoring_company: info.factoring_company,
        insurance_expiry: info.insurance_expiry,
        // S-01: EIN is AES-256-GCM ciphertext or NULL — never plaintext.
        ein: info.ein ? encryptPII(info.ein) : null,
        active: false,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    carrierId = data.id;

    /* ── SPEND THE PRE-REGISTRATION, ATOMICALLY ────────────────────────────
     *
     * `claimPreRegistration` is a conditional UPDATE — Postgres evaluates
     * "still unclaimed, still eligible, still live" under the row lock, so two
     * requests racing on one verification cannot both win (§18).
     *
     * The carrier row is created first because `claimed_carrier_id` is a
     * foreign key and there is nothing to point at until it exists. The loser
     * of the race therefore has a carrier row it is not entitled to keep, and
     * deletes it: a `carriers` row with no pre-registration bound to it is
     * precisely the orphan this milestone exists to stop creating, and leaving
     * one behind on the error path would reintroduce it one race at a time.
     */
    const claimed = await claimPreRegistration(admin, pre.id, carrierId);
    if (!claimed) {
      await admin.from("carriers").delete().eq("id", carrierId);
      await recordAuditEvent({
        actorId: null,
        action: "onboarding_gate_denied",
        targetTable: "carrier_pre_registrations",
        targetId: pre.id,
        detail: { step: "claim", reason: "already_claimed_or_expired" },
      });
      return { status: "error", message: GATE_MESSAGE };
    }
    await clearPrecheckCookie();

    // CRM visibility for abandoned wizards (M-23 reads carrier_leads).
    const { data: lead, error: leadError } = await admin
      .from("carrier_leads")
      .insert({
        lead_type: "dispatch",
        full_name: info.full_name,
        email: info.email,
        phone: info.phone,
        mc_number: info.mc_number,
        home_state: info.home_state,
        source: "become_a_carrier",
        locale: info.locale,
      })
      .select("id")
      .single();
    if (leadError) {
      console.error("[onboarding] lead insert failed", leadError.message);
    } else {
      leadId = lead.id;
    }
  } catch (err) {
    console.error("[onboarding] carrier insert failed", err);
    return { status: "error", message: SERVER_ERROR_MESSAGE };
  }

  // M-60: customer confirmation in the wizard locale.
  {
    const started = buildOnboardingStartedEmail(
      resolveEmailLocale(info.locale),
      {
        fullName: info.full_name,
        companyName: info.company_name,
      },
    );
    await sendEmail({
      to: info.email,
      subject: started.subject,
      template: started.template,
      react: started.react,
      ...(leadId ? { leadId } : {}),
    });
  }

  await sendEmail({
    to: EMAIL_INTERNAL_TO,
    subject: `Carrier onboarding started — ${info.company_name}`,
    template: "onboarding-started",
    react: (
      <OnboardingNotificationEmail
        stage="started"
        companyName={info.company_name}
        fullName={info.full_name}
        email={info.email}
        phone={info.phone}
        mcNumber={info.mc_number}
      />
    ),
    ...(leadId ? { leadId } : {}),
  });

  return { status: "success", carrierId, companyName: info.company_name };
}

/* ------------------------------ Step 2 ------------------------------ */

const UPLOAD_ERRORS = {
  file_missing: "Choose a file to upload.",
  too_large: "File is larger than 10 MB. Compress it or scan at lower quality.",
  bad_type: "Unsupported file type — upload a PDF, JPG, PNG or HEIC.",
  not_found: "Onboarding session not found. Restart at step 1.",
  not_yours: "This document folder belongs to another account.",
  too_many: "Upload limit reached for this application. Call (908) 404-5373.",
} as const;

export async function uploadCarrierDocument(
  formData: FormData,
): Promise<UploadResult> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  // Wider window than the 5/10min form default: 4 doc types + retries (S-03).
  if (!(await checkRateLimit("carrier-doc-upload", ip, 30))) {
    return { ok: false, error: GUARD_MESSAGES.rate_limit };
  }

  const parsed = uploadRequestSchema.safeParse({
    carrier_id: field(formData, "carrier_id"),
    doc_type: field(formData, "doc_type"),
  });
  if (!parsed.success) {
    return { ok: false, error: firstIssueMessage(parsed.error) };
  }
  const { carrier_id, doc_type } = parsed.data;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: UPLOAD_ERRORS.file_missing };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: UPLOAD_ERRORS.too_large };
  }

  // S-03: magic-byte sniffing — extension and client MIME are never trusted.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes);
  if (!mime) {
    return { ok: false, error: UPLOAD_ERRORS.bad_type };
  }

  const fileName = sanitizeFileName(file.name);

  const admin = tryCreateAdminClient();
  if (!admin) {
    console.warn("[onboarding] upload skipped — no service key (dev mode)");
    return { ok: true, documentId: "dev", fileName };
  }

  try {
    const { data: carrier, error: carrierError } = await admin
      .from("carriers")
      .select("id, profile_id")
      .eq("id", carrier_id)
      .maybeSingle();
    if (carrierError) throw new Error(carrierError.message);
    if (!carrier) return { ok: false, error: UPLOAD_ERRORS.not_found };

    // Claimed carriers (M-25 replacements) require the owning session.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (carrier.profile_id !== null && carrier.profile_id !== user?.id) {
      return { ok: false, error: UPLOAD_ERRORS.not_yours };
    }

    const { count } = await admin
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("carrier_id", carrier_id);
    if ((count ?? 0) >= 24) {
      return { ok: false, error: UPLOAD_ERRORS.too_many };
    }

    // S-01: UUID-randomized path under the carrier's private folder.
    const storagePath = `${carrier_id}/${randomUUID()}-${fileName}`;
    const { error: uploadError } = await admin.storage
      .from("carrier-docs")
      .upload(storagePath, Buffer.from(bytes), {
        contentType: mime,
        upsert: false,
      });
    if (uploadError) throw new Error(uploadError.message);

    const { data: doc, error: docError } = await admin
      .from("documents")
      .insert({
        carrier_id,
        type: doc_type,
        storage_path: storagePath,
        file_name: fileName,
        file_size_bytes: file.size,
        mime_type: mime,
        uploaded_by: user?.id ?? null,
        status: "pending",
      })
      .select("id")
      .single();
    if (docError) throw new Error(docError.message);

    // M-60: authenticated replacement uploads (claimed carrier) get a
    // per-document received-confirmation + portal notification. Anonymous
    // wizard uploads are covered by the batch email at completeOnboarding.
    if (user && carrier.profile_id === user.id) {
      const recipient = await getRecipientByProfile(admin, user.id);
      if (recipient) {
        const received = buildDocumentsReceivedEmail(recipient.locale, {
          docType: doc_type,
        });
        await notifyCustomer({
          recipient,
          kind: "document_received",
          title: received.subject,
          href: "/portal/carrier/documents",
          email: received,
        });
      }
    }

    return { ok: true, documentId: doc.id, fileName };
  } catch (err) {
    console.error("[onboarding] upload failed", err);
    return { ok: false, error: SERVER_ERROR_MESSAGE };
  }
}

/* ------------------ Final step — portal account ---------------------- */

export async function completeOnboarding(
  _prev: AccountState,
  formData: FormData,
): Promise<AccountState> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  if (!(await checkRateLimit("onboarding-account", ip))) {
    return { status: "error", message: GUARD_MESSAGES.rate_limit };
  }

  const parsed = onboardingAccountSchema.safeParse({
    carrier_id: field(formData, "carrier_id"),
    email: field(formData, "email"),
    password: field(formData, "password"),
    full_name: field(formData, "full_name"),
    phone: field(formData, "phone"),
    company_name: field(formData, "company_name"),
    esign_consent: field(formData, "esign_consent"),
    locale: field(formData, "locale"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const account = parsed.data;

  /* ── M-94 §16: THE ACCOUNT GATE ────────────────────────────────────────
   *
   * `startOnboarding` is not the only door to an account. This action takes a
   * `carrier_id` and creates an auth user for it, so it needs its own answer
   * to "was this carrier ever verified?" — and it has to be a fact about the
   * row, not a claim about the request.
   *
   * The fact is `carrier_pre_registrations.claimed_carrier_id`. Only
   * `claimPreRegistration` writes it, only from a live eligible unclaimed
   * pre-registration, so its presence means this carrier row is one the gate
   * produced. Without it, no account.
   *
   * KNOWN CONSEQUENCE, ACCEPTED: `carriers` rows created by the pre-M-94 flow
   * have no pre-registration and can no longer self-serve an account. That is
   * the correct side of the trade — those rows are exactly the unverified
   * strangers this milestone exists to stop — and they are reachable by staff,
   * who can run the check and bind a pre-registration. Recorded in
   * docs/modules/M-94-carrier-pre-registration-wiring.md §Known blockers.
   */
  const admin = tryCreateAdminClient();
  if (!admin) {
    await recordAuditEvent({
      actorId: null,
      action: "onboarding_gate_denied",
      targetTable: "carriers",
      targetId: account.carrier_id,
      detail: { step: "complete_onboarding", reason: "unavailable" },
    });
    return { status: "error", message: GATE_MESSAGE };
  }

  try {
    const { data: carrier, error: carrierError } = await admin
      .from("carriers")
      .select("id, profile_id")
      .eq("id", account.carrier_id)
      .maybeSingle();
    if (carrierError) throw new Error(carrierError.message);
    if (!carrier) {
      return {
        status: "error",
        message: "Onboarding session not found. Restart at step 1.",
      };
    }
    if (carrier.profile_id !== null) {
      return {
        status: "error",
        message:
          "This application already has an account — sign in at /login instead.",
      };
    }

    const { data: boundPreRegistration, error: bindError } = await admin
      .from("carrier_pre_registrations")
      .select("id, decision")
      .eq("claimed_carrier_id", carrier.id)
      .maybeSingle();
    if (bindError) throw new Error(bindError.message);
    if (
      !boundPreRegistration ||
      boundPreRegistration.decision !== "eligible_to_continue"
    ) {
      await recordAuditEvent({
        actorId: null,
        action: "onboarding_gate_denied",
        targetTable: "carriers",
        targetId: carrier.id,
        detail: {
          step: "complete_onboarding",
          reason: boundPreRegistration ? "not_eligible" : "unverified_carrier",
        },
      });
      return { status: "error", message: GATE_MESSAGE };
    }

    // Auto-confirmed: the address was collected in-flow and the account is
    // useless without portal data behind RLS. (Judgment call documented in
    // docs/modules/M-20-21-onboarding-uploads.md.)
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email: account.email,
        password: account.password,
        email_confirm: true,
        user_metadata: {
          full_name: account.full_name,
          preferred_language: account.locale,
        },
      });
    if (createError) {
      const exists = /already|registered|exists/i.test(createError.message);
      return {
        status: "error",
        message: exists
          ? "An account with this email already exists. Sign in instead, or use another email."
          : SERVER_ERROR_MESSAGE,
      };
    }
    const userId = created.user.id;

    // Profile row exists via the on_auth_user_created trigger; enrich it.
    const { error: profileError } = await admin
      .from("profiles")
      .update({ phone: account.phone, company_name: account.company_name })
      .eq("id", userId);
    if (profileError) {
      console.error("[onboarding] profile enrich failed", profileError.message);
    }

    const { error: linkError } = await admin
      .from("carriers")
      .update({ profile_id: userId })
      .eq("id", account.carrier_id);
    if (linkError) throw new Error(linkError.message);

    // M-57: memberships are the authoritative person↔company join (D4) —
    // the M-50 backfill covered pre-existing links, and every claim after it
    // must write the owner row too or the membership-routed portal (and all
    // 0009 membership RLS policies) would see nothing for this carrier.
    const { error: membershipError } = await admin
      .from("carrier_memberships")
      .insert({
        carrier_id: account.carrier_id,
        profile_id: userId,
        role: "owner",
      });
    if (membershipError) throw new Error(membershipError.message);
  } catch (err) {
    console.error("[onboarding] account creation failed", err);
    return { status: "error", message: SERVER_ERROR_MESSAGE };
  }

  /*
   * ── M-92: THE DROPBOX SIGN AUTO-SEND IS DISABLED ────────────────────────
   *
   * This used to call `sendAgreementSignatureRequest()` — the Dropbox Sign
   * send — on every completed onboarding. SignWell is now the single active
   * provider for the Dispatch Service Agreement, and leaving this call here
   * would mean a carrier who finishes onboarding and then presses "Send me
   * the agreement" receives TWO dispatch agreements from two vendors, both
   * legally presented as the agreement, both racing to stamp the same
   * `carriers.agreement_signed_at`.
   *
   * The Dropbox Sign integration is NOT deleted: `src/lib/esign.ts` and
   * `/api/esign/webhook` still exist, and every historical Dropbox Sign
   * record — `webhook_events`, stamped agreements, stored PDFs — is
   * untouched and still processed. An in-flight Dropbox request signed
   * tomorrow still completes correctly. Only the automatic CREATION of new
   * Dropbox agreements stops here.
   *
   * Nothing replaces it in this function. Per M-92 §8 the SignWell send is
   * EXPLICIT — the carrier or a dispatcher triggers it from the agreements
   * page — until the full workflow is owner-approved. Auto-sending a contract
   * as a side effect of account creation is not a default worth restoring
   * without that approval.
   *
   * `tests/unit/agreement-single-provider.test.ts` fails if this call comes
   * back.
   */
  const agreementAutoSent = false;

  // Best-effort CRM journaling: advance the step-1 lead + audit the ESIGN
  // consent (checkbox is schema-enforced above).
  try {
    const { data: lead } = await admin
      .from("carrier_leads")
      .select("id")
      .eq("email", account.email)
      .eq("source", "become_a_carrier")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lead) {
      await admin
        .from("carrier_leads")
        .update({ status: "agreement" })
        .eq("id", lead.id);
      await admin.from("lead_activities").insert({
        lead_id: lead.id,
        type: "note",
        body:
          "Onboarding wizard completed — portal account created; ESIGN " +
          "consent recorded; dispatch agreement NOT auto-sent (M-92: SignWell " +
          "is the single provider and its send is explicit from the " +
          "agreements page).",
      });
    }
  } catch (err) {
    console.error("[onboarding] CRM journaling failed", err);
  }

  // M-60: customer-facing wrap-up — the batch documents-received note.
  // (Per-file emails during the anonymous wizard would be spam; the portal
  // replacement flow emails per document instead.)
  //
  // M-92: the "agreement sent" note is gone from here. No agreement is sent
  // at onboarding any more, and telling a carrier one is on its way when
  // nothing was sent is the failure this module is meant to prevent.
  {
    const locale = resolveEmailLocale(account.locale);
    const docs = buildDocumentsReceivedEmail(locale, { docType: null });
    await sendEmail({
      to: account.email,
      subject: docs.subject,
      template: docs.template,
      react: docs.react,
    });
  }

  await sendEmail({
    to: EMAIL_INTERNAL_TO,
    subject: `Carrier onboarding completed — ${account.company_name}`,
    template: "onboarding-completed",
    react: (
      <OnboardingNotificationEmail
        stage="completed"
        companyName={account.company_name}
        fullName={account.full_name}
        email={account.email}
        phone={account.phone}
        mcNumber={null}
        esignSent={agreementAutoSent}
      />
    ),
  });

  return { status: "success", esign: agreementAutoSent ? "sent" : "pending" };
}
