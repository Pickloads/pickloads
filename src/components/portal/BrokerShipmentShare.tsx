"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

import {
  grantBrokerShipmentAction,
  revokeBrokerShipmentAction,
} from "@/app/actions/broker-partners";
import { initialFormState } from "@/lib/form-state";

/**
 * M-81 — §12's *"granted access shipment by shipment"*, on the dispatcher's
 * shipment page.
 *
 * ── WHY THIS CONTROL IS HERE AND NOT ON `/portal/admin/brokers` ──────────
 *
 * Because the decision needs the shipment in front of you. "Share THIS load
 * with Acme" is an operational act taken while looking at the load, and §14
 * makes the dispatcher the operator. The ADMIN page owns the questions that
 * are about the counterparty rather than the freight — who they are, whether
 * they are verified, what standing agreement they hold.
 *
 * The gate matches: `grantBrokerShipmentAction` runs
 * `resolveShipmentAccess`, so a dispatcher can share only a shipment they
 * could open, and cannot reach one outside their §19 scope.
 *
 * ── ONLY VERIFIED PARTNERS ARE OFFERED ───────────────────────────────────
 *
 * `partners` is `listVerifiedBrokerPartners()`. Sharing with an unverified
 * organization would succeed and grant nothing —
 * `my_broker_partner_ids()` filters it out — leaving a dispatcher believing
 * the customer can see the BOL. The server refuses it too; the dropdown just
 * stops the mistake being offered.
 *
 * English by scope, like every other staff component.
 */

export interface BrokerGrantView {
  id: string;
  broker_partner_id: string;
  company_name: string;
  granted_at: string;
  note: string | null;
}

export interface BrokerPartnerOption {
  id: string;
  company_name: string;
}

export function BrokerShipmentShare({
  shipmentId,
  partners,
  grants,
  failed,
}: {
  shipmentId: string;
  partners: readonly BrokerPartnerOption[];
  grants: readonly BrokerGrantView[];
  failed: boolean;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    grantBrokerShipmentAction,
    initialFormState,
  );
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state.status, state.message, router]);

  return (
    <section className="pcard" aria-labelledby="bshare">
      <h2 id="bshare">Broker partner access</h2>
      <p className="pempty" style={{ padding: "0 0 12px" }}>
        A shared partner sees this shipment&apos;s status, timeline, approved
        contacts and any APPROVED BOL or POD. They never see the rate
        confirmation, the customer&apos;s price, our margin, the carrier packet
        or insurance — that is the §12 permission list, enforced by policy, not
        by this page.
      </p>

      {failed ? (
        <p className="form-err show" role="alert">
          The partner list failed to load. Reload before sharing.
        </p>
      ) : null}

      {grants.length === 0 ? (
        <p className="pempty" style={{ padding: "0 0 12px" }}>
          Not shared with any partner organization.
        </p>
      ) : (
        <table className="ptable ptable--cards">
          <caption className="sr-only">
            Partner organizations this shipment is shared with
          </caption>
          <thead>
            <tr>
              <th scope="col">Partner</th>
              <th scope="col">Shared</th>
              <th scope="col">Note</th>
              <th scope="col">
                <span className="sr-only">Revoke</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {grants.map((grant) => (
              <tr key={grant.id}>
                <td data-th="Partner">{grant.company_name}</td>
                <td data-th="Shared">
                  <time dateTime={grant.granted_at}>
                    {grant.granted_at.slice(0, 10)}
                  </time>
                </td>
                <td data-th="Note">{grant.note ?? "—"}</td>
                <td data-th="Revoke">
                  <RevokeGrantButton shipmentId={shipmentId} grantId={grant.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {partners.length === 0 ? (
        <p className="pempty" role="note" style={{ padding: "12px 0 0" }}>
          No verified partner organizations exist yet. Create and verify one on
          the Broker partners page — sharing with an unverified partner would
          grant nothing.
        </p>
      ) : (
        <form action={formAction} className="pform" style={{ marginTop: 12 }}>
          <input type="hidden" name="shipment_id" value={shipmentId} />
          <div className="pform-row">
            <div className="field">
              <label htmlFor="bshare-partner">Share with</label>
              <select
                id="bshare-partner"
                name="broker_partner_id"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  —
                </option>
                {partners.map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.company_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="bshare-note">Note (internal)</label>
              <input id="bshare-note" name="note" type="text" maxLength={500} />
            </div>
          </div>
          <button
            className="btn btn-amber btn-sm"
            type="submit"
            aria-busy={pending}
            disabled={pending}
          >
            {pending ? "Sharing…" : "Share shipment"}
          </button>
        </form>
      )}

      {state.status === "error" ? (
        <p className="form-err show" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.status === "success" ? (
        <p className="pempty" role="status" style={{ padding: "10px 0 0" }}>
          {state.message ?? "Shared."}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Revocation is its own tiny form rather than a button firing a fetch: it is
 * a WRITE, and a write needs its own busy state and its own `role="alert"` or
 * a dispatcher has no way to know it did not work. M-76's `RevokeButton`, in
 * this module's vocabulary.
 */
function RevokeGrantButton({
  shipmentId,
  grantId,
}: {
  shipmentId: string;
  grantId: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    revokeBrokerShipmentAction,
    initialFormState,
  );
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state.status, state.message, router]);
  return (
    <form action={formAction}>
      <input type="hidden" name="shipment_id" value={shipmentId} />
      <input type="hidden" name="grant_id" value={grantId} />
      <button
        className="btn btn-ghost btn-sm"
        type="submit"
        aria-busy={pending}
        disabled={pending}
      >
        Revoke
      </button>
      {state.status === "error" ? (
        <span className="form-err show" role="alert">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
