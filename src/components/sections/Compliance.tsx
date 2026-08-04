/*
 * Credential values become company_settings-driven in M-14 (arch §9): the day
 * MC/USDOT activate, admin edits settings and this block updates site-wide.
 */
export function Compliance() {
  return (
    <section className="compliance" id="compliance">
      <div className="wrap">
        <div>
          <h2>Verify us before you sign. We insist.</h2>
          <p>
            Every serious carrier checks FMCSA SAFER before working with anyone
            — and they should. Our registration numbers, bond and insurance
            certificates will be published here the day they&apos;re active,
            with direct links to verify them yourself.
          </p>
        </div>
        <div className="creds">
          <div className="cred">
            <span>MC NUMBER</span>
            <b>PENDING — FMCSA FILING</b>
          </div>
          <div className="cred">
            <span>USDOT NUMBER</span>
            <b>PENDING — FMCSA FILING</b>
          </div>
          <div className="cred">
            <span>BMC-84 SURETY BOND ($75K)</span>
            <b>IN PROCESS</b>
          </div>
          <div className="cred">
            <span>CERTIFICATE OF INSURANCE</span>
            <b>ON REQUEST</b>
          </div>
        </div>
      </div>
    </section>
  );
}
