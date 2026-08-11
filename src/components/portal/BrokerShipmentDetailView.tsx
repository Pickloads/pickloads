"use client";

import { useLocale, useTranslations } from "next-intl";
import { useV4 } from "@/i18n/v4";

import type { BrokerShipmentDto, CustomerEventDto } from "@/lib/shipments/dto";
import { resolvePublicText } from "@/lib/shipments/phrases";
import type { CustomerDocumentDto } from "@/lib/shipments/documents";
import type { ShipmentContactView } from "@/lib/shipments/shipper-detail";
import type { BrokerAccessBasis } from "@/lib/shipments/broker-access";
import { DocumentList } from "@/components/portal/ShipmentDocuments";
import { getBrokerDocumentUrlAction } from "@/app/actions/shipment-documents";
import { partyRoleKey, statusKey } from "@/lib/shipments/types";
import { TrackingTimeline } from "@/components/tracking/TrackingTimeline";
import {
  formatTrackingDate,
  formatTrackingDateTime,
} from "@/components/tracking/format";

/**
 * M-81 — §12's shared-shipment DETAIL.
 *
 * ── WHAT IT IS GIVEN ─────────────────────────────────────────────────────
 *
 * A `BrokerShipmentDto` — never a `ShipmentRow`. M-70's allow-list serializer
 * names NO financial field, *"not even `carrier_pay`"*, and M-81's
 * `BROKER_FIELD_POLICY` pins that decision cell by cell against §12's six
 * prohibitions. So the commission, the margin and the shipper's price are not
 * merely unrendered here — they are unrepresentable, and the SQL projection
 * behind this page never fetched them either.
 *
 * ── READ ONLY, WITH NO EXCEPTIONS ────────────────────────────────────────
 *
 * There is not one `<form>` in this file and not one server action imported
 * except the document-URL minter. §12 gives a broker partner a VIEW; §19
 * gives them SELECT and nothing else, and 0018/0029 grant no INSERT, UPDATE
 * or DELETE policy on any shipment table to a broker session. A control here
 * would have nothing to call.
 *
 * ── THE "WHAT YOU CANNOT SEE" CARD IS NOT AN APOLOGY ─────────────────────
 *
 * It is §30's honest-states rule applied to permissions. A partner who cannot
 * find the rate has to be able to tell "not shared with you" from "not loaded
 * yet" — otherwise the absence reads as a bug and produces the phone call the
 * portal exists to prevent.
 *
 * ── §22 MOBILE PRIORITY ──────────────────────────────────────────────────
 *
 * Status → ETA → route → timeline → documents → contacts, in DOM order. The
 * `.track-head` grid is auto-fit, so DOM order IS the 320px stacking order.
 *
 * ── §23 ──────────────────────────────────────────────────────────────────
 *
 * Every card is a `<section>` with a heading; state is text, never colour;
 * the timeline is the shared semantic component with its text equivalent;
 * nothing is hover-only.
 */

export interface BrokerShipmentDetailViewProps {
  shipment: BrokerShipmentDto;
  contacts: ShipmentContactView[];
  contactsFailed: boolean;
  documents: CustomerDocumentDto[];
  documentsFailed: boolean;
  documentsHasMore: boolean;
  basis: BrokerAccessBasis | null;
  historyHasMore: boolean;
  historyMoreHref: string | null;
  historyPaged: boolean;
  historyResetHref: string;
}

export function BrokerShipmentDetailView({
  shipment,
  contacts,
  contactsFailed,
  documents,
  documentsFailed,
  documentsHasMore,
  basis,
  historyHasMore,
  historyMoreHref,
  historyPaged,
  historyResetHref,
}: BrokerShipmentDetailViewProps) {
  const t = useTranslations();
  const tv = useV4();
  const locale = useLocale();

  const anyWithheld = contacts.some((c) => c.channels_withheld);

  return (
    <>
      <section className="pcard" aria-labelledby="bs-summary">
        <h2 id="bs-summary">{t("shipment.broker.summary_title")}</h2>
        <div className="track-head">
          <div>
            <span className="k">{t("shipment.result.current_status")}</span>
            <span className="v">
              <span className="track-status">
                {t(statusKey(shipment.status))}
              </span>
            </span>
          </div>
          <div>
            <span className="k">{t("shipment.result.estimated_delivery")}</span>
            <span className="v">
              {shipment.estimated_delivery_at
                ? formatTrackingDateTime(shipment.estimated_delivery_at, locale)
                : t("shipment.result.not_provided")}
            </span>
          </div>
          <div>
            <span className="k">{t("shipment.result.origin")}</span>
            <span className="v">
              {shipment.origin_city}, {shipment.origin_state}
            </span>
          </div>
          <div>
            <span className="k">{t("shipment.result.destination")}</span>
            <span className="v">
              {shipment.destination_city}, {shipment.destination_state}
            </span>
          </div>
          <div>
            <span className="k">{t("shipment.result.pickup_appointment")}</span>
            <span className="v">
              {shipment.pickup_appointment_at
                ? formatTrackingDateTime(shipment.pickup_appointment_at, locale)
                : t("shipment.result.not_provided")}
            </span>
          </div>
          <div>
            <span className="k">
              {t("shipment.result.delivery_appointment")}
            </span>
            <span className="v">
              {shipment.delivery_appointment_at
                ? formatTrackingDateTime(
                    shipment.delivery_appointment_at,
                    locale,
                  )
                : t("shipment.result.not_provided")}
            </span>
          </div>
          <div>
            <span className="k">{t("shipment.result.equipment")}</span>
            <span className="v">{shipment.equipment}</span>
          </div>
          {/* §1 wants "assigned carrier status"; §12 forbids the carrier's
              private packet. A boolean answers the first without opening the
              second — `BROKER_FIELD_POLICY.carrier_id` is the decision, and
              this is where it surfaces. */}
          <div>
            <span className="k">{t("shipment.result.carrier")}</span>
            <span className="v">
              {shipment.carrier_assigned
                ? t("shipment.broker.carrier_assigned")
                : t("shipment.broker.carrier_pending")}
            </span>
          </div>
        </div>
      </section>

      {/* §12's grant shape, said out loud — a partner who cannot tell a
          one-off share from a standing agreement cannot tell when their
          access is about to end. */}
      {basis ? (
        <section className="pcard" aria-labelledby="bs-access">
          <h2 id="bs-access">{t("shipment.broker.access_title")}</h2>
          <p className="pempty" style={{ padding: 0 }}>
            {basis.kind === "link"
              ? t("shipment.broker.access_link")
              : basis.kind === "grant"
                ? t("shipment.broker.access_grant", {
                    date:
                      basis.since === null
                        ? "—"
                        : (formatTrackingDate(basis.since, locale) ?? "—"),
                  })
                : t("shipment.broker.access_agreement", {
                    date:
                      basis.since === null
                        ? "—"
                        : (formatTrackingDate(basis.since, locale) ?? "—"),
                  })}
          </p>
          {basis.reference ? (
            <p className="track-note" style={{ marginTop: 8 }}>
              {t("shipment.broker.access_reference", {
                reference: basis.reference,
              })}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* §7 timeline, broker band only. */}
      <section className="track-section" aria-labelledby="bs-history">
        <h2 id="bs-history">{t("shipment.broker.timeline_title")}</h2>
        <TrackingTimeline tracking={shipment} headingId="bs-timeline-heading" />
        {shipment.events.length === 0 ? (
          <p className="pempty" style={{ padding: "10px 0 0" }}>
            {t("shipment.broker.timeline_empty")}
          </p>
        ) : (
          <ul className="track-events" aria-label={t("shipment.a11y.event_list")}>
            {shipment.events.map((event, index) => (
              <BrokerEventRow key={`${event.event_time}-${index}`} event={event} />
            ))}
          </ul>
        )}
        <p className="psh-more">
          {historyHasMore && historyMoreHref ? (
            <a className="btn btn-ghost btn-sm" rel="next" href={historyMoreHref}>
              {t("shipment.broker.timeline_more")}
            </a>
          ) : null}
          {historyPaged ? (
            <a className="btn btn-ghost btn-sm" href={historyResetHref}>
              {t("shipment.broker.timeline_reset")}
            </a>
          ) : null}
        </p>
      </section>

      {/* M-77's §16 BROKER band, live. The download action is the one M-77
          shipped for this audience — M-81 calls it rather than writing a
          fifth copy of the same three lines, exactly as M-77 instructed. */}
      <DocumentList
        documents={documents}
        failed={documentsFailed}
        hasMore={documentsHasMore}
        downloadAction={getBrokerDocumentUrlAction}
        headingId="bs-docs"
        titleKey="shipment.document.title"
        blurbKey="shipment.broker.docs_blurb"
      />

      {/* §12 "approved contact channels" — and nothing wider. */}
      <section className="pcard" aria-labelledby="bs-contacts">
        <h2 id="bs-contacts">{t("shipment.broker.contacts_title")}</h2>
        {contactsFailed ? (
          <p className="pempty" role="alert" style={{ padding: 0 }}>
            {t("shipment.broker.failed")}
          </p>
        ) : contacts.length === 0 ? (
          <p className="pempty" style={{ padding: 0 }}>
            {t("shipment.broker.contacts_empty")}
          </p>
        ) : (
          <table className="ptable ptable--cards">
            <caption className="sr-only">
              {t("shipment.broker.contacts_title")}
            </caption>
            <thead>
              <tr>
                <th scope="col">{tv("Role")}</th>
                <th scope="col">{tv("Company")}</th>
                <th scope="col">{tv("Contact")}</th>
                <th scope="col">{tv("Phone")}</th>
                <th scope="col">{tv("Email")}</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id}>
                  <td data-th={tv("Role")}>
                    {t(partyRoleKey(contact.party_role))}
                  </td>
                  <td data-th={tv("Company")}>{contact.company_name ?? "—"}</td>
                  <td data-th={tv("Contact")}>
                    {contact.contact_name ??
                      (contact.channels_withheld
                        ? tv("Contact through dispatch")
                        : "—")}
                  </td>
                  <td data-th={tv("Phone")}>
                    {contact.phone === null ? (
                      "—"
                    ) : (
                      <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}>
                        {contact.phone}
                      </a>
                    )}
                  </td>
                  <td data-th={tv("Email")}>
                    {contact.email === null ? (
                      "—"
                    ) : (
                      <a href={`mailto:${contact.email}`}>{contact.email}</a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {anyWithheld ? (
          <p className="track-note" style={{ marginTop: 10 }}>
            {t("shipment.broker.contacts_withheld")}
          </p>
        ) : null}
      </section>

      {/* §12's MUST-NOT-SEE list, stated to the person it constrains. */}
      <section className="pcard" aria-labelledby="bs-withheld">
        <h2 id="bs-withheld">{t("shipment.broker.withheld_title")}</h2>
        <p className="pempty" style={{ padding: 0 }} role="note">
          {t("shipment.broker.withheld_body")}
        </p>
      </section>
    </>
  );
}

function BrokerEventRow({ event }: { event: CustomerEventDto }) {
  const t = useTranslations();
  const locale = useLocale();
  const text = resolvePublicText(event.message);
  return (
    <li>
      <span className="ev">{t(event.event_type_key)}</span>
      {text === null ? null : text.kind === "phrase" ? (
        <span className="msg">{t(text.key)}</span>
      ) : (
        <>
          <span className="msg">{text.text}</span>
          {/* D-6: free text is labelled, never silently machine-translated. */}
          <span className="track-freetext">{t(text.noticeKey)}</span>
        </>
      )}
      <time className="meta" dateTime={event.event_time}>
        {formatTrackingDateTime(event.event_time, locale) ??
          formatTrackingDate(event.event_time, locale)}
      </time>
    </li>
  );
}
