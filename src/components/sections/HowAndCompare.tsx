export function HowAndCompare() {
  return (
    <section className="light" id="how">
      <div className="wrap">
        <span className="eyebrow">Carrier onboarding</span>
        <h2 className="sec">On the road with us in 24 hours.</h2>
        <div className="steps">
          <div className="step">
            <span className="n">STEP 1</span>
            <h3>Send your docs</h3>
            <p>
              MC/DOT, W-9, certificate of insurance and a voided check —
              uploaded in one secure form.
            </p>
            <span className="t">≈ 5 minutes</span>
          </div>
          <div className="step">
            <span className="n">STEP 2</span>
            <h3>Sign electronically</h3>
            <p>
              Review the dispatch agreement and sign from your phone. No
              printer, no fax.
            </p>
            <span className="t">≈ 10 minutes</span>
          </div>
          <div className="step">
            <span className="n">STEP 3</span>
            <h3>We book your first load</h3>
            <p>
              Your dispatcher learns your lanes, your rate floor and your
              home-time needs — then gets to work.
            </p>
            <span className="t">Same day</span>
          </div>
          <div className="step">
            <span className="n">STEP 4</span>
            <h3>You drive. You get paid.</h3>
            <p>We handle rate cons, BOLs and invoicing. You focus on miles.</p>
            <span className="t">Every week</span>
          </div>
        </div>

        <div style={{ marginTop: 80 }}>
          <span className="eyebrow">Why carriers switch</span>
          <h2 className="sec">The difference is in the details.</h2>
          <div className="compare">
            <table>
              <thead>
                <tr>
                  <th className="them">Typical dispatch companies</th>
                  <th className="us">PickLoads</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="them">A different dispatcher every call</td>
                  <td className="us">One dedicated dispatcher who knows your truck</td>
                </tr>
                <tr>
                  <td className="them">Loads booked without checking the broker</td>
                  <td className="us">Broker credit &amp; authority verified before booking</td>
                </tr>
                <tr>
                  <td className="them">Voicemail after 5pm</td>
                  <td className="us">24/7 live support, weekends included</td>
                </tr>
                <tr>
                  <td className="them">Hidden fees buried in the agreement</td>
                  <td className="us">One flat percentage — you see every rate con</td>
                </tr>
                <tr>
                  <td className="them">Load-to-load thinking</td>
                  <td className="us">Strategic lane planning toward home time</td>
                </tr>
                <tr>
                  <td className="them">Long contracts that trap you</td>
                  <td className="us">Month to month — leave anytime</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
