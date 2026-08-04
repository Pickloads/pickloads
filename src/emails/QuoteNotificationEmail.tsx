import { InternalNotification } from "./InternalNotification";
import type { FreightQuoteInput } from "@/lib/validation/freight-quote";

/** Internal "new freight quote request" notification — Flux 2 (1-hour reply). */
export function QuoteNotificationEmail({
  quote,
}: {
  quote: FreightQuoteInput;
}) {
  const lane = `${quote.pickup_zip ?? "?"} → ${quote.delivery_zip ?? "?"}`;
  return (
    <InternalNotification
      eyebrow="New freight quote — reply within 1 business hour"
      title={`${lane} · ${quote.equipment ?? "equipment TBD"}`}
      preview={`Quote request ${lane} from ${quote.company_name ?? quote.email}`}
      rows={[
        { label: "Lane (ZIP → ZIP)", value: lane },
        { label: "Pickup date", value: quote.pickup_date ?? "—" },
        { label: "Equipment", value: quote.equipment ?? "—" },
        { label: "Commodity", value: quote.commodity ?? "—" },
        {
          label: "Weight",
          value:
            quote.weight_lbs !== null
              ? `${quote.weight_lbs.toLocaleString("en-US")} lbs`
              : "—",
        },
        { label: "Pallets / pieces", value: quote.pallets ?? "—" },
        { label: "Frequency", value: quote.frequency ?? "—" },
        { label: "Company", value: quote.company_name ?? "—" },
        { label: "Email (reply-to)", value: quote.email },
        { label: "Phone", value: quote.phone ?? "—" },
        { label: "Form language", value: quote.locale.toUpperCase() },
      ]}
      footNote="// Reply directly to this email to reach the shipper (reply-to is set)."
    />
  );
}
