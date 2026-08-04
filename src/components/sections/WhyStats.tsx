/*
 * Stats tiles: avg-rate figure was a V4 placeholder flagged "replace with
 * verifiable numbers" (audit F-13). Values become company_settings-driven in
 * M-14; the placeholder rate renders only while settings say so.
 */
export function WhyStats() {
  return (
    <section id="why">
      <div className="wrap why-grid">
        <div>
          <span className="eyebrow">Why PickLoads</span>
          <h2 className="sec">Built by people who answer the phone.</h2>
          <ul className="why-list">
            <li>
              <strong>Flat percentage. No hidden fees.</strong>
              <span>
                You see every rate con. What the broker pays is what you see.
              </span>
            </li>
            <li>
              <strong>No forced dispatch. No contracts that trap you.</strong>
              <span>
                Month to month. You approve every load before we book it.
              </span>
            </li>
            <li>
              <strong>A dedicated dispatcher — not a call center.</strong>
              <span>
                One person who knows your truck, your lanes and your family
                schedule.
              </span>
            </li>
            <li>
              <strong>24/7 support, including weekends.</strong>
              <span>
                Breakdowns and detention don&apos;t wait for business hours.
                Neither do we.
              </span>
            </li>
          </ul>
        </div>
        <div className="stats">
          <div className="stat">
            <b>5%</b>
            <span>Flat dispatch fee</span>
          </div>
          <div className="stat">
            <b>24/7</b>
            <span>Live dispatch support</span>
          </div>
          <div className="stat">
            <b>48</b>
            <span>States covered</span>
          </div>
          <div className="stat">
            <b>15min</b>
            <span>Callback promise</span>
          </div>
        </div>
      </div>
    </section>
  );
}
