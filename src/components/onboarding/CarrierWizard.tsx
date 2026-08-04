"use client";

import { useEffect, useRef, useState } from "react";
import { useActionState } from "react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import {
  completeOnboarding,
  startOnboarding,
  uploadCarrierDocument,
} from "@/app/actions/onboarding";
import {
  initialAccountState,
  initialStartState,
} from "@/lib/onboarding-state";
import { TurnstileWidget } from "@/components/forms/TurnstileWidget";
import type { DocType } from "@/lib/supabase/database.types";

/**
 * M-20 — 4-step become-a-carrier wizard (audit U-10 net-new surface, V4
 * vocabulary: .steps progress, .bigform fields, .upload dropzones).
 * Steps: 1 company info → 2 documents → 3 e-sign consent → 4 account.
 */

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

interface StepOneInfo {
  company_name: string;
  full_name: string;
  email: string;
  phone: string;
}

type UploadStatus =
  | { s: "idle" }
  | { s: "uploading" }
  | { s: "done"; fileName: string }
  | { s: "error"; message: string };

function DocUpload({
  carrierId,
  docType,
  title,
  blurb,
  onDone,
}: {
  carrierId: string;
  docType: DocType;
  title: string;
  blurb: string;
  onDone: () => void;
}) {
  const tv = useV4();
  const [status, setStatus] = useState<UploadStatus>({ s: "idle" });
  const lastFile = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function send(file: File) {
    lastFile.current = file;
    setStatus({ s: "uploading" });
    try {
      const fd = new FormData();
      fd.set("carrier_id", carrierId);
      fd.set("doc_type", docType);
      fd.set("file", file);
      const result = await uploadCarrierDocument(fd);
      if (result.ok) {
        setStatus({ s: "done", fileName: result.fileName });
        onDone();
      } else {
        setStatus({ s: "error", message: result.error });
      }
    } catch {
      setStatus({
        s: "error",
        message: "Upload failed — check your connection and retry.",
      });
    }
  }

  const stateClass =
    status.s === "done" ? " picked" : status.s === "error" ? " err" : "";

  return (
    <div
      className={`upload${stateClass}`}
      role="button"
      tabIndex={0}
      aria-label={`${tv(title)} — ${tv("upload")}`}
      style={{ position: "relative", padding: "30px 22px" }}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) void send(file);
      }}
    >
      <span className="big" aria-hidden="true">
        {status.s === "done" ? "✓" : "⇪"}
      </span>
      <b>{tv(title)}</b>
      <span>{tv(blurb)}</span>
      {status.s === "idle" ? (
        <span className="mono">
          {"// "}
          {tv("PDF, JPG, PNG or HEIC · max 10 MB")}
        </span>
      ) : null}
      {status.s === "uploading" ? (
        <span className="st" role="status">
          {tv("Uploading…")}
        </span>
      ) : null}
      {status.s === "done" ? (
        <span className="st ok" role="status">
          ✓ {status.fileName}
        </span>
      ) : null}
      {status.s === "error" ? (
        <>
          <span className="st bad" role="alert">
            ✕ {tv(status.message)}
          </span>
          <button
            type="button"
            className="btn btn-dark"
            style={{ padding: "8px 16px", fontSize: ".78rem", marginTop: 8 }}
            onClick={(e) => {
              e.stopPropagation();
              if (lastFile.current) void send(lastFile.current);
              else inputRef.current?.click();
            }}
          >
            {tv("Retry upload")}
          </button>
        </>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.heic,application/pdf,image/jpeg,image/png,image/heic"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void send(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function CarrierWizard({ esignLive }: { esignLive: boolean }) {
  const tv = useV4();
  const locale = useLocale();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [info, setInfo] = useState<StepOneInfo>({
    company_name: "",
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
    if (startState.status === "success" && startState.carrierId) setStep(2);
  }, [startState]);

  const stepClass = (n: 1 | 2 | 3 | 4) =>
    `step${step === n ? " current" : ""}${step > n ? " done" : ""}`;

  const setField =
    (key: keyof StepOneInfo) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setInfo((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <div className="wizard">
      {/* Progress indicator — V4 .steps vocabulary */}
      <ol className="steps" style={{ listStyle: "none", padding: 0 }} aria-label={tv("Onboarding progress")}>
        <li className={stepClass(1)} aria-current={step === 1 ? "step" : undefined}>
          <span className="n">{tv("STEP 1")}</span>
          <h3>{tv("Company info")}</h3>
          <p>{tv("Who you are and how we reach you.")}</p>
        </li>
        <li className={stepClass(2)} aria-current={step === 2 ? "step" : undefined}>
          <span className="n">{tv("STEP 2")}</span>
          <h3>{tv("Documents")}</h3>
          <p>{tv("MC letter, COI, W-9, voided check.")}</p>
        </li>
        <li className={stepClass(3)} aria-current={step === 3 ? "step" : undefined}>
          <span className="n">{tv("STEP 3")}</span>
          <h3>{tv("Agreement")}</h3>
          <p>{tv("Plain-English dispatch agreement, e-signed.")}</p>
        </li>
        <li className={stepClass(4)} aria-current={step === 4 ? "step" : undefined}>
          <span className="n">{tv("STEP 4")}</span>
          <h3>{tv("Your portal")}</h3>
          <p>{tv("Create your account. Done.")}</p>
        </li>
      </ol>

      {/* ---------------- Step 1 — company info ---------------- */}
      {step === 1 ? (
        <div className="bigform">
          <h2>{tv("Tell us about your operation")}</h2>
          <p>
            {tv(
              "About 5 minutes. Fields marked optional can be completed later from your portal.",
            )}
          </p>
          <form action={startAction}>
            <input type="hidden" name="locale" value={locale} />
            <div className="grid2">
              <div className="field">
                <label htmlFor="ob-company">{tv("Company Name")}</label>
                <input id="ob-company" name="company_name" type="text" required value={info.company_name} onChange={setField("company_name")} autoComplete="organization" placeholder={tv("Your company LLC")} />
              </div>
              <div className="field">
                <label htmlFor="ob-name">{tv("Your Full Name")}</label>
                <input id="ob-name" name="full_name" type="text" required value={info.full_name} onChange={setField("full_name")} autoComplete="name" placeholder="John Carter" />
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label htmlFor="ob-email">{tv("Email")}</label>
                <input id="ob-email" name="email" type="email" required value={info.email} onChange={setField("email")} autoComplete="email" placeholder="you@company.com" />
              </div>
              <div className="field">
                <label htmlFor="ob-phone">{tv("Phone")}</label>
                <input id="ob-phone" name="phone" type="tel" required value={info.phone} onChange={setField("phone")} autoComplete="tel" inputMode="tel" placeholder="(___) ___-____" />
              </div>
            </div>
            <div className="grid3">
              <div className="field">
                <label htmlFor="ob-mc">{tv("MC # (optional)")}</label>
                <input id="ob-mc" name="mc_number" type="text" placeholder="MC-000000" />
              </div>
              <div className="field">
                <label htmlFor="ob-dot">{tv("USDOT # (optional)")}</label>
                <input id="ob-dot" name="dot_number" type="text" placeholder="0000000" />
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
            <TurnstileWidget theme="light" />
            <button className="btn btn-amber" type="submit" aria-busy={startPending} disabled={startPending} style={{ marginTop: 4 }}>
              {startPending ? tv("Saving…") : tv("Continue to Documents →")}
            </button>
          </form>
          <div className={`form-err${startState.status === "error" ? " show" : ""}`} role="alert">
            {startState.status === "error" && startState.message ? tv(startState.message) : null}
          </div>
        </div>
      ) : null}

      {/* ---------------- Step 2 — documents ---------------- */}
      {step === 2 && carrierId ? (
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
          <p className="mono" style={{ fontSize: ".72rem", color: "var(--color-slate-soft)", margin: "10px 0 18px" }}>
            {"// "}
            {tv(
              "Files are stored in a private, encrypted bucket and reviewed by our compliance team — never public.",
            )}
          </p>
          <button className="btn btn-amber" type="button" onClick={() => setStep(3)}>
            {uploadedCount > 0
              ? tv("Continue to Agreement →")
              : tv("Skip for now — Continue →")}
          </button>
        </div>
      ) : null}

      {/* ---------------- Step 3 — e-sign consent ---------------- */}
      {step === 3 ? (
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
            onClick={() => consent && setStep(4)}
          >
            {tv("Continue to Account →")}
          </button>
        </div>
      ) : null}

      {/* ---------------- Step 4 — account ---------------- */}
      {step === 4 && accountState.status !== "success" ? (
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
            <input type="hidden" name="company_name" value={info.company_name} />
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
          <h2>{tv("You're onboarded. Welcome to PickLoads.")}</h2>
          <div className="form-ok show" role="status">
            {tv(
              "✓ ACCOUNT CREATED — Our team reviews your documents within one business day.",
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
