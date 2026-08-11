"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "@/i18n/navigation";

import {
  createBrokerAgreementAction,
  createBrokerInviteAction,
  createBrokerPartnerAction,
  revokeBrokerAgreementAction,
  revokeBrokerInviteAction,
  verifyBrokerPartnerAction,
} from "@/app/actions/broker-partners";
import { initialFormState, type FormState } from "@/lib/form-state";
import type { BrokerVerificationStatus } from "@/lib/supabase/database.types";

/**
 * M-81 — the admin surface for §12's broker partners.
 *
 * ENGLISH BY SCOPE, like every other staff component (M-58's decision, M-77's
 * restatement): the operator portal is one language while `/track`, the three
 * customer portals and the driver link are five (§24). Mixing the two
 * vocabularies in one file is how a `t()` ends up in a component the admin
 * layout renders without a provider.
 *
 * ── WHAT THE FORMS DO NOT OFFER ──────────────────────────────────────────
 *
 * There is no field anywhere here that sets a PROFILE role. §12's only path
 * to `role = 'broker'` is accepting an invitation, and the invitation form
 * chooses an ORGANIZATION and a MEMBERSHIP role, never a profile role. The
 * admin Users page (M-58) likewise does not offer `broker` in its role
 * dropdown — assigning it there would produce a broker with no organization,
 * which reads nothing and looks broken.
 *
 * ── §23 ──────────────────────────────────────────────────────────────────
 *
 * Every control has a `<label for>`; every card is a `<section>` with a
 * heading; refusals are `role="alert"` and confirmations `role="status"`, so
 * a result is announced rather than discovered; state is text, never colour
 * alone; nothing is hover-only.
 */

const VERIFICATION_LABEL: Record<BrokerVerificationStatus, string> = {
  pending: "Pending verification",
  verified: "Verified",
  rejected: "Rejected",
  suspended: "Suspended",
};

export interface BrokerPartnerListItem {
  id: string;
  company_name: string;
  mc_number: string | null;
  dot_number: string | null;
  contact_email: string | null;
  active: boolean;
  verification_status: BrokerVerificationStatus;
  verified_at: string | null;
  authority_since: string | null;
  days_to_pay: number | null;
  bond_provider: string | null;
  bond_amount_usd: number | null;
}

export interface BrokerInviteListItem {
  id: string;
  broker_partner_id: string;
  email: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export interface BrokerAgreementListItem {
  id: string;
  broker_partner_id: string;
  shipper_id: string;
  shipper_name: string | null;
  agreement_reference: string | null;
  starts_at: string;
  ends_at: string | null;
  revoked_at: string | null;
}

export interface ShipperOption {
  id: string;
  name: string;
}

/* ------------------------------------------------------------------ *
 * Shared shell
 * ------------------------------------------------------------------ */

function ActionCard({
  title,
  description,
  action,
  children,
  submitLabel,
  busyLabel,
}: {
  title: string;
  description?: ReactNode;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
  submitLabel: string;
  busyLabel: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initialFormState);
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state.status, state.message, router]);

  return (
    <section className="pcard">
      <h2>{title}</h2>
      {description ? (
        <p className="pempty" style={{ padding: "0 0 12px" }}>
          {description}
        </p>
      ) : null}
      <form action={formAction} className="pform">
        {children}
        <button
          className="btn btn-amber btn-sm"
          type="submit"
          aria-busy={pending}
          disabled={pending}
        >
          {pending ? busyLabel : submitLabel}
        </button>
      </form>
      {state.status === "error" ? (
        <p className="form-err show" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === "success" ? (
        <p className="pempty" role="status" style={{ padding: "10px 0 0" }}>
          {state.message ?? "Saved."}
        </p>
      ) : null}
    </section>
  );
}

/** Inline one-button form with its own busy state and its own alert region. */
function InlineAction({
  action,
  label,
  busyLabel,
  children,
  confirmField,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  label: string;
  busyLabel: string;
  children: ReactNode;
  /** Optional free-text reason captured before the write. */
  confirmField?: { name: string; placeholder: string };
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initialFormState);
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state.status, state.message, router]);

  return (
    <form action={formAction} style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      {children}
      {confirmField ? (
        <input
          name={confirmField.name}
          type="text"
          maxLength={500}
          placeholder={confirmField.placeholder}
          aria-label={confirmField.placeholder}
          style={{ minWidth: 180 }}
        />
      ) : null}
      <button
        className="btn btn-ghost btn-sm"
        type="submit"
        aria-busy={pending}
        disabled={pending}
      >
        {pending ? busyLabel : label}
      </button>
      {state.status === "error" && state.message ? (
        <span
          className="mono"
          role="alert"
          style={{ display: "block", color: "#f2c9c9", fontSize: ".66rem" }}
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Create a partner organization
 * ------------------------------------------------------------------ */

/**
 * The vetting field list is `docs/FINAL-IMPLEMENTATION-PLAN.md` §9.3 — the
 * carrier-management skill's broker checklist: authority, bond, days-to-pay
 * and MC age. Nothing here SCORES them. §30 forbids implying an automated
 * judgement the product does not make, so the form captures what an admin
 * checked and the admin decides.
 */
export function CreateBrokerPartnerForm() {
  return (
    <ActionCard
      title="Add a partner organization"
      description="Created UNVERIFIED and inactive — it reads nothing until you verify it below. Record what you checked: authority age, bond and payment terms are the fields that matter when a partner turns out not to be one."
      action={createBrokerPartnerAction}
      submitLabel="Create partner"
      busyLabel="Creating…"
    >
      <div className="pform-row">
        <div className="field">
          <label htmlFor="bp-name">Company name</label>
          <input id="bp-name" name="company_name" type="text" required minLength={2} maxLength={160} />
        </div>
        <div className="field">
          <label htmlFor="bp-mc">MC number</label>
          <input id="bp-mc" name="mc_number" type="text" maxLength={20} />
        </div>
        <div className="field">
          <label htmlFor="bp-dot">DOT number</label>
          <input id="bp-dot" name="dot_number" type="text" maxLength={20} />
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="bp-contact">Contact name</label>
          <input id="bp-contact" name="contact_name" type="text" maxLength={120} />
        </div>
        <div className="field">
          <label htmlFor="bp-email">Contact email</label>
          <input id="bp-email" name="contact_email" type="email" maxLength={254} />
        </div>
        <div className="field">
          <label htmlFor="bp-phone">Contact phone</label>
          <input id="bp-phone" name="contact_phone" type="tel" maxLength={20} />
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="bp-authority">Authority granted (YYYY-MM-DD)</label>
          <input id="bp-authority" name="authority_since" type="date" />
        </div>
        <div className="field">
          <label htmlFor="bp-bond">Bond provider</label>
          <input id="bp-bond" name="bond_provider" type="text" maxLength={160} />
        </div>
        <div className="field">
          <label htmlFor="bp-bond-amt">Bond amount (USD)</label>
          <input id="bp-bond-amt" name="bond_amount_usd" type="number" min={0} step={1000} inputMode="numeric" />
        </div>
        <div className="field">
          <label htmlFor="bp-dtp">Stated days to pay</label>
          <input id="bp-dtp" name="days_to_pay" type="number" min={0} max={365} inputMode="numeric" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="bp-notes">Vetting notes</label>
        <textarea id="bp-notes" name="notes" rows={3} maxLength={4000} />
      </div>
    </ActionCard>
  );
}

/* ------------------------------------------------------------------ *
 * The partner table: verification + invitations
 * ------------------------------------------------------------------ */

export function BrokerPartnerTable({
  partners,
  invites,
}: {
  partners: BrokerPartnerListItem[];
  invites: BrokerInviteListItem[];
}) {
  if (partners.length === 0) {
    return (
      <section className="pcard">
        <h2>Partner organizations</h2>
        <p className="pempty" style={{ padding: 0 }}>
          No partner organizations yet. Broker access is invitation-only (§3),
          so nothing exists until you create it here.
        </p>
      </section>
    );
  }

  return (
    <section className="pcard" style={{ padding: 0 }}>
      <table className="ptable ptable--cards">
        <caption className="sr-only">Broker partner organizations</caption>
        <thead>
          <tr>
            <th scope="col">Organization</th>
            <th scope="col">Authority</th>
            <th scope="col">Bond / terms</th>
            <th scope="col">State</th>
            <th scope="col">Verification</th>
            <th scope="col">Invite a user</th>
          </tr>
        </thead>
        <tbody>
          {partners.map((partner) => {
            const partnerInvites = invites.filter(
              (i) => i.broker_partner_id === partner.id,
            );
            return (
              <tr key={partner.id}>
                <td data-th="Organization">
                  <strong>{partner.company_name}</strong>
                  <br />
                  <span className="mono" style={{ fontSize: ".68rem" }}>
                    {partner.mc_number ?? "no MC"}
                    {partner.dot_number ? ` · DOT ${partner.dot_number}` : ""}
                  </span>
                </td>
                <td data-th="Authority">
                  {partner.authority_since ?? "—"}
                  {/* Plan §9.3's fraud pattern, surfaced as a FACT for a human
                      to weigh — never as a verdict (§30). */}
                  {partner.authority_since &&
                  Date.now() - new Date(partner.authority_since).getTime() <
                    365 * 24 * 60 * 60 * 1000 ? (
                    <>
                      <br />
                      <span className="mono" style={{ fontSize: ".66rem" }}>
                        under 12 months old
                      </span>
                    </>
                  ) : null}
                </td>
                <td data-th="Bond / terms">
                  {partner.bond_provider ?? "—"}
                  {partner.bond_amount_usd !== null
                    ? ` · $${partner.bond_amount_usd.toLocaleString("en-US")}`
                    : ""}
                  {partner.days_to_pay !== null
                    ? ` · ${partner.days_to_pay} days`
                    : ""}
                </td>
                {/* §23: state is TEXT, never colour alone. */}
                <td data-th="State">
                  {partner.active ? "Active" : "Inactive"}
                </td>
                <td data-th="Verification">
                  {VERIFICATION_LABEL[partner.verification_status]}
                  <br />
                  {partner.verification_status === "verified" ? (
                    <InlineAction
                      action={verifyBrokerPartnerAction}
                      label="Suspend"
                      busyLabel="Saving…"
                      confirmField={{ name: "note", placeholder: "Reason (internal)" }}
                    >
                      <input type="hidden" name="broker_partner_id" value={partner.id} />
                      <input type="hidden" name="verified" value="false" />
                    </InlineAction>
                  ) : (
                    <InlineAction
                      action={verifyBrokerPartnerAction}
                      label="Verify"
                      busyLabel="Saving…"
                      confirmField={{ name: "note", placeholder: "What you checked" }}
                    >
                      <input type="hidden" name="broker_partner_id" value={partner.id} />
                      <input type="hidden" name="verified" value="true" />
                    </InlineAction>
                  )}
                </td>
                <td data-th="Invite a user">
                  <BrokerInviteInline partnerId={partner.id} />
                  {partnerInvites.length > 0 ? (
                    <ul style={{ margin: "8px 0 0", paddingLeft: 16 }}>
                      {partnerInvites.map((invite) => (
                        <li key={invite.id} style={{ fontSize: ".72rem" }}>
                          {invite.email} —{" "}
                          {invite.accepted_at
                            ? "accepted"
                            : invite.revoked_at
                              ? "cancelled"
                              : new Date(invite.expires_at).getTime() < Date.now()
                                ? "expired"
                                : "pending"}
                          {!invite.accepted_at &&
                          !invite.revoked_at &&
                          new Date(invite.expires_at).getTime() >= Date.now() ? (
                            <>
                              {" "}
                              <InlineAction
                                action={revokeBrokerInviteAction}
                                label="Cancel"
                                busyLabel="…"
                              >
                                <input type="hidden" name="invite_id" value={invite.id} />
                              </InlineAction>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function BrokerInviteInline({ partnerId }: { partnerId: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        onClick={() => setOpen(true)}
      >
        Invite
      </button>
    );
  }
  return (
    <InlineAction
      action={createBrokerInviteAction}
      label="Send invite"
      busyLabel="Sending…"
    >
      <input type="hidden" name="broker_partner_id" value={partnerId} />
      <input type="hidden" name="membership_role" value="owner" />
      <input
        name="email"
        type="email"
        required
        maxLength={254}
        placeholder="name@partner.com"
        aria-label="Invitee email"
        style={{ minWidth: 200 }}
      />
    </InlineAction>
  );
}

/* ------------------------------------------------------------------ *
 * §12 grant shape TWO — account agreements
 * ------------------------------------------------------------------ */

export function BrokerAgreementPanel({
  partners,
  shippers,
  agreements,
}: {
  partners: BrokerPartnerListItem[];
  shippers: ShipperOption[];
  agreements: BrokerAgreementListItem[];
}) {
  const verified = partners.filter(
    (p) => p.active && p.verification_status === "verified",
  );

  return (
    <>
      <ActionCard
        title="Account agreement"
        description="§12's second grant shape: standing access to ONE shipper's freight for a bounded window. Everything created under that shipper becomes visible to the partner while the agreement is live; revoking it closes every shipment at once. For a single load, share it from the shipment page instead."
        action={createBrokerAgreementAction}
        submitLabel="Record agreement"
        busyLabel="Saving…"
      >
        <div className="pform-row">
          <div className="field">
            <label htmlFor="ba-partner">Partner organization</label>
            <select id="ba-partner" name="broker_partner_id" required defaultValue="">
              <option value="" disabled>
                —
              </option>
              {verified.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.company_name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ba-shipper">Shipper account</label>
            <select id="ba-shipper" name="shipper_id" required defaultValue="">
              <option value="" disabled>
                —
              </option>
              {shippers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="pform-row">
          <div className="field">
            <label htmlFor="ba-ref">Agreement reference</label>
            <input id="ba-ref" name="agreement_reference" type="text" maxLength={160} />
          </div>
          <div className="field">
            <label htmlFor="ba-ends">Ends (optional, YYYY-MM-DD)</label>
            <input id="ba-ends" name="ends_at" type="date" />
          </div>
        </div>
        {verified.length === 0 ? (
          <p className="pempty" role="note" style={{ padding: "8px 0 0" }}>
            No verified partner organizations yet — verify one first, or the
            agreement would grant nothing.
          </p>
        ) : null}
      </ActionCard>

      <section className="pcard" style={{ padding: 0 }}>
        <table className="ptable ptable--cards">
          <caption className="sr-only">Account agreements</caption>
          <thead>
            <tr>
              <th scope="col">Partner</th>
              <th scope="col">Shipper</th>
              <th scope="col">Window</th>
              <th scope="col">Reference</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            {agreements.length === 0 ? (
              <tr>
                <td data-th="Partner" colSpan={5}>
                  No account agreements recorded.
                </td>
              </tr>
            ) : (
              agreements.map((agreement) => {
                const partner = partners.find(
                  (p) => p.id === agreement.broker_partner_id,
                );
                return (
                  <tr key={agreement.id}>
                    <td data-th="Partner">{partner?.company_name ?? "—"}</td>
                    <td data-th="Shipper">{agreement.shipper_name ?? "—"}</td>
                    <td data-th="Window">
                      {agreement.starts_at.slice(0, 10)} →{" "}
                      {agreement.ends_at ? agreement.ends_at.slice(0, 10) : "open"}
                    </td>
                    <td data-th="Reference">
                      {agreement.agreement_reference ?? "—"}
                    </td>
                    <td data-th="State">
                      {agreement.revoked_at ? (
                        "Revoked"
                      ) : (
                        <>
                          Live{" "}
                          <InlineAction
                            action={revokeBrokerAgreementAction}
                            label="Revoke"
                            busyLabel="…"
                            confirmField={{
                              name: "reason",
                              placeholder: "Reason (internal)",
                            }}
                          >
                            <input
                              type="hidden"
                              name="agreement_id"
                              value={agreement.id}
                            />
                          </InlineAction>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
