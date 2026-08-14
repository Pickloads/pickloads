"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { lookupTracking } from "@/app/actions/public-tracking";
import { initialTrackingState } from "@/lib/shipments/public-tracking-state";
import {
  TurnstileWidget,
  useTurnstileReset,
} from "@/components/forms/TurnstileWidget";
import { TrackingResult } from "@/components/tracking/TrackingResult";

/**
 * M-73 — the §4 two-factor lookup form and its result.
 *
 * ── TWO FACTORS, ALWAYS ───────────────────────────────────────────────────
 *
 * §4: "Do not allow tracking by shipment number alone." Both inputs are
 * `required`, both are validated server-side by Zod, and — the part that
 * matters — the server does not have a code path that returns shipment data
 * without a successful constant-time comparison of the second value. The
 * `required` attributes are a courtesy to the person typing; the guarantee is
 * in `src/lib/shipments/public-lookup.ts`.
 *
 * ── ONE REFUSAL (§19) ─────────────────────────────────────────────────────
 *
 * There is exactly one error branch for a failed lookup, rendering one
 * message key. A wrong number, a wrong ZIP and an admin-suspended shipment are
 * indistinguishable here because they are indistinguishable in the action's
 * return value — the enumeration guarantee is not re-litigated in the UI, it
 * is inherited from a server contract that cannot express the difference.
 *
 * ── THE FORM STAYS ────────────────────────────────────────────────────────
 *
 * A successful result renders BELOW the form rather than replacing it. No
 * hidden state to reset, no "start over" button that has to remember what to
 * clear, and a second lookup is one edit away. `.bigform` is the V4 vocabulary
 * every other public form on this site uses.
 *
 * ── M-79: `?number=` PREFILL, AND ONLY THAT ───────────────────────────────
 *
 * §17 requires every customer notification to carry a tracking link. The link
 * is `/track?number=PL-YYYY-######`, and this is where it lands.
 *
 * Read CLIENT-SIDE, through `useSearchParams`, so the page itself stays a
 * static prerendered shell — the property that makes §25's *"never cache
 * private shipment data publicly"* true by construction (the shell contains no
 * shipment). A server-side `searchParams` read would make the whole route
 * dynamic to prefill one text input.
 *
 * ONLY THE FIRST FACTOR IS PREFILLED, and no code path here can change that:
 * the second input has no default, no query parameter is consulted for it, and
 * M-73's threat model is explicit about why — a URL carrying the ZIP or access
 * code puts BOTH factors into a location bar, a browser history, a `Referer`
 * header and every corporate proxy log between the customer and us. An email
 * is forwarded, archived and machine-scanned far more often than a page is
 * visited, which makes the link the worst place of all to carry a secret.
 *
 * A prefilled number still submits nothing on its own: `required` on both
 * inputs, Turnstile, the rate limit and the constant-time comparison of the
 * second value are all unchanged and all server-side.
 */
export function TrackingLookup() {
  const t = useTranslations();
  const prefilledNumber = useSearchParams().get("number") ?? "";
  const [state, formAction, pending] = useActionState(
    lookupTracking,
    initialTrackingState,
  );
  // SEC-P1-01: a spent Turnstile token is re-sent on the next submit unless
  // the widget remounts. Counting settled submissions is what remounts it.
  const turnstileAttempt = useTurnstileReset(state);

  return (
    <>
      <div className="bigform" id="track-form">
        <h2>{t("shipment.form.legend")}</h2>
        <p>{t("shipment.page.privacy_note")}</p>
        <form action={formAction}>
          <div className="grid2">
            <div className="field">
              <label htmlFor="tk-number">
                {t("shipment.form.tracking_number")}
              </label>
              <input
                id="tk-number"
                name="tracking_number"
                type="text"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="PL-2026-000458"
                defaultValue={prefilledNumber}
                required
                aria-describedby="tk-number-hint tk-err"
              />
              <span
                id="tk-number-hint"
                className="track-note"
                style={{ marginTop: 6 }}
              >
                {t("shipment.form.tracking_number_hint")}
              </span>
            </div>
            <div className="field">
              <label htmlFor="tk-secondary">
                {t("shipment.form.secondary")}
              </label>
              <input
                id="tk-secondary"
                name="secondary"
                type="text"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                required
                aria-describedby="tk-secondary-hint tk-err"
              />
              <span
                id="tk-secondary-hint"
                className="track-note"
                style={{ marginTop: 6 }}
              >
                {t("shipment.form.secondary_hint")}
              </span>
            </div>
          </div>
          <TurnstileWidget theme="light" resetKey={turnstileAttempt} />
          <button
            className="btn btn-amber"
            type="submit"
            aria-busy={pending}
            disabled={pending}
          >
            {pending
              ? t("shipment.form.submitting")
              : t("shipment.form.submit")}
          </button>
        </form>
        <div
          id="tk-err"
          className={`form-err${state.status === "error" ? " show" : ""}`}
          role="alert"
        >
          {state.status === "error" ? t(state.messageKey) : null}
        </div>
      </div>

      {state.status === "success" ? (
        <TrackingResult
          tracking={state.tracking}
          timelineTruncated={state.timelineTruncated}
        />
      ) : null}
    </>
  );
}
