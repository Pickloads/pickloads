import { InternalNotification } from "./InternalNotification";

/**
 * M-52/M-53 — internal notification for public /create-account signups
 * (carrier + shipper branches). The routing line tells the desk what happens
 * next (onboarding / pending verification / new-authority funnel / manual
 * review) so nobody has to decode tags in the CRM.
 */
export function AccountSignupEmail({
  kind,
  companyName,
  fullName,
  email,
  phone,
  routing,
  detail,
}: {
  kind: "carrier" | "shipper";
  companyName: string;
  fullName: string;
  email: string;
  phone: string;
  /** Human-readable routing outcome, e.g. "MC active → onboarding". */
  routing: string;
  /** Extra context row (MC # for carriers, industry/frequency for shippers). */
  detail?: string;
}) {
  return (
    <InternalNotification
      eyebrow={
        kind === "carrier"
          ? "New carrier account (public signup)"
          : "New shipper account (public signup)"
      }
      title={companyName}
      preview={`${companyName} — ${kind} account created`}
      rows={[
        { label: "Company", value: companyName },
        { label: "Contact", value: fullName },
        { label: "Phone", value: phone },
        { label: "Email", value: email },
        { label: "Routing", value: routing },
        ...(detail ? [{ label: "Details", value: detail }] : []),
      ]}
      footNote="// Created via /create-account (rate-limited, Turnstile-verified). The account is email-unconfirmed until the user clicks the Supabase verification link."
    />
  );
}
