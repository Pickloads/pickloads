import { useV4 } from "@/i18n/v4";

import { ONBOARDING_TIMING } from "@/lib/copy/onboarding-timing";

export function HowAndCompare() {
  const tv = useV4();
  return (
    <section className="light" id="how">
      <div className="wrap">
        <span className="eyebrow">{tv("Carrier onboarding")}</span>
        {/* Owner decision A3 (2026-08-12): the heading used to read "On the
            road with us in 24 hours." — an unconditional promise, made on the
            homepage, about an outcome PickLoads does not control. The four
            steps below are ours; load availability, broker acceptance and the
            carrier's own paperwork are not. Heading and qualifier both come
            from `@/lib/copy/onboarding-timing` so the claim cannot drift
            between here and the carrier landing page. */}
        <h2 className="sec">{tv(ONBOARDING_TIMING.headline)}</h2>
        <p className="sub">{tv(ONBOARDING_TIMING.qualifier)}</p>
        <div className="steps">
          <div className="step">
            <span className="n">{tv("STEP 1")}</span>
            <h3>{tv("Send your docs")}</h3>
            <p>
              {tv(
                "MC/DOT, W-9, certificate of insurance and a voided check — uploaded in one secure form.",
              )}
            </p>
            <span className="t">{tv("≈ 5 minutes")}</span>
          </div>
          <div className="step">
            <span className="n">{tv("STEP 2")}</span>
            <h3>{tv("Sign electronically")}</h3>
            <p>
              {tv(
                "Review the dispatch agreement and sign from your phone. No printer, no fax.",
              )}
            </p>
            <span className="t">{tv("≈ 10 minutes")}</span>
          </div>
          <div className="step">
            <span className="n">{tv("STEP 3")}</span>
            <h3>{tv("We book your first load")}</h3>
            <p>
              {tv(
                "Your dispatcher learns your lanes, your rate floor and your home-time needs — then gets to work.",
              )}
            </p>
            <span className="t">{tv("Same day")}</span>
          </div>
          <div className="step">
            <span className="n">{tv("STEP 4")}</span>
            <h3>{tv("You drive. You get paid.")}</h3>
            <p>
              {tv(
                "We handle rate cons, BOLs and invoicing. You focus on miles.",
              )}
            </p>
            <span className="t">{tv("Every week")}</span>
          </div>
        </div>

        <div style={{ marginTop: 80 }}>
          <span className="eyebrow">{tv("Why carriers switch")}</span>
          <h2 className="sec">{tv("The difference is in the details.")}</h2>
          <div className="compare">
            <table>
              <thead>
                <tr>
                  <th className="them">{tv("Typical dispatch companies")}</th>
                  <th className="us">{tv("PickLoads")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="them">
                    {tv("A different dispatcher every call")}
                  </td>
                  <td className="us">
                    {tv("One dedicated dispatcher who knows your truck")}
                  </td>
                </tr>
                <tr>
                  <td className="them">
                    {tv("Loads booked without checking the broker")}
                  </td>
                  <td className="us">
                    {tv("Broker credit & authority verified before booking")}
                  </td>
                </tr>
                <tr>
                  <td className="them">{tv("Voicemail after 5pm")}</td>
                  <td className="us">
                    {tv("Live support 7 days a week, weekends included")}
                  </td>
                </tr>
                <tr>
                  <td className="them">
                    {tv("Hidden fees buried in the agreement")}
                  </td>
                  <td className="us">
                    {tv("One flat percentage — you see every rate con")}
                  </td>
                </tr>
                <tr>
                  <td className="them">{tv("Load-to-load thinking")}</td>
                  <td className="us">
                    {tv("Strategic lane planning toward home time")}
                  </td>
                </tr>
                <tr>
                  <td className="them">{tv("Long contracts that trap you")}</td>
                  <td className="us">{tv("Month to month — leave anytime")}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
