"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

import {
  carrierEtaAction,
  carrierExceptionAction,
  carrierStatusUpdateAction,
  issueDriverLinkAction,
  revokeDriverLinkAction,
} from "@/app/actions/carrier-shipments";
import { initialFormState, type FormState } from "@/lib/form-state";
import type { CarrierShipmentDto, CustomerEventDto } from "@/lib/shipments/dto";
import { resolvePublicText } from "@/lib/shipments/phrases";
import {
  DEFERRED_CARRIER_ACTIONS,
  type CarrierUpdateAction,
} from "@/lib/shipments/carrier-updates";
import {
  driverTokenState,
  type DriverTokenState,
} from "@/lib/shipments/driver-token-state";
import {
  ETA_KINDS,
  SHIPMENT_EXCEPTION_TYPES,
  exceptionTypeKey,
  statusKey,
  type DriverTokenView,
} from "@/lib/shipments/types";
import { TrackingTimeline } from "@/components/tracking/TrackingTimeline";
import {
  formatTrackingDate,
  formatTrackingDateTime,
} from "@/components/tracking/format";

/**
 * M-76 — §13's carrier shipment DETAIL and the update surface on it.
 *
 * ── WHAT IT IS GIVEN ─────────────────────────────────────────────────────
 *
 * A `CarrierShipmentDto` — never a `ShipmentRow`. M-70's allow-list serializer
 * names `carrier_pay` (their own contract) and names neither
 * `gross_shipper_amount` nor `margin`, so the customer's price and our margin
 * are not merely unrendered here, they are UNREPRESENTABLE. §19's *"carrier
 * users cannot edit financial fields"* is the write side of the same boundary
 * and lives in the actions; this is the read side.
 *
 * ── THE BUTTONS ARE `offeredCarrierActions`, NOT A HARD-CODED LIST ───────
 *
 * The server resolves §20's facts and passes the offered actions in. Anything
 * the engine would refuse is therefore never drawn — M-72's own instruction to
 * its callers — while the refusal still exists on the server, because a hidden
 * button is not a control. `tests/unit/carrier-driver-a11y.test.tsx` asserts
 * the rendered `<select>` carries exactly the offered ids and nothing else,
 * and that a terminal shipment renders the honest "nothing to update" sentence
 * rather than an empty dropdown.
 *
 * ── §30: WHAT IS NOT BUILT SAYS SO ───────────────────────────────────────
 *
 * BOL and POD upload are §13 actions owned by M-77. They render as a labelled,
 * non-interactive row naming the gap. A disabled button with no explanation
 * teaches a carrier that the portal is broken; an absent one teaches them the
 * feature does not exist. Saying which module owns it is the honest third
 * option, and it is the treatment M-75 gave the identical gap.
 *
 * ── §22/§23 ──────────────────────────────────────────────────────────────
 *
 * Every control has a `<label for>`; every card is a `<section>` with a
 * heading; results are `role="alert"` / `role="status"` so a refusal is
 * announced; state is text, never colour; nothing is hover-only. The layout is
 * the audited portal vocabulary (`.pcard`, `.pform-row`, `.ptable--cards`,
 * `.track-*` under the portal's dark overrides), so 320px works because the
 * shipped mechanism works.
 */

/* ------------------------------------------------------------------ *
 * Shared form shell (M-75's `ActionCard`, in this module's vocabulary)
 * ------------------------------------------------------------------ */

function ActionCard({
  title,
  description,
  action,
  children,
  submitLabel,
  busyLabel,
  onDone,
}: {
  title: string;
  description?: ReactNode;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
  submitLabel: string;
  busyLabel: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, initialFormState);

  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state.status, state.message, onDone]);

  return (
    <section className="pcard">
      <h2>{title}</h2>
      {description ? <p className="pempty" style={{ padding: "0 0 12px" }}>{description}</p> : null}
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
        <p className="pempty" role="status" style={{ padding: "10px 0 0", overflowWrap: "anywhere" }}>
          {state.message}
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The view
 * ------------------------------------------------------------------ */

export interface CarrierShipmentDetailViewProps {
  shipment: CarrierShipmentDto;
  /** Already filtered through M-72's graph, actor gate and preconditions. */
  offeredActions: readonly CarrierUpdateAction[];
  tokens: readonly DriverTokenView[];
  tokensFailed: boolean;
  historyHasMore: boolean;
  historyMoreHref: string | null;
  historyPaged: boolean;
  historyResetHref: string;
  /** True when `DRIVER_TOKEN_SECRET` is set — §30: no button we cannot honour. */
  driverLinksEnabled: boolean;
}

function money(value: number | null, locale: string): string {
  if (value === null) return "—";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `$${value}`;
  }
}

const TOKEN_STATE_KEY: Record<DriverTokenState, string> = {
  active: "shipment.carrier.link_active",
  expired: "shipment.carrier.link_expired",
  revoked: "shipment.carrier.link_revoked",
};

export function CarrierShipmentDetailView({
  shipment,
  offeredActions,
  tokens,
  tokensFailed,
  historyHasMore,
  historyMoreHref,
  historyPaged,
  historyResetHref,
  driverLinksEnabled,
}: CarrierShipmentDetailViewProps) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const refresh = () => router.refresh();

  const transitions = offeredActions.filter((a) => a.kind === "transition");
  const canEta = offeredActions.some((a) => a.kind === "eta");
  const canException = offeredActions.some((a) => a.kind === "exception");

  return (
    <>
      {/* §22 mobile priority: status → ETA → route, in DOM order. The grid is
          auto-fit, so the DOM order IS the 320px stacking order. */}
      <section className="pcard" aria-labelledby="cs-summary">
        <h2 id="cs-summary">{t("shipment.carrier.summary_title")}</h2>
        <div className="track-head">
          <div>
            <span className="k">{t("shipment.result.current_status")}</span>
            <span className="v">
              <span className="track-status">{t(statusKey(shipment.status))}</span>
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
            <span className="k">{t("shipment.result.delivery_appointment")}</span>
            <span className="v">
              {shipment.delivery_appointment_at
                ? formatTrackingDateTime(shipment.delivery_appointment_at, locale)
                : t("shipment.result.not_provided")}
            </span>
          </div>
          <div>
            <span className="k">{t("shipment.result.equipment")}</span>
            <span className="v">{shipment.equipment}</span>
          </div>
          {/* Their own contracted pay, and a sentence saying what is NOT here.
              §19 + M-70's DTO doc: the carrier gets their rate because it is
              their contract; the customer's price and the margin are not
              serialized for this audience at all. */}
          <div>
            <span className="k">{t("shipment.carrier.pay")}</span>
            <span className="v">{money(shipment.carrier_pay, locale)}</span>
          </div>
        </div>
        <p className="track-note">{t("shipment.carrier.pay_note")}</p>
      </section>

      {/* §13's allowed actions. */}
      {transitions.length > 0 ? (
        <ActionCard
          title={t("shipment.carrier.update_legend")}
          action={carrierStatusUpdateAction}
          submitLabel={t("shipment.driver.submit")}
          busyLabel={t("shipment.driver.sending")}
          onDone={refresh}
        >
          <input type="hidden" name="shipment_id" value={shipment.id} />
          <input type="hidden" name="expected_status" value={shipment.status} />
          <div className="field">
            <label htmlFor="cs-action">{t("shipment.carrier.update_choose")}</label>
            <select id="cs-action" name="action" required defaultValue="">
              <option value="" disabled>
                —
              </option>
              {transitions.map((action) => (
                <option key={action.id} value={action.id}>
                  {t(action.labelKey)}
                </option>
              ))}
            </select>
          </div>
          <div className="pform-row">
            <div className="field">
              <label htmlFor="cs-city">{t("shipment.driver.city")}</label>
              <input id="cs-city" name="city" type="text" maxLength={80} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="cs-state">{t("shipment.driver.state")}</label>
              <input id="cs-state" name="state" type="text" maxLength={2} autoComplete="off" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="cs-note">{t("shipment.driver.note")}</label>
            <textarea id="cs-note" name="note" rows={2} maxLength={500} />
          </div>
        </ActionCard>
      ) : (
        <section className="pcard">
          <h2>{t("shipment.carrier.update_legend")}</h2>
          <p className="pempty" style={{ padding: 0 }}>
            {t("shipment.carrier.no_actions")}
          </p>
        </section>
      )}

      {canEta ? (
        <ActionCard
          title={t("shipment.driver.eta_legend")}
          action={carrierEtaAction}
          submitLabel={t("shipment.driver.eta_submit")}
          busyLabel={t("shipment.driver.sending")}
          onDone={refresh}
        >
          <input type="hidden" name="shipment_id" value={shipment.id} />
          <div className="pform-row">
            <div className="field">
              <label htmlFor="cs-eta-kind">{t("shipment.driver.eta_kind")}</label>
              <select id="cs-eta-kind" name="kind" defaultValue="delivery">
                {ETA_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind === "pickup"
                      ? t("shipment.driver.pickup")
                      : t("shipment.driver.delivery")}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cs-eta-at">{t("shipment.driver.eta_at")}</label>
              <input id="cs-eta-at" name="eta_at" type="datetime-local" required />
            </div>
          </div>
          <div className="field">
            <label htmlFor="cs-delay">{t("shipment.driver.delay_minutes")}</label>
            <input
              id="cs-delay"
              name="delay_minutes"
              type="number"
              min={0}
              max={20160}
              inputMode="numeric"
            />
          </div>
          <div className="field">
            <label htmlFor="cs-eta-note">{t("shipment.driver.note")}</label>
            <textarea id="cs-eta-note" name="note" rows={2} maxLength={500} />
          </div>
        </ActionCard>
      ) : null}

      {canException ? (
        <ActionCard
          title={t("shipment.driver.exception_legend")}
          description={t("shipment.driver.exception_note")}
          action={carrierExceptionAction}
          submitLabel={t("shipment.driver.exception_submit")}
          busyLabel={t("shipment.driver.sending")}
          onDone={refresh}
        >
          <input type="hidden" name="shipment_id" value={shipment.id} />
          <div className="field">
            <label htmlFor="cs-exc-type">{t("shipment.driver.exception_type")}</label>
            <select id="cs-exc-type" name="exception_type" required defaultValue="">
              <option value="" disabled>
                —
              </option>
              {SHIPMENT_EXCEPTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(exceptionTypeKey(type))}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cs-exc-desc">
              {t("shipment.driver.exception_description")}
            </label>
            <textarea id="cs-exc-desc" name="description" rows={3} maxLength={500} required />
          </div>
        </ActionCard>
      ) : null}

      {/* §13's driver link, both halves of its lifecycle. */}
      <section className="pcard" aria-labelledby="cs-links">
        <h2 id="cs-links">{t("shipment.carrier.links_title")}</h2>
        <p className="pempty" style={{ padding: "0 0 10px" }}>
          {t("shipment.carrier.links_body")}
        </p>
        <p className="track-note" style={{ marginTop: 0 }}>
          {t("shipment.carrier.links_once")}
        </p>

        {tokensFailed ? (
          <p className="form-err show" role="alert">
            {t("shipment.carrier.failed")}
          </p>
        ) : tokens.length === 0 ? (
          <p className="pempty" style={{ padding: "10px 0 0" }}>
            {t("shipment.carrier.no_links")}
          </p>
        ) : (
          <table className="ptable ptable--cards">
            <thead>
              <tr>
                <th scope="col">{t("shipment.carrier.link_driver")}</th>
                <th scope="col">{t("shipment.carrier.link_state")}</th>
                <th scope="col">{t("shipment.carrier.link_expires")}</th>
                <th scope="col">{t("shipment.carrier.link_uses")}</th>
                <th scope="col">{t("shipment.carrier.link_consent")}</th>
                <th scope="col">
                  <span className="sr-only">{t("shipment.carrier.link_revoke")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => {
                const state = driverTokenState(token);
                return (
                  <tr key={token.id}>
                    <td data-th={t("shipment.carrier.link_driver")}>
                      {token.driver_name ?? "—"}
                    </td>
                    {/* State as TEXT (§23), never a colour alone. */}
                    <td data-th={t("shipment.carrier.link_state")}>
                      {t(TOKEN_STATE_KEY[state])}
                    </td>
                    <td data-th={t("shipment.carrier.link_expires")}>
                      <time dateTime={token.expires_at}>
                        {formatTrackingDateTime(token.expires_at, locale)}
                      </time>
                    </td>
                    <td data-th={t("shipment.carrier.link_uses")}>{token.use_count}</td>
                    <td data-th={t("shipment.carrier.link_consent")}>
                      {t(`shipment.consent.${token.consent_status}`)}
                    </td>
                    <td data-th={t("shipment.carrier.link_revoke")}>
                      {state === "active" ? (
                        <RevokeButton shipmentId={shipment.id} tokenId={token.id} onDone={refresh} />
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {driverLinksEnabled ? (
          <div style={{ marginTop: 16 }}>
            <ActionCard
              title={t("shipment.carrier.issue_link")}
              action={issueDriverLinkAction}
              submitLabel={t("shipment.carrier.issue_link")}
              busyLabel={t("shipment.driver.sending")}
              onDone={refresh}
            >
              <input type="hidden" name="shipment_id" value={shipment.id} />
              <div className="field">
                <label htmlFor="cs-driver-name">{t("shipment.carrier.driver_name")}</label>
                <input
                  id="cs-driver-name"
                  name="driver_name"
                  type="text"
                  maxLength={120}
                  autoComplete="off"
                />
              </div>
            </ActionCard>
          </div>
        ) : (
          <p className="pempty" role="note" style={{ padding: "12px 0 0" }}>
            {t("shipment.driver.unavailable")}
          </p>
        )}
      </section>

      {/* §30 — §13's two document actions, named rather than missing. */}
      <section className="pcard" aria-labelledby="cs-docs">
        <h2 id="cs-docs">
          {DEFERRED_CARRIER_ACTIONS.map((a) => t(a.labelKey)).join(" · ")}
        </h2>
        <p className="pempty" style={{ padding: 0 }}>
          {t("shipment.carrier.docs_deferred")}
        </p>
      </section>

      {/* §7 timeline, carrier band only. */}
      <section className="track-section" aria-labelledby="cs-history">
        <h2 id="cs-history">{t("shipment.carrier.timeline_title")}</h2>
        <TrackingTimeline tracking={shipment} headingId="cs-timeline-heading" />
        {shipment.events.length === 0 ? (
          <p className="pempty" style={{ padding: "10px 0 0" }}>
            {t("shipment.carrier.timeline_empty")}
          </p>
        ) : (
          <ul className="track-events" aria-label={t("shipment.a11y.event_list")}>
            {shipment.events.map((event, index) => (
              <CarrierEventRow key={`${event.event_time}-${index}`} event={event} />
            ))}
          </ul>
        )}
        <p className="psh-more">
          {historyHasMore && historyMoreHref ? (
            <a className="btn btn-ghost btn-sm" rel="next" href={historyMoreHref}>
              {t("shipment.carrier.timeline_more")}
            </a>
          ) : null}
          {historyPaged ? (
            <a className="btn btn-ghost btn-sm" href={historyResetHref}>
              {t("shipment.carrier.timeline_reset")}
            </a>
          ) : null}
        </p>
      </section>
    </>
  );
}

function CarrierEventRow({ event }: { event: CustomerEventDto }) {
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

/**
 * Revocation is its own tiny form rather than a button inside the table's
 * markup: §13 makes revoking a WRITE, and a write needs a `<form>` with its
 * own busy state and its own `role="alert"` if it fails. A `<button onClick>`
 * firing a fetch would give a carrier no way to know it did not work.
 */
function RevokeButton({
  shipmentId,
  tokenId,
  onDone,
}: {
  shipmentId: string;
  tokenId: string;
  onDone: () => void;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(
    revokeDriverLinkAction,
    initialFormState,
  );
  useEffect(() => {
    if (state.status === "success") onDone();
  }, [state.status, state.message, onDone]);
  return (
    <form action={formAction}>
      <input type="hidden" name="shipment_id" value={shipmentId} />
      <input type="hidden" name="token_id" value={tokenId} />
      <button className="btn btn-ghost btn-sm" type="submit" aria-busy={pending} disabled={pending}>
        {t("shipment.carrier.link_revoke")}
      </button>
      {state.status === "error" ? (
        <span className="form-err show" role="alert">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
