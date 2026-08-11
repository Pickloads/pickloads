import { InternalNotification } from "./InternalNotification";

/**
 * M-81 — broker-partner invite email (§12 *"invited by an admin"*).
 *
 * Carries the ONE place the raw invite token ever exists: the tokenized accept
 * link. Single-use, expiring, and the database stores only its SHA-256 hash —
 * M-58's idiom, unchanged.
 *
 * WHAT IT DOES NOT SAY: whether the organization is verified. §12 makes
 * verification a separate admin act, and an invite email that implied access
 * was live would be the presentational version of the gap §30 forbids. The
 * accept page and the portal both state the real state instead.
 *
 * English, like every other staff-adjacent email in the product (M-60's scope
 * decision): the recipient is a business counterparty being onboarded by a
 * PickLoads admin, not a customer arriving through a localized funnel.
 */
export function BrokerInviteEmail({
  inviteUrl,
  companyName,
  invitedByName,
  expiresAt,
}: {
  inviteUrl: string;
  companyName: string;
  invitedByName: string | null;
  expiresAt: string;
}) {
  return (
    <InternalNotification
      eyebrow="Broker partner invite"
      title="You're invited to the PickLoads partner portal"
      preview={`Partner portal invite — ${companyName}`}
      rows={[
        { label: "Organization", value: companyName },
        { label: "Invited by", value: invitedByName ?? "PickLoads admin" },
        { label: "Accept your invite", value: inviteUrl },
        {
          label: "Expires",
          value:
            new Date(expiresAt).toLocaleString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZone: "America/New_York",
            }) + " ET",
        },
      ]}
      footNote="// The link is single-use and gives access to shipments PickLoads shares with your organization — status, timeline, POD and BOL. It never shows carrier records, billing or rates. If you weren't expecting this, ignore it; nothing happens without the link."
    />
  );
}
