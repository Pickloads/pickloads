"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { isStaffRole } from "@/lib/auth";
import { tryCreateStripe } from "@/lib/stripe";
import { buildInvoiceIssuedEmail } from "@/emails/customer-templates";
import { resolveEmailLocale } from "@/emails/i18n";
import { notifyCustomer } from "@/lib/notify";

/**
 * M-31 — "Generate invoice" on a delivered load (staff only).
 *
 * COMPLIANCE: the invoice is for loads.dispatch_fee ONLY (F-03 snapshot).
 * Freight money never transits PickLoads — see src/lib/stripe.ts.
 *
 * Flow: delivered load → Stripe customer (carrier's login email) → invoice
 * (send_invoice, net-7) with one line item for the dispatch fee → finalize +
 * send (Stripe emails the hosted payment link) → record in `webhook_events`
 * (provider "stripe", event_type "invoice_created" — the audit ledger the
 * payment-history table reads; NO schema change, NO column misuse) → load
 * status delivered → invoiced.
 *
 * Client use: cookie-bound for load reads/updates (staff RLS + explicit role
 * check). The ADMIN client is used only where the anon key cannot go:
 * the carrier's auth email (auth.admin API) and the webhook_events ledger
 * insert (service-role-only table by design, S-02).
 */

type InvoiceResult =
  | { ok: true; invoiceId: string; hostedUrl: string | null }
  | { ok: false; error: string };

export async function generateLoadInvoice(
  loadId: string,
): Promise<InvoiceResult> {
  const id = z.uuid().safeParse(loadId);
  if (!id.success) return { ok: false, error: "Invalid load." };

  // ---- Staff gate (cookie-bound; RLS re-checks) ----
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in again." };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !isStaffRole(profile.role)) {
    return { ok: false, error: "Staff access required." };
  }

  const stripe = tryCreateStripe();
  if (!stripe) {
    return {
      ok: false,
      error: "Stripe isn't connected yet (STRIPE_SECRET_KEY). Invoice manually and mark the load invoiced.",
    };
  }
  const admin = tryCreateAdminClient();
  if (!admin) {
    return { ok: false, error: "Service credentials missing — can't journal the invoice." };
  }

  // ---- Load must be delivered with a positive fee ----
  const { data: load } = await supabase
    .from("loads")
    .select("id, carrier_id, status, dispatch_fee, gross_rate, origin_city, origin_state, dest_city, dest_state, delivery_date")
    .eq("id", id.data)
    .maybeSingle();
  if (!load) return { ok: false, error: "Load not found." };
  if (load.status !== "delivered") {
    return { ok: false, error: "Only delivered loads can be invoiced." };
  }
  if (load.dispatch_fee <= 0) {
    return { ok: false, error: "This load has no dispatch fee — check gross rate and fee %." };
  }

  const { data: carrier } = await supabase
    .from("carriers")
    .select("id, company_name, profile_id")
    .eq("id", load.carrier_id)
    .maybeSingle();
  if (!carrier) return { ok: false, error: "Carrier record missing." };

  // M-57: billing goes to the OWNER member (memberships are the
  // authoritative join, decision D4); carriers.profile_id stays as the
  // legacy fallback for rows predating the membership model.
  const { data: ownerMembership } = await admin
    .from("carrier_memberships")
    .select("profile_id")
    .eq("carrier_id", carrier.id)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const billingProfileId = ownerMembership?.profile_id ?? carrier.profile_id;
  if (!billingProfileId) {
    return { ok: false, error: "Carrier has no portal account (no billing email on file)." };
  }

  // Carrier's billing email = their portal login email (profiles carries no
  // email column; auth.users is the source of truth → admin auth API).
  const { data: authUser, error: authError } =
    await admin.auth.admin.getUserById(billingProfileId);
  const email = authUser?.user?.email;
  if (authError || !email) {
    return { ok: false, error: "Couldn't resolve the carrier's billing email." };
  }

  const lane = `${load.origin_city ?? "?"}, ${load.origin_state ?? "?"} → ${load.dest_city ?? "?"}, ${load.dest_state ?? "?"}`;
  const amountCents = Math.round(load.dispatch_fee * 100);

  try {
    // Reuse the Stripe customer keyed by email, else create one.
    const existing = await stripe.customers.list({ email, limit: 1 });
    const customer =
      existing.data[0] ??
      (await stripe.customers.create({
        email,
        name: carrier.company_name,
        metadata: { carrier_id: carrier.id },
      }));

    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: "send_invoice",
      days_until_due: 7,
      auto_advance: false,
      metadata: { load_id: load.id, carrier_id: carrier.id },
      description: `PickLoads dispatch fee — ${lane}${load.delivery_date ? ` (delivered ${load.delivery_date})` : ""}`,
    });
    if (!invoice.id) throw new Error("Stripe returned an invoice without id");

    await stripe.invoiceItems.create({
      customer: customer.id,
      invoice: invoice.id,
      amount: amountCents,
      currency: "usd",
      description: `Dispatch service fee — ${lane}`,
    });

    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
    await stripe.invoices.sendInvoice(invoice.id); // Stripe emails the payment link
    const hostedUrl = finalized.hosted_invoice_url ?? null;

    // ---- Journal to the webhook_events ledger (S-02 pattern) ----
    const { error: ledgerError } = await admin.from("webhook_events").insert({
      provider: "stripe",
      event_id: `invoice_created:${invoice.id}`,
      event_type: "invoice_created",
      payload: {
        load_id: load.id,
        carrier_id: carrier.id,
        invoice_id: invoice.id,
        hosted_invoice_url: hostedUrl,
        amount_usd: load.dispatch_fee,
        to_email: email,
      },
      status: "processed",
      processed_at: new Date().toISOString(),
    });
    if (ledgerError) {
      // Invoice exists in Stripe; ledger miss is loud but not fatal.
      console.error("[billing] ledger write failed", ledgerError.message);
    }

    // ---- M-55: invoices mirror row (0008) — the queryable billing record
    // the carrier "Invoices & Payments" page reads. Stripe stays the system
    // of record for money; the webhook updates status transitions. ----
    const { error: mirrorError } = await admin.from("invoices").insert({
      carrier_id: carrier.id,
      load_id: load.id,
      stripe_invoice_id: invoice.id,
      amount_cents: amountCents,
      currency: "usd",
      status: "open",
      hosted_url: hostedUrl,
      issued_at: new Date().toISOString(),
      due_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (mirrorError) {
      console.error("[billing] invoice mirror write failed", mirrorError.message);
    }

    // ---- M-60: branded invoice-issued email + portal notification (the
    // Stripe hosted-invoice email carries the payment link; ours carries
    // context + the portal trail). Recipient/billing email were resolved
    // above; language from the billing profile. ----
    {
      const { data: billingProfile } = await admin
        .from("profiles")
        .select("preferred_language, full_name")
        .eq("id", billingProfileId)
        .maybeSingle();
      const emailBuilt = buildInvoiceIssuedEmail(
        resolveEmailLocale(billingProfile?.preferred_language),
        {
          lane,
          amountUsd: load.dispatch_fee,
          dueDays: 7,
          hostedUrl,
        },
      );
      await notifyCustomer({
        recipient: {
          profileId: billingProfileId,
          email,
          locale: resolveEmailLocale(billingProfile?.preferred_language),
          fullName: billingProfile?.full_name ?? null,
        },
        kind: "invoice_issued",
        title: emailBuilt.subject,
        href: "/portal/carrier/invoices",
        email: emailBuilt,
      });
    }

    // ---- delivered → invoiced (cookie-bound: RLS + M-30 state machine) ----
    const { error: statusError } = await supabase
      .from("loads")
      .update({ status: "invoiced" })
      .eq("id", load.id)
      .eq("status", "delivered");
    if (statusError) {
      console.error("[billing] status update failed", statusError.message);
      return {
        ok: false,
        error: `Invoice ${invoice.id} sent, but the load status didn't update — set it to invoiced manually.`,
      };
    }

    return { ok: true, invoiceId: invoice.id, hostedUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[billing] invoice generation failed", message);
    return { ok: false, error: `Stripe error: ${message}` };
  }
}
