import { InternalNotification } from "./InternalNotification";

/** S-02: ops alert when webhook processing fails (M-22 e-sign, M-31 Stripe). */
export function WebhookFailureEmail({
  provider,
  eventType,
  eventId,
  error,
}: {
  provider: string;
  eventType: string;
  eventId: string;
  error: string;
}) {
  return (
    <InternalNotification
      eyebrow="Webhook processing failure"
      title={`${provider} · ${eventType}`}
      preview={`Webhook failure: ${provider} ${eventType}`}
      rows={[
        { label: "Provider", value: provider },
        { label: "Event type", value: eventType },
        { label: "Event id", value: eventId },
        { label: "Error", value: error },
      ]}
      footNote="// The provider will retry; the event is stored in webhook_events with status=failed. Investigate before retries exhaust."
    />
  );
}
