import { InternalNotification } from "./InternalNotification";
import type { CarrierLeadInput } from "@/lib/validation/carrier-lead";

/** Internal "new carrier lead" notification — Flux 1 (call back within 15 min). */
export function LeadNotificationEmail({ lead }: { lead: CarrierLeadInput }) {
  return (
    <InternalNotification
      eyebrow="New carrier lead — call within 15 minutes"
      title={`${lead.truck_type ?? "Carrier"} · ${lead.phone}`}
      preview={`New carrier lead: ${lead.phone} (${lead.truck_type ?? "unknown truck"})`}
      rows={[
        { label: "Phone (call now)", value: lead.phone },
        { label: "Truck type", value: lead.truck_type ?? "—" },
        { label: "Trailer type", value: lead.trailer_type ?? "—" },
        { label: "Home state", value: lead.home_state ?? "—" },
        { label: "# of trucks", value: lead.truck_count ?? "—" },
        { label: "Form language", value: lead.locale.toUpperCase() },
      ]}
      footNote="// Quick form collects phone only (audit F-12) — no auto-reply was sent. The 15-minute callback promise starts now."
    />
  );
}
