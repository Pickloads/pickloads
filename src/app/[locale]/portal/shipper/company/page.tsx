import type { Metadata } from "next";
import { requireShipper } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyShipperId } from "@/lib/memberships";
import { getV4 } from "@/i18n/v4-server";
import { ShipperCompanyForm } from "@/components/portal/ShipperCompanyForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Company Settings — PickLoads Shipper Portal",
  robots: { index: false, follow: false },
};

/**
 * M-56 — self-serve shipper company settings (nothing regulated: shippers
 * carry no MC/EIN data). Read cookie-bound ("member read own shipper");
 * write via the shipper-portal action (service role, membership-verified).
 */
export default async function ShipperCompanyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireShipper(locale);
  const tv = await getV4(locale);
  const supabase = await createClient();

  const shipperId = await getMyShipperId(supabase);
  const { data: shipper } = shipperId
    ? await supabase
        .from("shippers")
        .select(
          "company_name, industry, shipping_frequency, regions, phone, billing_email",
        )
        .eq("id", shipperId)
        .maybeSingle()
    : { data: null };

  return (
    <main>
      <div className="pbar">
        <div>
          <span className="crumb">{tv("Shipper portal")}</span>
          <h1>{tv("Company Settings")}</h1>
        </div>
      </div>

      {shipper ? (
        <div className="pcard" style={{ maxWidth: 720 }}>
          <ShipperCompanyForm
            companyName={shipper.company_name}
            industry={shipper.industry}
            shippingFrequency={shipper.shipping_frequency}
            regions={shipper.regions}
            phone={shipper.phone}
            billingEmail={shipper.billing_email}
          />
        </div>
      ) : (
        <p className="pempty">
          {tv(
            "Your account was set up by our team and isn't linked to a company record yet — quotes are matched by your sign-in email. Call (908) 404-5373 to link it.",
          )}
        </p>
      )}
    </main>
  );
}
