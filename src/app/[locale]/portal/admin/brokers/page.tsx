import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  BrokerAgreementPanel,
  BrokerPartnerTable,
  CreateBrokerPartnerForm,
  type BrokerAgreementListItem,
  type BrokerInviteListItem,
  type BrokerPartnerListItem,
} from "@/components/portal/BrokerPartnerAdminForms";
import { BROKER_PARTNER_PAGE_SIZE } from "@/lib/validation/broker";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Broker Partners — PickLoads",
  robots: { index: false, follow: false },
};

/**
 * M-81 — `/portal/admin/brokers`: §12's partner administration.
 *
 * ── ADMIN ONLY, NOT STAFF ────────────────────────────────────────────────
 *
 * `requireAdmin`, not `requireStaff`. §12 says broker partners must be
 * *"invited by an admin"* and *"verified"*; deciding who a counterparty IS is
 * an account decision, and M-58 already established that dispatchers do not
 * make account decisions. What a DISPATCHER can do is share a shipment they
 * operate — that control lives on the shipment page, gated by
 * `resolveShipmentAccess` and the §19 dispatcher scope.
 *
 * ── THE READS RUN UNDER THE STAFF POLICY ─────────────────────────────────
 *
 * `createClient()` — cookie-bound — so `broker_partners`,
 * `broker_partner_invites` and `broker_account_agreements` come back through
 * 0018's and 0029's `is_staff()` policies rather than through the service
 * role. The service role appears only inside the actions, where it is doing
 * something a policy deliberately forbids the session to do.
 *
 * `token_hash` is not selected. It could not be rendered usefully and it is a
 * credential; 0029 grants `authenticated` nothing at all on the invite table,
 * so a staff session reads it under `is_staff()` and this projection keeps the
 * hash out of the payload regardless.
 *
 * ── §25 ──────────────────────────────────────────────────────────────────
 *
 * Four bounded reads in ONE `Promise.all`. Partner organizations are a table
 * of tens, not thousands, so the bound is generous and the page is not
 * paginated — a claim that stops being true the day it does, which is why the
 * bound is a constant with a name rather than a number typed here.
 */
export default async function AdminBrokersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireAdmin(locale);
  const supabase = await createClient();

  const [partnerResult, inviteResult, agreementResult, shipperResult] =
    await Promise.all([
      supabase
        .from("broker_partners")
        .select(
          "id, company_name, mc_number, dot_number, contact_email, active, verification_status, verified_at, authority_since, days_to_pay, bond_provider, bond_amount_usd",
        )
        .order("company_name", { ascending: true })
        .limit(BROKER_PARTNER_PAGE_SIZE),
      supabase
        .from("broker_partner_invites")
        .select("id, broker_partner_id, email, expires_at, accepted_at, revoked_at")
        .order("created_at", { ascending: false })
        .limit(BROKER_PARTNER_PAGE_SIZE * 2),
      supabase
        .from("broker_account_agreements")
        .select(
          "id, broker_partner_id, shipper_id, agreement_reference, starts_at, ends_at, revoked_at",
        )
        .order("starts_at", { ascending: false })
        .limit(BROKER_PARTNER_PAGE_SIZE * 2),
      supabase
        .from("shippers")
        .select("id, company_name")
        .order("company_name", { ascending: true })
        .limit(200),
    ]);

  const partners = (partnerResult.data ?? []) as BrokerPartnerListItem[];
  const invites = (inviteResult.data ?? []) as BrokerInviteListItem[];
  const shippers = (shipperResult.data ?? []).map((s) => ({
    id: s.id,
    name: s.company_name,
  }));
  const shipperNames = new Map(shippers.map((s) => [s.id, s.name] as const));
  const agreements: BrokerAgreementListItem[] = (agreementResult.data ?? []).map(
    (row) => ({
      ...row,
      shipper_name: shipperNames.get(row.shipper_id) ?? null,
    }),
  );

  const failed =
    partnerResult.error !== null ||
    inviteResult.error !== null ||
    agreementResult.error !== null;

  return (
    <main id="main" className="a-page">
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk</span>
          <h1>Broker partners</h1>
        </div>
      </div>

      <p className="pempty" style={{ padding: "0 0 14px" }}>
        Partner access is invitation-only and organization-scoped (§3, §12). A
        partner sees status, timeline, BOL and POD for shipments you share —
        never carrier packets or insurance, never shipper billing, never our
        commission or margin.
      </p>

      {failed ? (
        <p className="form-err show" role="alert">
          Some of this page failed to load. Reload before making changes.
        </p>
      ) : null}

      <CreateBrokerPartnerForm />
      <BrokerPartnerTable partners={partners} invites={invites} />
      <BrokerAgreementPanel
        partners={partners}
        shippers={shippers}
        agreements={agreements}
      />
    </main>
  );
}
