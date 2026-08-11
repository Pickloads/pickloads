"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";

import {
  driverConsentAction,
  driverEtaAction,
  driverExceptionAction,
  driverStatusUpdateAction,
} from "@/app/actions/driver-updates";
import { initialFormState, type FormState } from "@/lib/form-state";
import { TurnstileWidget } from "@/components/forms/TurnstileWidget";
import { DEFERRED_CARRIER_ACTIONS } from "@/lib/shipments/carrier-updates";
import type { CarrierUpdateAction } from "@/lib/shipments/carrier-updates";
import type { DriverShipmentView } from "@/lib/shipments/driver-access";
import {
  ETA_KINDS,
  SHIPMENT_EXCEPTION_TYPES,
  exceptionTypeKey,
  statusKey,
  type TrackingConsentStatus,
} from "@/lib/shipments/types";
import { formatTrackingDateTime } from "@/components/tracking/format";

/**
 * M-76 — `/driver/update/[token]`, the §13 driver surface.
 *
 * ── §22: THIS IS A PHONE, ONE HAND, GLOVES, A DOCK ───────────────────────
 *
 * Not "responsive down to phone" — designed AT the phone and allowed to grow.
 * Concretely, and each one is asserted in
 * `tests/unit/carrier-driver-a11y.test.tsx` or the Playwright responsive
 * suite:
 *
 *   * ONE COLUMN at every width. There is no two-column arrangement to break.
 *   * Every control is a `.driver-*` class with `min-height: 56px` — a third
 *     larger than the 44px WCAG 2.5.8 floor, because the target is a gloved
 *     thumb on a cold morning, not a mouse.
 *   * NO HOVER-ONLY ANYTHING. Every state is text; every affordance is a
 *     control that exists whether or not a pointer is present.
 *   * The status choices are RADIO BUTTONS, not a `<select>`. A native select
 *     on a phone opens a picker over the whole screen and needs two taps plus
 *     a confirm; a stack of big radios needs one, and it shows every option
 *     without a gesture.
 *   * 320px is the design width. The tracking number wraps with
 *     `overflow-wrap`, the summary is a definition list, and nothing is a
 *     table.
 *
 * ── §23 ─────────────────────────────────────────────────────────────────
 *
 * A `<fieldset>` with a real `<legend>` per form; a `<label>` bound to every
 * input; `role="alert"` on refusals and `role="status"` on confirmations, so a
 * driver using VoiceOver hears the result instead of hunting for it;
 * `aria-busy` while the action runs; `<time datetime>` on every instant.
 *
 * ── §13/§30: WHAT THIS PAGE WILL NOT SHOW ───────────────────────────────
 *
 * No rate, no invoice, no customer price, no shipper identity, no internal
 * shipment id, and no map. `DriverShipmentView` cannot carry any of them —
 * 0023's redeem payload names no financial column, so they are not withheld
 * here, they never arrived. The page says so out loud, because a driver
 * wondering whether their employer can see what they can see deserves an
 * answer.
 *
 * ── §9/§13 CONSENT ──────────────────────────────────────────────────────
 *
 * The consent block is FIRST among the interactive blocks and its checkbox
 * starts unticked. Location fields do not exist in the DOM until consent is
 * granted — and the server refuses them independently, because a hidden field
 * is not a control. Turning it off again is one tap.
 */

/* ------------------------------------------------------------------ *
 * Shell
 * ------------------------------------------------------------------ */

function DriverForm({
  legend,
  help,
  action,
  token,
  children,
  submitLabel,
  busyLabel,
  onSuccess,
}: {
  legend: string;
  help?: ReactNode;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  token: string;
  children: ReactNode;
  submitLabel: string;
  busyLabel: string;
  onSuccess?: (state: FormState) => void;
}) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState(action, initialFormState);

  useEffect(() => {
    if (state.status === "success") onSuccess?.(state);
    // `state.status` + `state.message` ARE the whole of `state` that matters
    // here, and `onSuccess` is a stable closure at every call site. Depending
    // on the object identity would re-fire on every parent render — which on
    // the consent block would flip the local switch back and forth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, state.message]);

  return (
    <form action={formAction} className="driver-form">
      <fieldset>
        <legend>{legend}</legend>
        {help ? <p className="driver-help">{help}</p> : null}
        <input type="hidden" name="token" value={token} />
        {children}
        <TurnstileWidget theme="light" />
        <button
          className="btn btn-amber driver-submit"
          type="submit"
          aria-busy={pending}
          disabled={pending}
        >
          {pending ? busyLabel : submitLabel}
        </button>
      </fieldset>
      {/* Both regions are LIVE. A driver who cannot see the bottom of the
          screen must still be told what happened. Server actions return
          message KEYS (§24), so the sentence is in the reader's language. */}
      {state.status === "error" ? (
        <p className="driver-alert" role="alert">
          {t(state.message ?? "shipment.driver.invalid")}
        </p>
      ) : null}
      {state.status === "success" ? (
        <p className="driver-ok" role="status">
          {t(state.message ?? "shipment.driver.saved")}
        </p>
      ) : null}
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * The refusal — §30's "Tracking link expired", finally rendered
 * ------------------------------------------------------------------ */

/**
 * ONE card for four causes: never existed, expired, revoked, carrier
 * released. §13 requires the link to be non-enumerable, so the four must be
 * indistinguishable to whoever holds it; the distinction is in
 * `shipment_driver_token_access`, where only staff can read it.
 *
 * `shipment.label.tracking_link_expired` is §30's authored label. M-73
 * shipped it in five locales and recorded that it had no honest call site.
 * This is the call site.
 */
export function DriverLinkExpired({
  reasonKey = "shipment.driver.expired_body",
}: {
  reasonKey?: string;
}) {
  const t = useTranslations();
  return (
    <div className="driver-card" role="alert">
      <h1 className="driver-title">{t("shipment.label.tracking_link_expired")}</h1>
      <p className="driver-body">{t(reasonKey)}</p>
      <a className="btn btn-amber driver-submit" href="tel:+19084045373">
        {t("shipment.driver.call")}
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The grant
 * ------------------------------------------------------------------ */

export interface DriverUpdateViewProps {
  token: string;
  shipment: DriverShipmentView;
  /** Already filtered through §13's driver list and M-72's engine. */
  offeredActions: readonly CarrierUpdateAction[];
  consentStatus: TrackingConsentStatus;
  expiresAt: string;
  driverName: string | null;
}

export function DriverUpdateView({
  token,
  shipment,
  offeredActions,
  consentStatus,
  expiresAt,
  driverName,
}: DriverUpdateViewProps) {
  const t = useTranslations();
  const locale = useLocale();

  /*
   * Consent is server state that this component also has to react to WITHIN a
   * page view: a driver ticks the box, saves, and the location fields must
   * appear without a reload — on a dock, a reload is a spinner on 1 bar of
   * signal. The server remains the authority (`driverStatusUpdateAction`
   * re-reads `consent_status` from the token row on every submit and refuses a
   * location without it), so this state can only ever be optimistic about the
   * UI, never about the permission.
   */
  const [consent, setConsent] = useState<TrackingConsentStatus>(consentStatus);
  const sharing = consent === "granted";

  const transitions = offeredActions.filter((a) => a.kind === "transition");
  const canEta = offeredActions.some((a) => a.kind === "eta");
  const canException = offeredActions.some((a) => a.kind === "exception");

  return (
    <div className="driver-page">
      <header className="driver-card">
        <h1 className="driver-title">{t("shipment.driver.title")}</h1>
        <p className="driver-body">{t("shipment.driver.intro")}</p>
        {driverName ? (
          <p className="driver-meta">
            {t("shipment.driver.for_driver", { name: driverName })}
          </p>
        ) : null}
      </header>

      {/* §22's mobile priority order, applied to a driver rather than a
          customer: current status first, then the stops, then everything
          else. A driver's first question is "which load is this?". */}
      <section className="driver-card" aria-labelledby="dv-summary">
        <h2 id="dv-summary" className="driver-h2">
          {t("shipment.driver.shipment")}
        </h2>
        <dl className="driver-dl">
          <dt>{t("shipment.result.tracking_number")}</dt>
          <dd className="mono">{shipment.tracking_number}</dd>
          <dt>{t("shipment.driver.current_status")}</dt>
          <dd>{t(statusKey(shipment.status))}</dd>
          <dt>{t("shipment.driver.pickup")}</dt>
          <dd>
            {shipment.origin_company ? `${shipment.origin_company} — ` : ""}
            {shipment.origin_city}, {shipment.origin_state}
            {shipment.pickup_appointment_at ? (
              <>
                {" · "}
                <time dateTime={shipment.pickup_appointment_at}>
                  {formatTrackingDateTime(shipment.pickup_appointment_at, locale)}
                </time>
              </>
            ) : null}
          </dd>
          <dt>{t("shipment.driver.delivery")}</dt>
          <dd>
            {shipment.destination_company
              ? `${shipment.destination_company} — `
              : ""}
            {shipment.destination_city}, {shipment.destination_state}
            {shipment.delivery_appointment_at ? (
              <>
                {" · "}
                <time dateTime={shipment.delivery_appointment_at}>
                  {formatTrackingDateTime(
                    shipment.delivery_appointment_at,
                    locale,
                  )}
                </time>
              </>
            ) : null}
          </dd>
          <dt>{t("shipment.driver.equipment")}</dt>
          <dd>{shipment.equipment}</dd>
        </dl>
        <p className="driver-meta">
          {t("shipment.driver.expires", {
            when: formatTrackingDateTime(expiresAt, locale) ?? expiresAt,
          })}
        </p>
        {/* §13 said it; the page says it too, because a driver should not have
            to take our word for what a page is not showing them. */}
        <p className="driver-meta">{t("shipment.driver.no_money")}</p>
      </section>

      {/* §9/§13 — consent, first and unticked. */}
      <section className="driver-card" aria-labelledby="dv-consent">
        <h2 id="dv-consent" className="driver-h2">
          {t("shipment.driver.consent_title")}
        </h2>
        <p className="driver-body">{t("shipment.driver.consent_body")}</p>
        <p className="driver-meta">
          {t("shipment.driver.consent_state")}:{" "}
          {t(`shipment.consent.${consent}`)}
        </p>
        <DriverForm
          legend={t("shipment.driver.consent_title")}
          action={driverConsentAction}
          token={token}
          submitLabel={t("shipment.driver.consent_save")}
          busyLabel={t("shipment.driver.sending")}
          onSuccess={(state) =>
            setConsent(
              state.message === "shipment.driver.consent_on"
                ? "granted"
                : "denied",
            )
          }
        >
          <label className="driver-check" htmlFor="dv-consent-box">
            <input
              id="dv-consent-box"
              name="granted"
              type="checkbox"
              value="on"
              defaultChecked={sharing}
            />
            <span>{t("shipment.driver.consent_checkbox")}</span>
          </label>
        </DriverForm>
      </section>

      {/* §13's limited status transitions. */}
      <section className="driver-card" aria-labelledby="dv-status">
        <h2 id="dv-status" className="driver-h2">
          {t("shipment.driver.status_legend")}
        </h2>
        {transitions.length === 0 ? (
          <p className="driver-body">{t("shipment.driver.no_actions")}</p>
        ) : (
          <DriverForm
            legend={t("shipment.driver.status_legend")}
            action={driverStatusUpdateAction}
            token={token}
            submitLabel={t("shipment.driver.submit")}
            busyLabel={t("shipment.driver.sending")}
          >
            <input
              type="hidden"
              name="expected_status"
              value={shipment.status}
            />
            {/* Radios, not a select — see the header. */}
            <div className="driver-choices" role="group" aria-labelledby="dv-status">
              {transitions.map((action) => (
                <label className="driver-choice" key={action.id} htmlFor={`dv-a-${action.id}`}>
                  <input
                    id={`dv-a-${action.id}`}
                    type="radio"
                    name="action"
                    value={action.id}
                    required
                  />
                  <span>{t(action.labelKey)}</span>
                </label>
              ))}
            </div>

            {sharing ? (
              <div className="driver-field-group">
                <p className="driver-help">{t("shipment.driver.location_legend")}</p>
                <div className="driver-field">
                  <label htmlFor="dv-city">{t("shipment.driver.city")}</label>
                  <input id="dv-city" name="city" type="text" maxLength={80} autoComplete="off" />
                </div>
                <div className="driver-field">
                  <label htmlFor="dv-state">{t("shipment.driver.state")}</label>
                  <input
                    id="dv-state"
                    name="state"
                    type="text"
                    maxLength={2}
                    autoComplete="off"
                    autoCapitalize="characters"
                  />
                </div>
              </div>
            ) : null}

            <div className="driver-field">
              <label htmlFor="dv-note">{t("shipment.driver.note")}</label>
              <textarea
                id="dv-note"
                name="note"
                rows={2}
                maxLength={500}
                placeholder={t("shipment.driver.note_placeholder")}
              />
            </div>
          </DriverForm>
        )}
      </section>

      {canEta ? (
        <section className="driver-card" aria-labelledby="dv-eta">
          <h2 id="dv-eta" className="driver-h2">
            {t("shipment.driver.eta_legend")}
          </h2>
          <DriverForm
            legend={t("shipment.driver.eta_legend")}
            action={driverEtaAction}
            token={token}
            submitLabel={t("shipment.driver.eta_submit")}
            busyLabel={t("shipment.driver.sending")}
          >
            <div className="driver-field">
              <label htmlFor="dv-eta-kind">{t("shipment.driver.eta_kind")}</label>
              <select id="dv-eta-kind" name="kind" defaultValue="delivery">
                {ETA_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind === "pickup"
                      ? t("shipment.driver.pickup")
                      : t("shipment.driver.delivery")}
                  </option>
                ))}
              </select>
            </div>
            <div className="driver-field">
              <label htmlFor="dv-eta-at">{t("shipment.driver.eta_at")}</label>
              {/* §22's "no iOS date-input overflow": the control is
                  width:100% inside a one-column card, which is the shape iOS
                  cannot overflow. */}
              <input id="dv-eta-at" name="eta_at" type="datetime-local" required />
            </div>
            <div className="driver-field">
              <label htmlFor="dv-delay">{t("shipment.driver.delay_minutes")}</label>
              <input
                id="dv-delay"
                name="delay_minutes"
                type="number"
                min={0}
                max={20160}
                inputMode="numeric"
              />
            </div>
            <div className="driver-field">
              <label htmlFor="dv-eta-note">{t("shipment.driver.note")}</label>
              <textarea id="dv-eta-note" name="note" rows={2} maxLength={500} />
            </div>
          </DriverForm>
        </section>
      ) : null}

      {canException ? (
        <section className="driver-card" aria-labelledby="dv-exc">
          <h2 id="dv-exc" className="driver-h2">
            {t("shipment.driver.exception_legend")}
          </h2>
          <DriverForm
            legend={t("shipment.driver.exception_legend")}
            help={t("shipment.driver.exception_note")}
            action={driverExceptionAction}
            token={token}
            submitLabel={t("shipment.driver.exception_submit")}
            busyLabel={t("shipment.driver.sending")}
          >
            <div className="driver-field">
              <label htmlFor="dv-exc-type">{t("shipment.driver.exception_type")}</label>
              <select id="dv-exc-type" name="exception_type" required defaultValue="">
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
            <div className="driver-field">
              <label htmlFor="dv-exc-desc">
                {t("shipment.driver.exception_description")}
              </label>
              <textarea id="dv-exc-desc" name="description" rows={3} maxLength={500} required />
            </div>
          </DriverForm>
        </section>
      ) : null}

      {/* §30 — M-77's two actions, named rather than missing. */}
      <section className="driver-card" aria-labelledby="dv-docs">
        <h2 id="dv-docs" className="driver-h2">
          {DEFERRED_CARRIER_ACTIONS.map((a) => t(a.labelKey)).join(" · ")}
        </h2>
        <p className="driver-body">{t("shipment.driver.docs_deferred")}</p>
      </section>

      <footer className="driver-card">
        <p className="driver-meta">{t("shipment.driver.honest_note")}</p>
        <a className="btn btn-amber driver-submit" href="tel:+19084045373">
          {t("shipment.driver.call")}
        </a>
      </footer>
    </div>
  );
}
