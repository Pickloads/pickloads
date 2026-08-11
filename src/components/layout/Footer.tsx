import { Link } from "@/i18n/navigation";
import { Logo } from "@/components/ui/Logo";
import { useV4 } from "@/i18n/v4";
import { entryLabel, FOOTER_COLUMNS, liveEntries } from "@/lib/site-nav";

/**
 * Phase B — the corporate footer.
 *
 * ── SEVEN COLUMNS, FROM THE SHARED IA ────────────────────────────────────
 *
 * Services · Carriers · Shippers · Resources · Company · Support · Legal, all
 * from `src/lib/site-nav.ts`. The footer and the nav can no longer disagree
 * about where a destination lives or what it is called, and
 * `tests/unit/site-nav.test.ts` proves every rendered href resolves.
 *
 * ── THE SEO ROWS ARE KEPT ────────────────────────────────────────────────
 *
 * Dispatch-by-equipment and dispatch-by-state are 13 internal links into real
 * pages that exist and rank. A "clean" redesign that dropped them would trade
 * measurable acquisition for tidiness. They sit below the seven columns as a
 * secondary row rather than competing with them.
 *
 * ── NOTHING HERE IS INVENTED ─────────────────────────────────────────────
 *
 * One address, one phone, one support mailbox — the approved company details,
 * unchanged. MC and USDOT render as **pending** because they are pending. No
 * office list, no carrier count, no awards, no certifications, no review
 * score. §58, and the honest-states discipline this project has kept since
 * M-00.
 *
 * ── THE STAFF ENTRY ──────────────────────────────────────────────────────
 *
 * Exactly one, last in the Support column, deliberately styled as the least
 * prominent link on the page (`.foot-staff`). Dispatcher and admin portals are
 * never named. Staff sign in through the same `/login` and the server decides
 * where they land — advertising internal portal paths buys an attacker
 * reconnaissance and buys a customer nothing.
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

export function Footer({
  brokerageActive = false,
}: {
  brokerageActive?: boolean;
}) {
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
        </div>

        <div className="foot-cols">
          {FOOTER_COLUMNS.map((column) => (
            <div className="foot-col" key={column.label}>
              <h4>{tv(column.label)}</h4>
              {liveEntries(column.entries).map((entry) => (
                <Link
                  key={`${column.label}-${entry.label}`}
                  href={entry.href}
                  className={
                    entry.label === "Staff sign-in" ? "foot-staff" : undefined
                  }
                >
                  {tv(entryLabel(entry, brokerageActive))}
                </Link>
              ))}
            </div>
          ))}
        </div>

        <div className="foot-bottom">
          <span>
            {tv(
              "© 2026 PickLoads Logistics Group LLC · pickloads.com · All rights reserved.",
            )}
          </span>
          <span>
            {tv(
              "Document filing assistance only — we are not a law firm and do not provide legal advice.",
            )}
          </span>
        </div>
      </div>
    </footer>
  );
}
