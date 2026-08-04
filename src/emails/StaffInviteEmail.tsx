import { InternalNotification } from "./InternalNotification";

/**
 * M-58 — staff invite email (S-04 in-app). Carries the ONE place the raw
 * invite token ever exists: the tokenized accept link. Single-use, expiring.
 */
export function StaffInviteEmail({
  inviteUrl,
  role,
  invitedByName,
  expiresAt,
}: {
  inviteUrl: string;
  role: "admin" | "dispatcher";
  invitedByName: string | null;
  expiresAt: string;
}) {
  return (
    <InternalNotification
      eyebrow="Staff invite"
      title="You're invited to the PickLoads dispatch desk"
      preview={`Staff invite — ${role} access to the PickLoads desk`}
      rows={[
        { label: "Role", value: role.toUpperCase() },
        {
          label: "Invited by",
          value: invitedByName ?? "PickLoads admin",
        },
        {
          label: "Accept your invite",
          value: inviteUrl,
        },
        {
          label: "Expires",
          value: new Date(expiresAt).toLocaleString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/New_York",
          }) + " ET",
        },
      ]}
      footNote="// The link is single-use. If you weren't expecting this, ignore it — nothing happens without the link."
    />
  );
}
