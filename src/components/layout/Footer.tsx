import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { ComingSoonLink } from "@/components/ui/ComingSoonLink";

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

export function Footer() {
  return (
    <footer id="contact-foot">
      <div className="wrap">
        <div className="foot-grid">
          <div className="foot-brand">
            <Logo small />
            <p>
              Truck dispatching &amp; freight brokerage.
              <br />
              50 Union Ave, Suite 805-A, Irvington, NJ 07111
            </p>
            <p className="mono" style={{ fontSize: ".72rem", marginTop: 10 }}>
              ☎ (908) 404-5373
              <br />
              support@pickloads.com
              <br />
              MC # pending · USDOT # pending
            </p>
          </div>
          <div>
            <h4>Services</h4>
            <Link href="/#dispatch">Truck Dispatching</Link>
            <Link href="/shippers">Freight Brokerage</Link>
            <Link href="/#pricing">Pricing</Link>
            <Link href="/#packet">Carrier Packet</Link>
            <Link href="/#compliance">Compliance</Link>
          </div>
          <div>
            <h4>Dispatch by Equipment</h4>
            {EQUIPMENT_LINKS.map(([slug, label]) => (
              <Link key={slug} href={`/dispatch/${slug}`}>
                {label}
              </Link>
            ))}
          </div>
          <div>
            <h4>Dispatch by State</h4>
            <Link href="/truck-dispatch/new-jersey">New Jersey Truck Dispatch</Link>
            <Link href="/truck-dispatch/new-york">New York Truck Dispatch</Link>
            <Link href="/truck-dispatch/florida">Florida Truck Dispatch</Link>
            <Link href="/truck-dispatch/georgia">Georgia Truck Dispatch</Link>
            <Link href="/truck-dispatch/texas">Texas Truck Dispatch</Link>
            <Link href="/truck-dispatch/illinois">Illinois Truck Dispatch</Link>
            <Link href="/truck-dispatch">All 48 States →</Link>
          </div>
          <div>
            <h4>Carriers</h4>
            <Link href="/#quote">Become a Carrier</Link>
            <Link href="/#new-authority">Start Your Trucking Company</Link>
            <Link href="/#packet">Carrier Packet</Link>
            <Link href="/#packet">Insurance Requirements</Link>
            <Link href="/#packet">Factoring</Link>
            <Link href="/faq">Carrier FAQ</Link>
            <ComingSoonLink kind="Carrier">Carrier Login</ComingSoonLink>
          </div>
          <div>
            <h4>Company</h4>
            <Link href="/about">About Us</Link>
            <Link href="/shippers">For Shippers</Link>
            <Link href="/blog">Freight Insights</Link>
            <Link href="/faq">FAQ</Link>
            <Link href="/contact">Contact</Link>
            <ComingSoonLink kind="Shipper">Shipper Login</ComingSoonLink>
          </div>
        </div>
        <div className="foot-bottom">
          <span>
            © 2026 PickLoads Logistics Group LLC · pickloads.com · All rights
            reserved.
          </span>
          <span>
            <Link href="/legal/privacy">Privacy</Link> ·{" "}
            <Link href="/legal/terms">Terms</Link> ·{" "}
            <Link href="/legal/cookies">Cookies</Link> ·{" "}
            <Link href="/legal/carrier-agreement">Carrier Agreement</Link> ·{" "}
            <Link href="/legal/dispatch-agreement">Dispatch Agreement</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
