import { useV4 } from "@/i18n/v4";

/*
 * Credential values become company_settings-driven in M-14 (arch §9): the day
 * MC/USDOT activate, admin edits settings and this block updates site-wide.
 */
export function Compliance() {
  const tv = useV4();
  return (
    <section className="compliance" id="compliance">
      <div className="wrap">
        <div>
          <h2>{tv("Verify us before you sign. We insist.")}</h2>
          <p>
            {tv(
              "Every serious carrier checks FMCSA SAFER before working with anyone — and they should. Our registration numbers, bond and insurance certificates will be published here the day they're active, with direct links to verify them yourself.",
            )}
          </p>
        </div>
        <div className="creds">
          <div className="cred">
            <span>{tv("MC NUMBER")}</span>
            <b>{tv("PENDING — FMCSA FILING")}</b>
          </div>
          <div className="cred">
            <span>{tv("USDOT NUMBER")}</span>
            <b>{tv("PENDING — FMCSA FILING")}</b>
          </div>
          <div className="cred">
            <span>{tv("BMC-84 SURETY BOND ($75K)")}</span>
            <b>{tv("IN PROCESS")}</b>
          </div>
          <div className="cred">
            <span>{tv("CERTIFICATE OF INSURANCE")}</span>
            <b>{tv("ON REQUEST")}</b>
          </div>
        </div>
      </div>
    </section>
  );
}
