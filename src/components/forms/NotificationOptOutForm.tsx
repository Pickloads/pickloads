"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { initialFormState } from "@/lib/form-state";
import {
  optOutShipmentNotifications,
  resumeShipmentNotifications,
} from "@/app/actions/notification-preferences";

/**
 * M-79 — the POST half of the shipment-notification opt-out.
 *
 * The page that renders this has already looked the token up READ-ONLY; the
 * change happens only when a human presses a button, never on the GET that
 * mail scanners prefetch (M-69/P-1's rule, applied unchanged).
 *
 * BOTH DIRECTIONS ARE HERE, and that is deliberate. An opt-out reachable from
 * an email is a compliance requirement; an opt-BACK-IN reachable from the same
 * page is what makes a misclick recoverable without asking the customer to
 * find a login. Neither button is a link in an email — the second one is only
 * reachable once you are already on this page holding the token.
 *
 * §24: every string is a `shipment.optout.*` message key, so the page speaks
 * the recipient's language in all five locales rather than English with a
 * translated shell.
 */
export function NotificationOptOutForm({
  token,
  alreadyOptedOut,
}: {
  token: string;
  alreadyOptedOut: boolean;
}) {
  const t = useTranslations("shipment.optout");
  const [optOutState, optOutAction, optOutPending] = useActionState(
    optOutShipmentNotifications,
    initialFormState,
  );
  const [resumeState, resumeAction, resumePending] = useActionState(
    resumeShipmentNotifications,
    initialFormState,
  );

  const stoppedNow = optOutState.status === "success";
  const resumedNow = resumeState.status === "success";
  // `alreadyOptedOut` is the state at page load; the two action results are
  // what happened since. The most recent wins.
  const stopped = resumedNow ? false : stoppedNow || alreadyOptedOut;
  const errorMessage =
    optOutState.status === "error"
      ? optOutState.message
      : resumeState.status === "error"
        ? resumeState.message
        : null;

  return (
    <>
      {stopped ? (
        <form action={resumeAction}>
          <input type="hidden" name="token" value={token} />
          <div className="form-ok show" role="status" aria-live="polite">
            {t("stopped")}
          </div>
          <button className="btn btn-ghost" type="submit" disabled={resumePending}>
            {resumePending ? t("resuming") : t("resume_cta")}
          </button>
        </form>
      ) : (
        <form action={optOutAction}>
          <input type="hidden" name="token" value={token} />
          <button className="btn btn-amber" type="submit" disabled={optOutPending}>
            {optOutPending ? t("stopping") : t("stop_cta")}
          </button>
          <div
            className={`form-ok ${resumedNow ? "show" : ""}`}
            role="status"
            aria-live="polite"
          >
            {t("resumed")}
          </div>
        </form>
      )}
      <div
        className={`form-err ${errorMessage ? "show" : ""}`}
        role="alert"
      >
        {errorMessage}
      </div>
    </>
  );
}
