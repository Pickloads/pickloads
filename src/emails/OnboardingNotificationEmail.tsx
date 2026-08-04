import { InternalNotification } from "./InternalNotification";

/** Internal notification for M-20 wizard milestones (started / completed). */
export function OnboardingNotificationEmail({
  stage,
  companyName,
  fullName,
  email,
  phone,
  mcNumber,
  esignSent,
}: {
  stage: "started" | "completed";
  companyName: string;
  fullName: string;
  email: string;
  phone: string;
  mcNumber: string | null;
  esignSent?: boolean;
}) {
  const started = stage === "started";
  return (
    <InternalNotification
      eyebrow={
        started
          ? "Carrier onboarding started"
          : "Carrier onboarding completed"
      }
      title={companyName}
      preview={`${companyName} — onboarding ${stage}`}
      rows={[
        { label: "Company", value: companyName },
        { label: "Contact", value: fullName },
        { label: "Phone", value: phone },
        { label: "Email", value: email },
        { label: "MC #", value: mcNumber ?? "—" },
        ...(started
          ? []
          : [
              {
                label: "Dispatch agreement",
                value: esignSent
                  ? "Sent for e-signature (Dropbox Sign)"
                  : "PENDING — e-sign not yet live; follow up manually",
              },
            ]),
      ]}
      footNote={
        started
          ? "// Wizard step 1 complete. If documents don't follow within a day, call them — the lead is in the CRM (source: become_a_carrier)."
          : "// Portal account created. Review uploaded documents in the admin dashboard."
      }
    />
  );
}
