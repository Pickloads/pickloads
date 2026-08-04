import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/ui/Logo";
import { useV4 } from "@/i18n/v4";

/*
 * V4 footer. State links point to the six priority state pages (arch §8);
 * they 404 until M-35 publishes real content — hidden behind the M-16/M-35
 * rollout by linking only the "All 48 States" index once it exists.
 * MC/USDOT line becomes company_settings-driven in M-14.
 */
const EQUIPMENT_LINKS = [
  ["dry-van", "Dry Van Dispatch"],
  ["reefer", "Reefer Dispatch"],
  ["flatbed", "Flatbed Dispatch"],
  ["power-only", "Power Only Dispatch"],
  ["hot-shot", "Hot Shot Dispatch"],
  ["box-truck", "Box Truck Dispatch"],
  ["sprinter-van", "Sprinter Van Dispatch"],
] as const;

const STATE_LINKS = [
  ["new-jersey", "New Jersey Truck Dispatch"],
  ["new-york", "New York Truck Dispatch"],
  ["florida", "Florida Truck Dispatch"],
  ["georgia", "Georgia Truck Dispatch"],
  ["texas", "Texas Truck Dispatch"],
  ["illinois", "Illinois Truck Dispatch"],
] as const;

export function Footer() {
  const tv = useV4();
  return (
    <footer id="contact-foot">
      <div className="wrap">
        <div className="foot-grid">
          <div className="foot-brand">
            <Logo small />
            <p>
              {tv("Truck dispatching & freight brokerage.")}
              <br />
              50 Union Ave, Suite 805-A, Irvington, NJ 07111
            </p>
            <p className="mono" style={{ fontSize: ".72rem", marginTop: 10 }}>
              <span aria-hidden="true">☎</span> (908) 404-5373
              <br />
              support@pickloads.com
              <br />
              {tv("MC # pending · USDOT # pending")}
            </p>
          </div>
          <div>
            <h4>{tv("Services")}</h4>
            <Link href="/#dispatch">{tv("Truck Dispatching")}</Link>
            <Link href="/shippers">{tv("Freight Brokerage")}</Link>
            <Link href="/#pricing">{tv("Pricing")}</Link>
            <Link href="/#packet">{tv("Carrier Packet")}</Link>
            <Link href="/#compliance">{tv("Compliance")}</Link>
          </div>
          <div>
            <h4>{tv("Dispatch by Equipment")}</h4>
            {EQUIPMENT_LINKS.map(([slug, label]) => (
              <Link key={slug} href={`/dispatch/${slug}`}>
                {tv(label)}
              </Link>
            ))}
          </div>
          <div>
            <h4>{tv("Dispatch by State")}</h4>
            {STATE_LINKS.map(([slug, label]) => (
              <Link key={slug} href={`/truck-dispatch/${slug}`}>
                {tv(label)}
              </Link>
            ))}
            <Link href="/truck-dispatch">{tv("All 48 States →")}</Link>
          </div>
          <div>
            <h4>{tv("Carriers")}</h4>
            <Link href="/become-a-carrier">{tv("Become a Carrier")}</Link>
            <Link href="/start-your-trucking-company">
              {tv("Start Your Trucking Company")}
            </Link>
            <Link href="/#packet">{tv("Carrier Packet")}</Link>
            <Link href="/#packet">{tv("Insurance Requirements")}</Link>
            <Link href="/#packet">{tv("Factoring")}</Link>
            <Link href="/faq">{tv("Carrier FAQ")}</Link>
            <Link href="/login">{tv("Carrier Login")}</Link>
          </div>
          <div>
            <h4>{tv("Company")}</h4>
            <Link href="/about">{tv("About Us")}</Link>
            <Link href="/shippers">{tv("For Shippers")}</Link>
            <Link href="/blog">{tv("Freight Insights")}</Link>
            <Link href="/faq">{tv("FAQ")}</Link>
            <Link href="/contact">{tv("Contact")}</Link>
            {/* M-51: support = staffed inbox for now; the in-portal support
                module (threads) is a later phase of the upgrade directive. */}
            <Link href="/contact">{tv("Support")}</Link>
            <Link href="/login">{tv("Shipper Login")}</Link>
          </div>
        </div>
        <div className="foot-bottom">
          <span>
            {tv(
              "© 2026 PickLoads Logistics Group LLC · pickloads.com · All rights reserved.",
            )}
          </span>
          <span>
            <Link href="/legal/privacy">{tv("Privacy")}</Link> ·{" "}
            <Link href="/legal/terms">{tv("Terms")}</Link> ·{" "}
            <Link href="/legal/cookies">{tv("Cookies")}</Link> ·{" "}
            <Link href="/legal/carrier-agreement">
              {tv("Carrier Agreement")}
            </Link>{" "}
            ·{" "}
            <Link href="/legal/dispatch-agreement">
              {tv("Dispatch Agreement")}
            </Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
