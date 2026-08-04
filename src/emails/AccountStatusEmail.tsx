import { InternalNotification } from "./InternalNotification";

/**
 * M-58 — customer-facing account status change notice (approve / suspend /
 * reactivate), sent by the admin account-management actions.
 */
export function AccountStatusEmail({
  fullName,
  status,
  reason,
}: {
  fullName: string | null;
  status: "active" | "suspended";
  reason: string | null;
}) {
  const approved = status === "active";
  return (
    <InternalNotification
      eyebrow={approved ? "Account approved" : "Account suspended"}
      title={
        approved
          ? `You're in${fullName ? `, ${fullName}` : ""} — your PickLoads account is active`
          : "Your PickLoads account has been suspended"
      }
      preview={
        approved
          ? "Your PickLoads account is active — sign in to your portal."
          : "Your PickLoads account was suspended — here's what to do."
      }
      rows={[
        {
          label: "Status",
          value: approved ? "ACTIVE" : "SUSPENDED",
        },
        ...(reason ? [{ label: "Note from our team", value: reason }] : []),
        {
          label: approved ? "Next step" : "What to do",
          value: approved
            ? "Sign in at pickloads.com/login — your portal is ready."
            : "Call (908) 404-5373 or reply to this email and we'll work it out with you.",
        },
      ]}
      footNote="// PickLoads dispatch desk — Mon–Fri 8am–6pm, Sat 9am–2pm ET."
    />
  );
}
