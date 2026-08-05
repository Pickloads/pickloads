"use server";

import type { FormState } from "@/lib/form-state";
import {
  field,
  guardPublicForm,
  SERVER_ERROR_MESSAGE,
} from "@/lib/forms/guard";
import { subscriberSchema } from "@/lib/validation/subscriber";
import { firstIssueMessage } from "@/lib/validation/shared";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { EMAIL_INTERNAL_TO, sendEmail } from "@/lib/email/send";
import { NewsletterConfirmationEmail } from "@/emails/NewsletterConfirmationEmail";
import { checkRateLimit } from "@/lib/rate-limit";
import { headers } from "next/headers";
import {
  marketingUnsubscribeHeaders,
  unsubscribeUrl,
  type UnsubscribeOutcome,
} from "@/lib/newsletter";
import { applyUnsubscribe } from "@/lib/newsletter-unsubscribe";

/**
 * Newsletter signup with double opt-in (audit S-05): insert (or re-use) the
 * subscriber row, then email a confirm link that /api/newsletter/confirm
 * validates. Idempotent: re-subscribing re-sends the confirmation; an already
 * confirmed address just returns success (no address enumeration in the UI —
 * every valid submission shows the same "check your inbox" state).
 */
export async function subscribeNewsletter(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const guard = await guardPublicForm("newsletter", formData);
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = subscriberSchema.safeParse({
    email: field(formData, "email"),
    locale: field(formData, "locale"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const { email, locale } = parsed.data;

  let confirmToken: string | null = null;
  let unsubToken: string | null = null;
  try {
    const admin = tryCreateAdminClient();
    if (admin) {
      const { data: existing, error: readError } = await admin
        .from("subscribers")
        .select("confirm_token, unsubscribe_token, confirmed_at, unsubscribed_at")
        .eq("email", email)
        .maybeSingle();
      if (readError) throw new Error(readError.message);

      if (!existing) {
        const { data, error } = await admin
          .from("subscribers")
          .insert({ email, locale })
          .select("confirm_token, unsubscribe_token")
          .single();
        if (error) throw new Error(error.message);
        confirmToken = data.confirm_token;
        unsubToken = data.unsubscribe_token;
      } else if (existing.confirmed_at && !existing.unsubscribed_at) {
        return { status: "success" }; // already on the list — same UI state
      } else {
        // unconfirmed, or resubscribing after unsubscribe → re-send confirm.
        // M-69/P-1: unsubscribe_token is deliberately NOT rotated here — it
        // is the credential printed in every issue already delivered.
        confirmToken = existing.confirm_token;
        unsubToken = existing.unsubscribe_token;
        if (existing.unsubscribed_at) {
          const { error } = await admin
            .from("subscribers")
            .update({ unsubscribed_at: null, confirmed_at: null, locale })
            .eq("email", email);
          if (error) throw new Error(error.message);
        }
      }
    }
  } catch (err) {
    console.error("[newsletter] subscribe failed", err);
    return { status: "error", message: SERVER_ERROR_MESSAGE };
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const confirmUrl = `${siteUrl}/api/newsletter/confirm?token=${confirmToken ?? "dev-mode-no-token"}`;

  // M-69/P-1: the confirmation email is the FIRST thing a subscriber
  // receives and the place the "unsubscribe anytime" promise is made, so it
  // carries a working opt-out link and the RFC 8058 one-click header pair —
  // exactly like every later marketing issue must (see docs/modules/M-69).
  // Secretless dev has no token: the link is omitted rather than faked.
  const unsubUrl = unsubToken ? unsubscribeUrl(siteUrl, unsubToken) : null;

  await sendEmail({
    to: email,
    subject: "Confirm your Freight Insights subscription",
    template: "newsletter-confirmation",
    react: <NewsletterConfirmationEmail confirmUrl={confirmUrl} unsubscribeUrl={unsubUrl} />,
    ...(unsubToken
      ? {
          headers: marketingUnsubscribeHeaders({
            siteUrl,
            token: unsubToken,
            mailto: EMAIL_INTERNAL_TO,
          }),
        }
      : {}),
  });

  return { status: "success" };
}

/**
 * M-69 / P-1 — the POST half of the human unsubscribe page.
 *
 * Reached only from the confirmation button on /newsletter/unsubscribe; the
 * GET render of that page never mutates (email scanners prefetch links).
 * Rate limited per IP: the token is unguessable, but the endpoint must not
 * become a free write amplifier or a token-probing oracle.
 *
 * Returns FormState so the page reuses the shared U-03 loading/success/error
 * vocabulary; `already` is reported as SUCCESS (idempotency).
 */
export async function unsubscribeNewsletter(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  if (!(await checkRateLimit("newsletter-unsubscribe", ip, 10))) {
    return {
      status: "error",
      message:
        "Too many requests from your network. Wait a few minutes, or email support@pickloads.com and we'll remove you.",
    };
  }

  const outcome: UnsubscribeOutcome = await applyUnsubscribe(
    field(formData, "token"),
  );
  if (outcome === "unsubscribed" || outcome === "already") {
    return { status: "success", message: outcome };
  }
  if (outcome === "invalid") {
    return {
      status: "error",
      message:
        "This unsubscribe link is no longer valid. Email support@pickloads.com and we'll remove you by hand.",
    };
  }
  return {
    status: "error",
    message:
      "We couldn't reach the subscriber list just now — nothing was changed. Try again, or email support@pickloads.com.",
  };
}
