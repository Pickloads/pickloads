"use server";

import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { getMyShipperId } from "@/lib/memberships";
import { checkRateLimit } from "@/lib/rate-limit";
import { field } from "@/lib/forms/guard";
import { portalQuoteSchema } from "@/lib/validation/portal-quote";
import { shipperCompanySchema } from "@/lib/validation/portal";
import { firstIssueMessage } from "@/lib/validation/shared";
import { EMAIL_INTERNAL_TO, sendEmail } from "@/lib/email/send";
import { InternalNotification } from "@/emails/InternalNotification";
import type { FormState } from "@/lib/form-state";

/**
 * M-56 — shipper portal server actions.
 *
 * The quote insert is an AUTHENTICATED write: session gate → per-user rate
 * limit → Zod (full directive field set) → service-role insert carrying the
 * membership-verified shipper_id and the VERIFIED session email (never form
 * input — audit §6.3). No Turnstile: this surface sits behind login; the
 * public form keeps its own guard stack.
 */

const SIGN_IN_AGAIN = "Your session expired — sign in again.";
const NO_MEMBERSHIP =
  "Your account isn't linked to a shipper company yet — call (908) 404-5373 and we'll link it.";

export async function submitPortalQuote(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = portalQuoteSchema.safeParse({
    pickup_company: field(formData, "pickup_company"),
    pickup_address: field(formData, "pickup_address"),
    pickup_city: field(formData, "pickup_city"),
    pickup_state: field(formData, "pickup_state"),
    pickup_zip: field(formData, "pickup_zip"),
    delivery_company: field(formData, "delivery_company"),
    delivery_address: field(formData, "delivery_address"),
    delivery_city: field(formData, "delivery_city"),
    delivery_state: field(formData, "delivery_state"),
    delivery_zip: field(formData, "delivery_zip"),
    pickup_date: field(formData, "pickup_date"),
    delivery_deadline: field(formData, "delivery_deadline"),
    commodity: field(formData, "commodity"),
    weight_lbs: field(formData, "weight_lbs"),
    pallets: field(formData, "pallets"),
    dims_l_in: field(formData, "dims_l_in"),
    dims_w_in: field(formData, "dims_w_in"),
    dims_h_in: field(formData, "dims_h_in"),
    equipment: field(formData, "equipment"),
    temp_controlled: field(formData, "temp_controlled"),
    temp_min_f: field(formData, "temp_min_f"),
    temp_max_f: field(formData, "temp_max_f"),
    hazmat: field(formData, "hazmat"),
    frequency: field(formData, "frequency"),
    special_instructions: field(formData, "special_instructions"),
    contact_name: field(formData, "contact_name"),
    phone: field(formData, "phone"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }
  const q = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return { status: "error", message: SIGN_IN_AGAIN };
  if (!(await checkRateLimit("portal-quote", user.id, 10))) {
    return {
      status: "error",
      message:
        "That's a lot of quote requests at once — give it a few minutes, or call (908) 404-5373.",
    };
  }
  const shipperId = await getMyShipperId(supabase);
  if (!shipperId) return { status: "error", message: NO_MEMBERSHIP };

  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      status: "error",
      message:
        "This environment isn't connected to the database — your request was NOT submitted. Call (908) 404-5373 and we'll quote it by phone.",
    };
  }

  const { data: shipper } = await admin
    .from("shippers")
    .select("company_name")
    .eq("id", shipperId)
    .maybeSingle();

  const { error } = await admin.from("freight_quotes").insert({
    shipper_id: shipperId,
    email: user.email, // verified session email — never form input (§6.3)
    company_name: shipper?.company_name ?? null,
    contact_name: q.contact_name,
    phone: q.phone,
    pickup_company: q.pickup_company,
    pickup_address: q.pickup_address,
    pickup_city: q.pickup_city,
    pickup_state: q.pickup_state,
    pickup_zip: q.pickup_zip,
    delivery_company: q.delivery_company,
    delivery_address: q.delivery_address,
    delivery_city: q.delivery_city,
    delivery_state: q.delivery_state,
    delivery_zip: q.delivery_zip,
    pickup_date: q.pickup_date,
    delivery_deadline: q.delivery_deadline,
    commodity: q.commodity,
    weight_lbs: q.weight_lbs,
    pallets: q.pallets,
    dims_l_in: q.dims_l_in,
    dims_w_in: q.dims_w_in,
    dims_h_in: q.dims_h_in,
    equipment: q.equipment,
    temp_controlled: q.temp_controlled,
    temp_min_f: q.temp_controlled ? q.temp_min_f : null,
    temp_max_f: q.temp_controlled ? q.temp_max_f : null,
    hazmat: q.hazmat,
    frequency: q.frequency,
    special_instructions: q.special_instructions,
  });
  if (error) {
    console.error("[shipper-portal] quote insert failed", error.message);
    return {
      status: "error",
      message: "Couldn't submit the request. Retry — or call (908) 404-5373.",
    };
  }

  await sendEmail({
    to: EMAIL_INTERNAL_TO,
    subject: `Portal quote — ${q.pickup_city}, ${q.pickup_state} → ${q.delivery_city}, ${q.delivery_state}`,
    template: "portal-quote-notification",
    react: InternalNotification({
      eyebrow: "Freight quote (portal)",
      title: `${q.pickup_city}, ${q.pickup_state} → ${q.delivery_city}, ${q.delivery_state}`,
      preview: `Portal quote request — ${q.commodity}`,
      rows: [
        { label: "Shipper", value: shipper?.company_name ?? user.email },
        { label: "Contact", value: `${q.contact_name} · ${q.phone}` },
        {
          label: "Freight",
          value: `${q.commodity}${q.weight_lbs ? ` · ${q.weight_lbs.toLocaleString("en-US")} lbs` : ""}${q.pallets ? ` · ${q.pallets} pallets` : ""}`,
        },
        {
          label: "Equipment",
          value: `${q.equipment}${q.temp_controlled ? " · temp controlled" : ""}${q.hazmat ? " · HAZMAT" : ""}`,
        },
        {
          label: "Dates",
          value: `pickup ${q.pickup_date ?? "TBD"} · deadline ${q.delivery_deadline ?? "flexible"}`,
        },
      ],
      footNote: "Signed-in shipper request — quote it from the CRM quotes lane.",
    }),
    replyTo: user.email,
  });

  return { status: "success" };
}

/** M-56 — self-serve shipper company settings (nothing regulated). */
export async function updateShipperCompany(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = shipperCompanySchema.safeParse({
    company_name: field(formData, "company_name"),
    industry: field(formData, "industry"),
    shipping_frequency: field(formData, "shipping_frequency"),
    regions: field(formData, "regions"),
    phone: field(formData, "phone"),
    billing_email: field(formData, "billing_email"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstIssueMessage(parsed.error) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: SIGN_IN_AGAIN };
  const shipperId = await getMyShipperId(supabase);
  if (!shipperId) return { status: "error", message: NO_MEMBERSHIP };

  const admin = tryCreateAdminClient();
  if (!admin) {
    return {
      status: "error",
      message:
        "This environment isn't connected to the database — nothing was saved. Call (908) 404-5373.",
    };
  }
  const { error } = await admin
    .from("shippers")
    .update({
      company_name: parsed.data.company_name,
      industry: parsed.data.industry,
      shipping_frequency: parsed.data.shipping_frequency,
      regions: parsed.data.regions.length > 0 ? parsed.data.regions : null,
      phone: parsed.data.phone,
      billing_email: parsed.data.billing_email,
    })
    .eq("id", shipperId);
  if (error) {
    console.error("[shipper-portal] company update failed", error.message);
    return { status: "error", message: "Couldn't save your company info. Retry." };
  }
  return { status: "success" };
}
