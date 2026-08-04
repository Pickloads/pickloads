import { InternalNotification } from "./InternalNotification";

/**
 * O-01 (M-35 crons) — carrier-facing insurance expiry warning, sent at the
 * 30/14/7/3/1/0-day thresholds by /api/cron/daily.
 */
export function InsuranceExpiryEmail({
  companyName,
  expiryDate,
  daysLeft,
}: {
  companyName: string;
  expiryDate: string;
  daysLeft: number;
}) {
  const urgency =
    daysLeft <= 0
      ? "Your certificate of insurance has EXPIRED — we cannot dispatch loads until a current COI is on file."
      : daysLeft <= 7
        ? `Your certificate of insurance expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Without a current COI we must pause dispatch.`
        : `Your certificate of insurance expires in ${daysLeft} days. Renewing early keeps your dispatch uninterrupted.`;
  return (
    <InternalNotification
      eyebrow="Insurance renewal needed"
      title={`COI expiring — ${companyName}`}
      preview={urgency}
      rows={[
        { label: "Company", value: companyName },
        { label: "Insurance expiry", value: expiryDate },
        {
          label: "Days remaining",
          value: daysLeft <= 0 ? "EXPIRED" : String(daysLeft),
        },
        {
          label: "What to do",
          value:
            "Ask your agent for an updated COI (PickLoads Logistics Group LLC as certificate holder) and upload it in your carrier portal, or reply to this email.",
        },
      ]}
      footNote="// Questions? Call (908) 404-5373 — Mon–Fri 8am–6pm, Sat 9am–2pm ET."
    />
  );
}
