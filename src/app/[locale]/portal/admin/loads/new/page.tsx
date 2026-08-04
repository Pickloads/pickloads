import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  LoadCreateForm,
  type CarrierOption,
} from "@/components/portal/LoadForms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Book a load — PickLoads",
  robots: { index: false, follow: false },
};

/**
 * M-30 — load booking form. Only ACTIVE carriers are offered (a load on an
 * un-onboarded carrier would invoice a fee nobody agreed to); dispatcher is
 * stamped server-side from the session (F-09).
 */
export default async function NewLoadPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireStaff(locale);
  const supabase = await createClient();

  const { data: carrierRows } = await supabase
    .from("carriers")
    .select("id, company_name, dispatch_fee_pct, active")
    .eq("active", true)
    .order("company_name");

  const carriers: CarrierOption[] = (carrierRows ?? []).map((c) => ({
    id: c.id,
    name: c.company_name,
    feePct: c.dispatch_fee_pct,
  }));

  return (
    <main>
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk / Operations / Loads</span>
          <h1>Book a load</h1>
        </div>
        <Link className="btn btn-ghost btn-sm" href="/portal/admin/loads">
          ← Back to loads
        </Link>
      </div>
      {carriers.length === 0 ? (
        <p className="pempty">
          No active carriers yet. A carrier becomes bookable once onboarding
          documents are approved and the agreement is signed (see the M-24
          review queue).
        </p>
      ) : (
        <LoadCreateForm carriers={carriers} />
      )}
    </main>
  );
}
