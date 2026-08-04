import { InternalNotification } from "./InternalNotification";
import type { ContactMessageInput } from "@/lib/validation/contact-message";

/** Internal "new contact message" notification. */
export function ContactNotificationEmail({
  message,
}: {
  message: ContactMessageInput;
}) {
  return (
    <InternalNotification
      eyebrow="New contact message"
      title={message.subject ?? "(no subject)"}
      preview={`Contact form: ${message.subject ?? "(no subject)"} — ${message.email}`}
      rows={[
        { label: "From", value: message.full_name ?? "—" },
        { label: "Email (reply-to)", value: message.email },
        { label: "Phone", value: message.phone ?? "—" },
        { label: "Subject", value: message.subject ?? "—" },
        { label: "Message", value: message.body },
        { label: "Form language", value: message.locale.toUpperCase() },
      ]}
      footNote="// Reply directly to this email to answer (reply-to is set)."
    />
  );
}
