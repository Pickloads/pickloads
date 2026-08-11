"use client";

import { useLocale, useTranslations } from "next-intl";
import { useV4 } from "@/i18n/v4";
import type { CustomerEventDto, ShipperShipmentDto } from "@/lib/shipments/dto";
import { partyRoleKey } from "@/lib/shipments/types";
import { resolvePublicText } from "@/lib/shipments/phrases";
import type { InvoiceStatus } from "@/lib/supabase/database.types";
import { TrackingTimeline } from "@/components/tracking/TrackingTimeline";
import {
  formatTrackingDate,
  formatTrackingDateTime,
} from "@/components/tracking/format";
import type {
  ShipmentContactView,
  ShipmentInvoiceView,
} from "@/lib/shipments/shipper-detail";

/**
 * M-74 — §11's shipper shipment DETAIL view.
 *
 * §11 names ten blocks and this renders all ten:
 *
 *   timeline · current status · ETA · shipment summary · map (when enabled) ·
 *   documents · support messages · invoice status · shipment contacts ·
 *   update history
 *
 * ── WHAT IT IS GIVEN, AND WHAT IT CANNOT REACH ────────────────────────────
 *
 * A `ShipperShipmentDto` — never a `ShipmentRow`. M-70's allow-list
 * serializer names no financial field for this audience, so
 * `gross_shipper_amount`, `carrier_pay`, `margin`, `delay_reason_internal`
 * and `public_access_hash` are not merely unrendered here, they are
 * unrepresentable. The invoice amount that DOES appear comes from
 * `invoices` — the customer's own bill, under 0021's own policy — exactly as
 * M-70's doc requires.
 *
 * ── THE TIMELINE IS M-73's, NOT A SECOND ONE ──────────────────────────────
 *
 * `TrackingTimeline` renders §8's nine milestones, §23's text equivalent and
 * the four milestone states. It took a `PublicTrackingDto` in M-73; M-74
 * widened its prop to `TimelineSubject` (status + events + exceptions), which
 * both DTOs satisfy. One implementation of "where is this shipment", two
 * audiences. The phrase library (`resolvePublicText`) is reused for the same
 * reason: a dispatcher's `phrase:delay.traffic` token must read identically
 * on `/track` and in the portal, in all five languages.
 *
 * ── §22 MOBILE PRIORITY ORDER ─────────────────────────────────────────────
 *
 * status → ETA → route → timeline → support → documents → map. That is the
 * DOM order below; the header grid is `auto-fit`, so the DOM order IS the
 * stacking order at 320px with no media query to keep in sync.
 *
 * ── §30 HONEST LABELS ─────────────────────────────────────────────────────
 *
 * The map region is a LABELLED PLACEHOLDER, not a map. M-80 owns the provider
 * adapters and the four §9 privacy levels; until then the region says
 * "milestone tracking" and states plainly that no live GPS position is shown.
 * Rendering grey tiles, a fake truck marker or an empty `<div id="map">`
 * would each imply a capability that does not exist — precisely what §30
 * forbids and what the M-73 audit note flagged on `/shippers`.
 */

/**
 * Customer-facing wording for the 0008 `invoice_status` enum.
 *
 * The enum values are Stripe's vocabulary, not a customer's: "uncollectible"
 * is an accounting state, and printing it on a shipper's screen would be
 * accurate and unkind. These five strings go through `tv()` like every other
 * portal label, so es/fr are authored and ru/ht mirror English.
 */
const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Not yet issued",
  open: "Awaiting payment",
  paid: "Paid",
  void: "Cancelled",
  uncollectible: "On hold — please call us",
};

function money(cents: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  }
}

/** D-6: library phrase → translated; novel prose → verbatim, labelled. */
function PublicText({ raw }: { raw: string | null }) {
  const t = useTranslations();
  const resolved = resolvePublicText(raw);
  if (resolved === null) return null;
  if (resolved.kind === "phrase") {
    return <span className="msg">{t(resolved.key)}</span>;
  }
  return (
    <>
      <span className="msg" lang={resolved.lang}>
        {resolved.text}
      </span>
      <span className="track-freetext">{t(resolved.noticeKey)}</span>
    </>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  const t = useTranslations();
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value ?? t("shipment.result.not_provided")}</dd>
    </div>
  );
}

function HistoryEvent({
  event,
  locale,
}: {
  event: CustomerEventDto;
  locale: string;
}) {
  const t = useTranslations();
  const place = [event.city, event.state].filter(Boolean).join(", ");
  return (
    <li>
      <span className="ev">{t(event.event_type_key)}</span>
      <PublicText raw={event.message} />
      <span className="meta">
        <time dateTime={event.event_time}>
          {formatTrackingDateTime(event.event_time, locale)}
        </time>
        {place === "" ? null : ` · ${place}`}
      </span>
    </li>
  );
}

export interface ShipmentDetailViewProps {
  shipment: ShipperShipmentDto;
  invoices: ShipmentInvoiceView[];
  invoicesFailed: boolean;
  contacts: ShipmentContactView[];
  /** Older history exists beyond the events in `shipment.events`. */
  historyHasMore: boolean;
  /** Href for the next (older) page of history, or null. */
  historyMoreHref: string | null;
  /** True when this render is showing an older history page. */
  historyPaged: boolean;
  /** Locale-prefixed href to this shipment's NEWEST history page. */
  historyResetHref: string;
  /** Locale-prefixed href to the shipper support surface. */
  supportHref: string;
}

export function ShipmentDetailView({
  shipment,
  invoices,
  invoicesFailed,
  contacts,
  historyHasMore,
  historyMoreHref,
  historyPaged,
  historyResetHref,
  supportHref,
}: ShipmentDetailViewProps) {
  const t = useTranslations();
  const tv = useV4();
  const locale = useLocale();

  const cancelled = shipment.status === "cancelled";
  const delayed = shipment.status === "delayed";
  const openException = shipment.exceptions.some((e) => e.resolved_at === null);
  const statusClass = cancelled
    ? "is-cancelled"
    : delayed || openException
      ? "is-exception"
      : "";

  const etaByDispatcher =
    shipment.eta_source === "manual" ||
    shipment.eta_source === "dispatcher_adjusted";
  const hasLocation =
    shipment.current_city !== null || shipment.current_state !== null;
  const locationClaimsLive = shipment.tracking_mode !== "manual" && hasLocation;

  const events = [...shipment.events].sort((a, b) =>
    a.event_time < b.event_time ? 1 : a.event_time > b.event_time ? -1 : 0,
  );

  return (
    <div className="psh-detail">
      {cancelled ? (
        <div className="track-banner is-neutral" role="note">
          <h2>{t("shipment.result.cancelled_title")}</h2>
          <p>
            {shipment.cancellation_reason ??
              t("shipment.result.cancelled_body")}
          </p>
        </div>
      ) : null}

      {delayed ? (
        <div className="track-banner" role="note">
          <h2>{t("shipment.result.delay_title")}</h2>
          {shipment.delay_minutes === null ? null : (
            <p>
              {t("shipment.result.delay_minutes", {
                minutes: shipment.delay_minutes,
              })}
            </p>
          )}
          <PublicText raw={shipment.delay_reason} />
        </div>
      ) : null}

      {shipment.exceptions.map((exception) => (
        <div
          key={`${exception.exception_type}-${exception.opened_at}`}
          className="track-banner"
          role="note"
        >
          <h2>{t("shipment.result.exception_title")}</h2>
          <p>
            {t(exception.exception_type_key)} · {t(exception.severity_key)}
          </p>
          <PublicText raw={exception.description} />
        </div>
      ))}

      {/* ── §11 current status · ETA · route (§22 priority order) ──────── */}
      <div className="track-head">
        <div>
          <span className="k">{t("shipment.result.current_status")}</span>
          <span className="v">
            <span className={`track-status ${statusClass}`.trim()}>
              {t(shipment.status_key)}
            </span>
          </span>
        </div>
        <div>
          <span className="k">{t("shipment.result.estimated_delivery")}</span>
          <span className="v">
            {formatTrackingDateTime(shipment.estimated_delivery_at, locale) ??
              t("shipment.result.not_provided")}
          </span>
          {etaByDispatcher ? (
            <span className="track-note">
              {t("shipment.label.eta_by_dispatcher")}
            </span>
          ) : null}
        </div>
        <div>
          <span className="k">{t("shipment.result.origin")}</span>
          <span className="v">
            {shipment.origin_company === null
              ? null
              : `${shipment.origin_company} · `}
            {shipment.origin_city}, {shipment.origin_state}
          </span>
        </div>
        <div>
          <span className="k">{t("shipment.result.destination")}</span>
          <span className="v">
            {shipment.destination_company === null
              ? null
              : `${shipment.destination_company} · `}
            {shipment.destination_city}, {shipment.destination_state}
          </span>
        </div>
        <div>
          <span className="k">{t("shipment.result.last_update")}</span>
          <span className="v">
            {formatTrackingDateTime(
              shipment.last_location_at ?? shipment.eta_updated_at,
              locale,
            ) ?? t("shipment.result.not_provided")}
          </span>
          <span className="track-note">
            {t("shipment.label.last_updated_by_dispatch")}
          </span>
        </div>
        <div>
          <span className="k">{t("shipment.result.carrier")}</span>
          <span className="v">
            {shipment.carrier_assigned
              ? t("shipment.result.carrier_assigned")
              : t("shipment.result.carrier_pending")}
          </span>
        </div>
      </div>

      {/* ── §11 timeline — M-73's component, M-73's phrase library ─────── */}
      <TrackingTimeline tracking={shipment} headingId="psh-progress-heading" />

      {/* ── §11 shipment summary ───────────────────────────────────────── */}
      <section className="track-section" aria-labelledby="psh-summary-heading">
        <h2 id="psh-summary-heading">{t("shipment.result.summary_title")}</h2>
        <dl className="track-summary">
          <Field
            label={t("shipment.result.pickup_appointment")}
            value={formatTrackingDateTime(
              shipment.pickup_appointment_at,
              locale,
            )}
          />
          <Field
            label={t("shipment.result.delivery_appointment")}
            value={formatTrackingDateTime(
              shipment.delivery_appointment_at,
              locale,
            )}
          />
          <Field
            label={t("shipment.result.equipment")}
            value={shipment.equipment}
          />
          <Field
            label={t("shipment.result.commodity")}
            value={shipment.commodity_category}
          />
          <Field
            label={t("shipment.result.weight")}
            value={
              shipment.weight_lbs === null
                ? null
                : `${shipment.weight_lbs.toLocaleString(locale)} ${t("shipment.result.weight_unit")}`
            }
          />
          <Field
            label={t("shipment.result.pallets")}
            value={shipment.pallets === null ? null : String(shipment.pallets)}
          />
          <Field
            label={t("shipment.result.reference")}
            value={shipment.shipper_reference}
          />
          <Field
            label={t("shipment.result.po_number")}
            value={shipment.po_number}
          />
          <Field label={tv("Origin address")} value={shipment.origin_address} />
          <Field
            label={tv("Destination address")}
            value={shipment.destination_address}
          />
        </dl>
      </section>

      {/* ── §11 map, "when enabled" — M-80's slot, honestly labelled ───── */}
      <section className="track-section" aria-labelledby="psh-map-heading">
        <h2 id="psh-map-heading">{tv("Location")}</h2>
        <div className="psh-mapslot" data-testid="shipment-map-slot">
          <span className="pbadge">
            {t("shipment.label.milestone_tracking")}
          </span>
          <p>
            {hasLocation
              ? `${[shipment.current_city, shipment.current_state]
                  .filter(Boolean)
                  .join(", ")} · ${
                  formatTrackingDateTime(shipment.last_location_at, locale) ??
                  ""
                }`
              : t("shipment.label.location_unavailable")}
          </p>
          <p className="track-note">
            {locationClaimsLive
              ? t("shipment.label.live_location_available")
              : t("shipment.result.updates_are_manual")}
          </p>
        </div>
      </section>

      {/* ── §11 support messages ───────────────────────────────────────── */}
      <section className="track-section" aria-labelledby="psh-support-heading">
        <h2 id="psh-support-heading">{t("shipment.result.contact_title")}</h2>
        <p className="pempty" style={{ padding: "0 0 10px" }}>
          {t("shipment.result.contact_body")}
        </p>
        <div className="track-contact">
          <a className="btn btn-ghost btn-sm" href={supportHref}>
            {tv("Open a support thread")} →
          </a>
          <a href="tel:+19084045373">(908) 404-5373</a>
        </div>
      </section>

      {/* ── §11 documents — read-only until M-77, honest empty state ───── */}
      <section className="track-section" aria-labelledby="psh-docs-heading">
        <h2 id="psh-docs-heading">{tv("Documents")}</h2>
        <p className="pempty" style={{ padding: 0 }}>
          {tv(
            "Shipment documents — BOL, proof of delivery and approved paperwork — aren't available for download yet. Ask your dispatcher and they'll email them to you.",
          )}
        </p>
      </section>

      {/* ── §11 invoice status — from `invoices`, never from the shipment ─ */}
      <section className="track-section" aria-labelledby="psh-invoice-heading">
        <h2 id="psh-invoice-heading">{tv("Invoice status")}</h2>
        {invoicesFailed ? (
          <p className="pempty" role="alert" style={{ padding: 0 }}>
            {tv("We couldn't read your invoices just now.")}
          </p>
        ) : invoices.length === 0 ? (
          <p className="pempty" style={{ padding: 0 }}>
            {tv("No invoice has been raised for this shipment yet.")}
          </p>
        ) : (
          <table className="ptable ptable--cards">
            <caption className="sr-only">{tv("Invoice status")}</caption>
            <thead>
              <tr>
                <th scope="col">{tv("Status")}</th>
                <th scope="col">{tv("Amount")}</th>
                <th scope="col">{tv("Issued")}</th>
                <th scope="col">{tv("Due")}</th>
                <th scope="col">{tv("Paid")}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td data-th={tv("Status")}>
                    <span
                      className={`pbadge ${invoice.status === "paid" ? "green" : invoice.status === "open" ? "amber" : ""}`.trim()}
                    >
                      {tv(INVOICE_STATUS_LABEL[invoice.status])}
                    </span>
                  </td>
                  <td data-th={tv("Amount")}>
                    {money(invoice.amount_cents, invoice.currency, locale)}
                  </td>
                  <td data-th={tv("Issued")}>
                    {formatTrackingDate(invoice.issued_at, locale) ?? "—"}
                  </td>
                  <td data-th={tv("Due")}>
                    {formatTrackingDate(invoice.due_at, locale) ?? "—"}
                  </td>
                  <td data-th={tv("Paid")}>
                    {formatTrackingDate(invoice.paid_at, locale) ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── §11 shipment contacts — M-71's visibility rules applied ────── */}
      <section className="track-section" aria-labelledby="psh-contacts-heading">
        <h2 id="psh-contacts-heading">{tv("Shipment contacts")}</h2>
        {contacts.length === 0 ? (
          <p className="pempty" style={{ padding: 0 }}>
            {tv("No contacts have been recorded for this shipment yet.")}
          </p>
        ) : (
          <table className="ptable ptable--cards">
            <caption className="sr-only">{tv("Shipment contacts")}</caption>
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
      </section>

      {/* ── §11 update history — §25 bounded, never the whole table ────── */}
      <section className="track-section" aria-labelledby="psh-history-heading">
        <h2 id="psh-history-heading">{t("shipment.a11y.event_list")}</h2>
        {events.length === 0 ? (
          <p className="pempty" style={{ padding: 0 }}>
            {t("shipment.result.timeline_empty")}
          </p>
        ) : (
          <ol
            className="track-events"
            aria-label={t("shipment.a11y.event_list")}
          >
            {/* M-70's CUSTOMER event DTO carries no `id` — deliberately: an
                internal row id is not a customer's business, and §13 forbids
                exposing internal ids in predictable places. The key is the
                position in an already-sorted, server-paginated list, which is
                stable for the life of the render. */}
            {events.map((event, index) => (
              <HistoryEvent
                key={`${event.event_time}-${event.event_type}-${index}`}
                event={event}
                locale={locale}
              />
            ))}
          </ol>
        )}
        {historyHasMore && historyMoreHref !== null ? (
          <p className="psh-more">
            <a
              className="btn btn-ghost btn-sm"
              href={historyMoreHref}
              rel="next"
            >
              {tv("Show older updates")} →
            </a>
          </p>
        ) : null}
        {historyPaged ? (
          <p className="psh-more">
            <a
              className="btn btn-ghost btn-sm"
              href={historyResetHref}
              rel="up"
            >
              {tv("Back to the newest updates")} →
            </a>
          </p>
        ) : null}
        {/* Only claimed when it is TRUE. §25 bounds every history read, but a
            shipment with three updates is not "truncated", and saying so
            would train customers to distrust the sentence when it matters. */}
        {historyHasMore ? (
          <p className="track-note">
            {t("shipment.result.timeline_truncated")}
          </p>
        ) : null}
      </section>
    </div>
  );
}
