import "server-only";

import type { ReactElement } from "react";
import { Resend } from "resend";
import { tryCreateAdminClient } from "@/lib/supabase/admin";

/**
 * Resend wrapper (M-14). Every send — real or skipped — is journaled to
 * `email_log` via the admin client (audit O-06: the Notifications dashboard
 * reads this table).
 *
 * Graceful degradation:
 * - RESEND_API_KEY unset → no network call; the payload is logged to the
 *   console and email_log still records the attempt (template `…` + status).
 * - Service-role key unset → email_log write is skipped with a warning.
 * Failures here never fail the calling form action: the lead/quote row is
 * already committed; email is best-effort notification.
 */
export interface SendEmailArgs {
  to: string;
  subject: string;
  /** email_log.template identifier, e.g. "carrier-lead-notification". */
  template: string;
  react: ReactElement;
  replyTo?: string;
  leadId?: string;
  quoteId?: string;
}

export const EMAIL_FROM =
  process.env.EMAIL_FROM ?? "PickLoads <notifications@pickloads.com>";
export const EMAIL_INTERNAL_TO =
  process.env.EMAIL_INTERNAL_TO ?? "support@pickloads.com";

export async function sendEmail(args: SendEmailArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  let status: "sent" | "failed" = "sent";
  let providerMessageId: string | null = null;
  let errorMessage: string | null = null;

  if (!apiKey) {
    console.info(
      `[email] RESEND_API_KEY unset — log-only mode: "${args.template}" → ${args.to} (${args.subject})`,
    );
  } else {
    try {
      const resend = new Resend(apiKey);
      const { data, error } = await resend.emails.send({
        from: EMAIL_FROM,
        to: args.to,
        subject: args.subject,
        react: args.react,
        ...(args.replyTo ? { replyTo: args.replyTo } : {}),
      });
      if (error) {
        status = "failed";
        errorMessage = error.message;
      } else {
        providerMessageId = data?.id ?? null;
      }
    } catch (err) {
      status = "failed";
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  if (status === "failed") {
    console.error(`[email] send failed (${args.template}): ${errorMessage}`);
  }

  try {
    const admin = tryCreateAdminClient();
    if (admin) {
      const { error } = await admin.from("email_log").insert({
        to_email: args.to,
        template: args.template,
        subject: args.subject,
        provider_message_id: providerMessageId,
        status,
        error: errorMessage,
        lead_id: args.leadId ?? null,
        quote_id: args.quoteId ?? null,
      });
      if (error) console.error("[email] email_log write failed", error.message);
    }
  } catch (err) {
    console.error("[email] email_log write failed", err);
  }
}
