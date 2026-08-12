import { useV4 } from "@/i18n/v4";
import { HEADLINE_TIER } from "@/lib/pricing";
/*
 * Stats tiles: avg-rate figure was a V4 placeholder flagged "replace with
 * verifiable numbers" (audit F-13). Values become company_settings-driven in
 * M-14; the placeholder rate renders only while settings say so.
 *
 * ── OWNER DECISIONS, 2026-08-12 ──────────────────────────────────────────
 *
 * Four tiles, and three of them made a claim the business could not stand
 * behind. This is the densest concentration of unsupported promises on the
 * site, because a stat tile is a bare assertion with no room to qualify it.
 *
 *   * `24/7 · Live dispatch support` implied a continuously staffed desk.
 *     Approved reality is seven-day support with after-hours EMERGENCY
 *     cover — a different promise, and the one we can keep (decision A1).
 *   * `15min · Callback promise` was a guarantee in the strongest word
 *     available. Fifteen minutes survives as an INTERNAL KPI on the staff
 *     lead email; it is no longer sold to the public (decision A2).
 *   * `5% · Flat dispatch fee` described the entire model as 5% when small
 *     fleets pay 4.5% and box truck / hot shot pays 8%. The number was
 *     right; "flat dispatch fee" was the untrue part. It now names its tier
 *     and reads its value from the canonical pricing source (decision C).
 *   * `48 · States covered` read as coverage already proven. We are
 *     PREPARED to support the 48 contiguous states, which is not the same
 *     claim (decision C).
 */
export function WhyStats() {
  const tv = useV4();
  return (
    <section id="why">
      <div className="wrap why-grid">
        <div>
          <span className="eyebrow">{tv("Why PickLoads")}</span>
          <h2 className="sec">{tv("Built by people who answer the phone.")}</h2>
          <ul className="why-list">
            <li>
              <strong>{tv("Flat percentage. No hidden fees.")}</strong>
<span>{tv("You see every rate con. What the broker pays is what you see.")}</span>
            </li>
            <li>
              <strong>{tv("No forced dispatch. No contracts that trap you.")}</strong>
<span>{tv("Month to month. You approve every load before we book it.")}</span>
            </li>
            <li>
              <strong>{tv("A dedicated dispatcher — not a call center.")}</strong>
<span>{tv("One person who knows your truck, your lanes and your family schedule.")}</span>
            </li>
            <li>
              <strong>{tv("Support 7 days a week, weekends included.")}</strong>
<span>{tv("Breakdowns and detention don't wait for business hours — after-hours emergency support is there when they happen.")}</span>
            </li>
          </ul>
        </div>
        <div className="stats">
          <div className="stat">
            <b>{HEADLINE_TIER.rate}%</b>
            <span>{tv("Owner-operator dispatch fee")}</span>
          </div>
          <div className="stat">
            <b>{tv("7 DAYS")}</b>
            <span>{tv("Dispatch support every week")}</span>
          </div>
          <div className="stat">
            <b>48</b>
            <span>{tv("Contiguous states supported")}</span>
          </div>
          <div className="stat">
            {/* "You", not "YOU": the slug is `you`, an existing catalogue key
                that already carries Tú / Vous. The label beneath is uppercased
                by CSS; this is not. */}
            <b>{tv("You")}</b>
            <span>{tv("Approve every rate")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
