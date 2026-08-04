import { useV4 } from "@/i18n/v4";
/*
 * Stats tiles: avg-rate figure was a V4 placeholder flagged "replace with
 * verifiable numbers" (audit F-13). Values become company_settings-driven in
 * M-14; the placeholder rate renders only while settings say so.
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
              <strong>{tv("24/7 support, including weekends.")}</strong>
<span>{tv("Breakdowns and detention don't wait for business hours. Neither do we.")}</span>
            </li>
          </ul>
        </div>
        <div className="stats">
          <div className="stat">
            <b>5%</b>
            <span>{tv("Flat dispatch fee")}</span>
          </div>
          <div className="stat">
            <b>24/7</b>
            <span>{tv("Live dispatch support")}</span>
          </div>
          <div className="stat">
            <b>48</b>
            <span>{tv("States covered")}</span>
          </div>
          <div className="stat">
            <b>15min</b>
            <span>{tv("Callback promise")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
