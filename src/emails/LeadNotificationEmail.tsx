import { InternalNotification } from "./InternalNotification";
import type { CarrierLeadInput } from "@/lib/validation/carrier-lead";

/**
 * Internal "new carrier lead" notification — Flux 1.
 *
 * The 15-minute figure lives HERE and nowhere public (owner decision A2,
 * 2026-08-12). This email is addressed to staff, so fifteen minutes is an
 * instruction to a person — an internal operational target. The public site
 * promises only "typically within the hour during business hours", via
 * `RESPONSE_PROMISE`.
 *
 * Do not copy this number back onto a customer-facing surface. It was a
 * public "callback promise" until the owner removed it, and the reason it
 * survives internally is precisely that nobody outside the company reads it.
 */
export function LeadNotificationEmail({ lead }: { lead: CarrierLeadInput }) {
  return (
    <InternalNotification
      eyebrow="New carrier lead — call within 15 minutes"
      title={`${lead.truck_type ?? "Carrier"} · ${lead.phone}`}
      preview={`New carrier lead: ${lead.phone} (${lead.truck_type ?? "unknown truck"})`}
      rows={[
        { label: "Phone (call now)", value: lead.phone },
        {
          label: "Lead type",
          value:
            lead.lead_type === "new_authority"
              ? "NEW AUTHORITY (start-your-trucking-company)"
              : "Dispatch",
        },
        { label: "Name", value: lead.full_name ?? "—" },
        { label: "Email", value: lead.email ?? "—" },
        { label: "Truck type", value: lead.truck_type ?? "—" },
        ...(lead.stage ? [{ label: "Stage", value: lead.stage }] : []),
        { label: "Trailer type", value: lead.trailer_type ?? "—" },
        { label: "Home state", value: lead.home_state ?? "—" },
        { label: "# of trucks", value: lead.truck_count ?? "—" },
        { label: "Form language", value: lead.locale.toUpperCase() },
      ]}
      footNote="// Quick form collects phone only (audit F-12) — no auto-reply was sent. Internal target: call back within 15 minutes. The customer was told we typically reply within the hour during business hours."
    />
  );
}
