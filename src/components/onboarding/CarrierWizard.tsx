"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import {
  completeOnboarding,
  startOnboarding,
} from "@/app/actions/onboarding";
import {
  initialAccountState,
  initialStartState,
} from "@/lib/onboarding-state";
import { TurnstileWidget } from "@/components/forms/TurnstileWidget";
import { CarrierPrecheck } from "@/components/onboarding/CarrierPrecheck";
import { CarrierFeeStep } from "@/components/onboarding/CarrierFeeStep";
import { DocUpload } from "@/components/onboarding/DocUpload";
import type { DocType } from "@/lib/supabase/database.types";
import type { WizardResume } from "@/lib/carrier-authority/wizard-resume";

/**
 * M-20 — the become-a-carrier wizard, REWIRED by M-94.
 *
 * ── WHAT CHANGED AND WHY THE STEP STRIP IS NOW SIX ───────────────────────
 *
 * The old presentation was: company info → documents → agreement → portal.
 * The first thing that happened when a visitor pressed "Continue" was a
 * `carriers` row. Nobody had checked whether the company existed.
 *
 * Verification is now the first thing on the page, and the strip says so.
 * §23's suggested list has five entries; this has six, because there is a
 * genuine company-details step between the fee and the documents — the wizard
 * needs a contact name, a phone number and a home state before it can create
 * anything — and folding it into a neighbour to hit a target count would be
 * exactly the inaccurate labelling §23 is about. "Company info" also remains a
 * real, translated step name, which `tests/e2e/i18n-locales.spec.ts` samples on
 * this route.
 *
 * ── THE CLIENT DECIDES NOTHING ───────────────────────────────────────────
 *
 * `step` is presentation. Advancing it does not make the applicant eligible,
 * paid or approved: `startOnboarding` re-reads the pre-registration from the
 * database on every call and refuses without one (§16/§17), so a user who
 * skips a panel in React arrives at a server action that has never heard of
 * them. There is no `verified` state here to flip.
 */

type Step = 1 | 2 | 3 | 4 | 5 | 6;

const WIZARD_DOCS: ReadonlyArray<{
  type: Extract<DocType, "mc_authority" | "coi" | "w9" | "voided_check">;
  title: string;
  blurb: string;
}> = [
  {
    type: "mc_authority",
    title: "MC Authority Letter",
    blurb: "Your FMCSA operating authority letter (skip if not issued yet).",
  },
  {
    type: "coi",
    title: "Certificate of Insurance",
    blurb: "$1M auto liability · $100K cargo minimums",
  },
  {
    type: "w9",
    title: "W-9 Form",
    blurb: "Current IRS revision, signed.",
  },
  {
    type: "voided_check",
    title: "Voided Check",
    blurb: "Or a bank letter for factoring/payment setup.",
  },
];

interface ContactInfo {
  full_name: string;
  email: string;
  phone: string;
}

/**
 * M-95 — where the SERVER says this applicant stands.
 *
 * The wizard no longer decides its own starting point. `resume` is computed
 * per request from the httpOnly cookie plus the database (`wizard-resume.ts`),
 * which is what lets somebody come back from Stripe — a fresh page load —
 * without the wizard cheerfully restarting them at step 1 after they have been
 * charged.
 *
 * It is presentation, not permission. Every step still ends at a server action
 * that re-reads eligibility and payment for itself.
 */
function initialStepFor(resume: WizardResume): Step {
  switch (resume.step) {
    case "fee":
      return 2;
    case "company":
      return 3;
    default:
      return 1;
  }
}

export function CarrierWizard({
  esignLive,
  resume = { step: "precheck" },
}: {
  esignLive: boolean;
  resume?: WizardResume;
}) {
  const tv = useV4();
  const locale = useLocale();
  const [step, setStep] = useState<Step>(() => initialStepFor(resume));
  const [info, setInfo] = useState<ContactInfo>({
    full_name: "",
    email: "",
    phone: "",
  });
  const [uploadedCount, setUploadedCount] = useState(0);
  const [consent, setConsent] = useState(false);

  const [startState, startAction, startPending] = useActionState(
    startOnboarding,
    initialStartState,
  );
  const [accountState, accountAction, accountPending] = useActionState(
    completeOnboarding,
    initialAccountState,
  );

  const carrierId = startState.carrierId;

  useEffect(() => {
    if (startState.status === "success" && startState.carrierId) setStep(4);
  }, [startState]);

  /**
   * Turnstile tokens are single-use. A failed company-details submit left the
   * widget holding the token it had already spent, so the retry re-sent a dead
   * token and Cloudflare refused it as `timeout-or-duplicate` — turning ANY
   * first failure (a typo'd phone number was enough) into a permanent "We
   * couldn't verify your submission" that only a page refresh cleared.
   *
   * Counting failures and feeding that to the widget remounts it, so each
   * attempt carries a token that has never been used.
   */
  const [verifyAttempt, setVerifyAttempt] = useState(0);
  useEffect(() => {
    if (startState.status === "error") setVerifyAttempt((n) => n + 1);
  }, [startState]);

  // M-59 (WCAG 2.4.3): advancing a step moves focus to the new panel's
  // heading so screen-reader/keyboard users land at the start of the step.
  const wizardRef = useRef<HTMLDivElement | null>(null);
  const visitedStep = useRef(false);
  useEffect(() => {
    if (!visitedStep.current) {
      visitedStep.current = true;
      return;
    }
    const heading =
      wizardRef.current?.querySelector<HTMLElement>(".bigform h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: false });
    }
  }, [step]);

  const stepClass = (n: Step) =>
    `step${step === n ? " current" : ""}${step > n ? " done" : ""}`;

  const setField =
    (key: keyof ContactInfo) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setInfo((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <div className="wizard" ref={wizardRef}>
      {/* Progress indicator — V4 .steps vocabulary */}
      <ol className="steps" style={{ listStyle: "none", padding: 0 }} aria-label={tv("Onboarding progress")}>
        <li className={stepClass(1)} aria-current={step === 1 ? "step" : undefined}>
          <span className="n">{tv("STEP 1")}</span>
          <h3>{tv("Carrier verification")}</h3>
          <p>{tv("USDOT and MC checked with FMCSA.")}</p>
        </li>
        <li className={stepClass(2)} aria-current={step === 2 ? "step" : undefined}>
          <span className="n">{tv("STEP 2")}</span>
          <h3>{tv("Verification fee")}</h3>
          <p>{tv("$9.99 one-time onboarding fee.")}</p>
        </li>
        <li className={stepClass(3)} aria-current={step === 3 ? "step" : undefined}>
          <span className="n">{tv("STEP 3")}</span>
          <h3>{tv("Company info")}</h3>
          <p>{tv("Who you are and how we reach you.")}</p>
        </li>
        <li className={stepClass(4)} aria-current={step === 4 ? "step" : undefined}>
          <span className="n">{tv("STEP 4")}</span>
          <h3>{tv("Documents")}</h3>
          <p>{tv("MC letter, COI, W-9, voided check.")}</p>
        </li>
        <li className={stepClass(5)} aria-current={step === 5 ? "step" : undefined}>
          <span className="n">{tv("STEP 5")}</span>
          <h3>{tv("Agreement")}</h3>
          <p>{tv("Plain-English dispatch agreement, e-signed.")}</p>
        </li>
        <li className={stepClass(6)} aria-current={step === 6 ? "step" : undefined}>
          <span className="n">{tv("STEP 6")}</span>
          <h3>{tv("Your portal")}</h3>
          <p>{tv("Account access and staff compliance review.")}</p>
        </li>
      </ol>

      {/* ── An application that has already been spent ──────────────────
          Its pre-registration is bound to a carrier account, so there is
          nothing here for them to do but sign in. Resolved on the server; the
          client is not asked to work it out. */}
      {resume.step === "already_onboarded" ? (
        <div className="bigform">
          <h2>{tv("This application already has an account.")}</h2>
          <p>
            {tv("Sign in to your portal to carry on where you left off.")}
          </p>
          <div style={{ marginTop: 22, display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Link className="btn btn-amber" href="/login">
              {tv("Sign in to your portal →")}
            </Link>
          </div>
        </div>
      ) : null}

      {/* ---------------- Step 1 — FMCSA verification ---------------- */}
      {step === 1 && resume.step !== "already_onboarded" ? (
        <CarrierPrecheck
          onVerified={() => setStep(2)}
          /* A resumed manual-review or refused application renders the same
             panel the live check would, rather than a second copy of the
             wording that could drift away from it.
             Conditional SPREAD, not `: undefined` — `exactOptionalPropertyTypes`
             distinguishes "absent" from "present and undefined". */
          {...(resume.step === "manual_review" || resume.step === "not_eligible"
            ? { resumeOutcome: resume.step }
            : {})}
        />
      ) : null}

      {/* ---------------- Step 2 — the $9.99 fee (Stripe Checkout) ------- */}
      {step === 2 ? (
        <CarrierFeeStep onAlreadyPaid={() => setStep(3)} />
      ) : null}

      {/* ---------------- Step 3 — company details ---------------- */}
      {step === 3 ? (
        <div className="bigform">
          <h2>{tv("Tell us about your operation")}</h2>
          <p>
            {tv(
              "About 5 minutes. Fields marked optional can be completed later from your portal.",
            )}
          </p>
          {/* Company name, USDOT and MC are NOT asked again. They were
              verified in step 1 and the server takes them from that record —
              re-collecting them would create a second, unverified answer to
              "who is this carrier?" and a one-field way around the check. */}
          <form action={startAction}>
            <input type="hidden" name="locale" value={locale} />
            <div className="grid2">
              <div className="field">
                <label htmlFor="ob-name">{tv("Your Full Name")}</label>
                <input id="ob-name" name="full_name" type="text" required value={info.full_name} onChange={setField("full_name")} autoComplete="name" placeholder="John Carter" />
              </div>
              <div className="field">
                <label htmlFor="ob-phone">{tv("Phone")}</label>
                <input id="ob-phone" name="phone" type="tel" required value={info.phone} onChange={setField("phone")} autoComplete="tel" inputMode="tel" placeholder="(___) ___-____" />
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label htmlFor="ob-email">{tv("Email")}</label>
                <input id="ob-email" name="email" type="email" required value={info.email} onChange={setField("email")} autoComplete="email" placeholder="you@company.com" />
              </div>
              <div className="field">
                <label htmlFor="ob-state">{tv("Home State")}</label>
                <input id="ob-state" name="home_state" type="text" placeholder="NJ" autoComplete="address-level1" />
              </div>
            </div>
            <div className="grid3">
              <div className="field">
                <label htmlFor="ob-ein">{tv("EIN (optional)")}</label>
                <input id="ob-ein" name="ein" type="text" placeholder="12-3456789" inputMode="numeric" />
              </div>
              <div className="field">
                <label htmlFor="ob-factoring">{tv("Factoring Company (optional)")}</label>
                <input id="ob-factoring" name="factoring_company" type="text" placeholder={tv("e.g. TAFS, RTS — or none")} />
              </div>
              <div className="field">
                <label htmlFor="ob-insurance">{tv("Insurance Expiry (optional)")}</label>
                <input id="ob-insurance" name="insurance_expiry" type="date" />
              </div>
            </div>
            <TurnstileWidget theme="light" resetKey={verifyAttempt} />
            <button className="btn btn-amber" type="submit" aria-busy={startPending} disabled={startPending} style={{ marginTop: 4 }}>
              {startPending ? tv("Saving…") : tv("Continue to Documents →")}
            </button>
          </form>
          <div className={`form-err${startState.status === "error" ? " show" : ""}`} role="alert">
            {startState.status === "error" && startState.message ? tv(startState.message) : null}
          </div>
        </div>
      ) : null}

      {/* ---------------- Step 4 — documents ---------------- */}
      {step === 4 && carrierId ? (
        <div className="bigform">
          <h2>{tv("Upload your documents")}</h2>
          <p>
            {tv(
              "Drag & drop or tap to browse. Missing something? Skip it — you can upload the rest from your portal later.",
            )}
          </p>
          <div className="upload-grid">
            {WIZARD_DOCS.map((doc) => (
              <DocUpload
                key={doc.type}
                carrierId={carrierId}
                docType={doc.type}
                title={doc.title}
                blurb={doc.blurb}
                onDone={() => setUploadedCount((n) => n + 1)}
              />
            ))}
          </div>
          <p className="mono" style={{ fontSize: ".72rem", color: "var(--color-slate-aa)", margin: "10px 0 18px" }}>
            {"// "}
            {tv(
              "Files are stored in a private, encrypted bucket and reviewed by our compliance team — never public.",
            )}
          </p>
          <button className="btn btn-amber" type="button" onClick={() => setStep(5)}>
            {uploadedCount > 0
              ? tv("Continue to Agreement →")
              : tv("Skip for now — Continue →")}
          </button>
        </div>
      ) : null}

      {/* ---------------- Step 5 — e-sign consent ---------------- */}
      {step === 5 ? (
        <div className="bigform">
          <h2>{tv("Dispatch agreement & e-signature")}</h2>
          <p>
            {tv(
              "Month-to-month terms in plain English. No exclusivity, no exit fees, cancel any time.",
            )}
          </p>
          <div className="esign-panel">
            {esignLive ? (
              <>
                <b>{tv("E-signature via Dropbox Sign")}</b>
                <p>
                  {tv(
                    "After you create your account in the next step, the dispatch agreement is emailed to you for legally binding e-signature. Sign from any device — no printing, no fax.",
                  )}
                </p>
              </>
            ) : (
              <>
                <b>{tv("E-signature — activating shortly")}</b>
                <p>
                  {tv(
                    "Our dispatch agreement is completing legal review. Nothing to sign today: finish creating your account and we'll email the agreement for e-signature the moment it goes live.",
                  )}
                </p>
              </>
            )}
          </div>
          <label className="consent-row">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              {tv(
                "I agree to receive and sign documents electronically (ESIGN Act consent). I can request paper copies or withdraw this consent at any time at support@pickloads.com.",
              )}
            </span>
          </label>
          <button
            className="btn btn-amber"
            type="button"
            disabled={!consent}
            style={!consent ? { opacity: 0.6, cursor: "not-allowed", transform: "none" } : undefined}
            onClick={() => consent && setStep(6)}
          >
            {tv("Continue to Account →")}
          </button>
        </div>
      ) : null}

      {/* ---------------- Step 6 — account ---------------- */}
      {step === 6 && accountState.status !== "success" ? (
        <div className="bigform">
          <h2>{tv("Create your carrier portal account")}</h2>
          <p>
            {tv(
              "Track document review, your agreement and — once dispatch starts — your loads.",
            )}
          </p>
          <form action={accountAction}>
            <input type="hidden" name="carrier_id" value={carrierId ?? ""} />
            <input type="hidden" name="full_name" value={info.full_name} />
            <input type="hidden" name="phone" value={info.phone} />
            {/* Display only. `completeOnboarding` writes the profile's
                company name from this value, and the CARRIER row's name comes
                from the verified pre-registration either way. */}
            <input type="hidden" name="company_name" value={startState.companyName ?? ""} />
            <input type="hidden" name="esign_consent" value={consent ? "on" : ""} />
            <input type="hidden" name="locale" value={locale} />
            <div className="grid2">
              <div className="field">
                <label htmlFor="ob-acc-email">{tv("Email")}</label>
                <input id="ob-acc-email" name="email" type="email" required defaultValue={info.email} autoComplete="email" />
              </div>
              <div className="field">
                <label htmlFor="ob-acc-pass">{tv("Password (8+ characters)")}</label>
                <input id="ob-acc-pass" name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="••••••••" />
              </div>
            </div>
            <button className="btn btn-amber" type="submit" aria-busy={accountPending} disabled={accountPending} style={{ marginTop: 4 }}>
              {accountPending ? tv("Creating account…") : tv("Create Account & Finish →")}
            </button>
          </form>
          <div className={`form-err${accountState.status === "error" ? " show" : ""}`} role="alert">
            {accountState.status === "error" && accountState.message ? tv(accountState.message) : null}
          </div>
        </div>
      ) : null}

      {/* ---------------- Done ---------------- */}
      {accountState.status === "success" ? (
        <div className="bigform">
          {/* §23: this used to say "You're onboarded. Welcome to PickLoads."
              An account exists; an onboarding does not. Documents are still
              unreviewed, the agreement is unsigned, the fee is uncollected and
              `carriers.active` is false — so the heading now says what is
              actually true and nothing more. */}
          <h2>{tv("Account created — pending compliance review.")}</h2>
          {/* The wording had to change AND had to change early in the string.
              `slugifyV4` truncates at 56 characters, so appending the new
              "not active until…" clause to the old sentence would have
              produced the OLD key — and `useV4` would have found it and
              rendered the old, shorter claim in every locale including
              English. A silent no-op is the worst outcome for a correction
              about what "created" does and does not mean. */}
          <div className="form-ok show" role="status">
            {tv(
              "✓ ACCOUNT CREATED, PENDING REVIEW — your account is not active until our document review, the dispatch agreement and the verification fee are complete. We review documents within one business day.",
            )}{" "}
            {accountState.esign === "sent"
              ? tv("Your dispatch agreement is on its way to your inbox for e-signature.")
              : tv("We'll email your dispatch agreement for e-signature as soon as it goes live.")}
          </div>
          <div style={{ marginTop: 22, display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Link className="btn btn-amber" href="/login">
              {tv("Sign in to your portal →")}
            </Link>
            <a className="btn btn-dark" href="tel:+19084045373">
              {tv("Questions? (908) 404-5373")}
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
