/**
 * The public site's information architecture — ONE definition, used by the
 * navigation, the footer and the link-integrity test.
 *
 * WHY A DATA MODEL RATHER THAN JSX. Before this, the desktop bar, the mobile
 * drawer and the footer each hard-coded their own link lists. Three lists mean
 * three chances for a destination to be renamed in two of them, and no way to
 * assert anything about the set as a whole. Here the IA is data, so
 * `tests/unit/site-nav.test.ts` can prove the property that actually matters:
 * **every link points at a route that exists.**
 *
 * ── THE `ships` FIELD, AND WHY IT IS NOT A FEATURE FLAG ──────────────────
 *
 * The approved IA names destinations that are scheduled but not yet built:
 * Carrier Resources, Knowledge Base, Downloads Center, Careers, Partners. They
 * are declared here with `ships: false` so the target architecture is visible
 * in one place — and they are NOT RENDERED. A navigation entry pointing at a
 * 404 is worse than a missing entry: it advertises a capability the business
 * does not have, which is the same failure as a fake statistic.
 *
 * When a phase delivers one of those pages it flips one boolean. Nothing else
 * moves.
 *
 * ── LOGIN POSTURE (approved) ─────────────────────────────────────────────
 *
 * Customer-facing doors only: shipper, carrier, broker partner. Dispatcher and
 * admin are NOT public entries — staff use the same `/login` and the server
 * decides where they land (M-54). A "Staff sign-in" link exists exactly once,
 * low-emphasis, in the footer's Support column. Advertising the existence of
 * internal portals buys an attacker reconnaissance and buys a customer
 * nothing.
 */

/** A single destination. `href` is locale-relative; `Link` adds the prefix. */
export interface NavEntry {
  /** V4 dictionary key. Never a raw user-facing string. */
  label: string;
  href: string;
  /**
   * False → declared but not built. Never rendered. See the note above.
   */
  ships: boolean;
  /**
   * True → the label changes while `company_settings.brokerage_active` is
   * false. Only the label: the link itself stays live, because `/shippers`
   * is a real page in both states (M-69 / P-3 doctrine).
   */
  brokerageGated?: boolean;
}

export interface NavGroup {
  label: string;
  /** The group header is itself a destination — never a dead trigger. */
  href: string;
  entries: readonly NavEntry[];
}

/**
 * The five approved groups. Each header links somewhere real, so the nav is
 * fully usable with a keyboard and without JavaScript: the panel is an
 * enhancement, not the only way through.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Services",
    href: "/dispatch-services",
    entries: [
      { label: "Dispatch Services", href: "/dispatch-services", ships: true },
      {
        label: "Freight Brokerage",
        href: "/shippers",
        ships: true,
        brokerageGated: true,
      },
      {
        label: "New Authority Program",
        href: "/start-your-trucking-company",
        ships: true,
      },
    ],
  },
  {
    label: "Carriers",
    href: "/become-a-carrier",
    entries: [
      { label: "Become a Carrier", href: "/become-a-carrier", ships: true },
      // Scheduled. Not rendered until the page exists.
      { label: "Carrier Resources", href: "/carrier-resources", ships: true },
      { label: "Carrier Login", href: "/portal", ships: true },
    ],
  },
  {
    label: "Shippers",
    href: "/shippers",
    entries: [
      { label: "Request a Quote", href: "/request-a-quote", ships: true },
      { label: "Track Shipment", href: "/track", ships: true },
      { label: "Client Login", href: "/portal", ships: true },
    ],
  },
  {
    label: "Resources",
    href: "/blog",
    entries: [
      { label: "Blog", href: "/blog", ships: true },
      { label: "FAQ", href: "/faq", ships: true },
      { label: "Knowledge Base", href: "/knowledge-base", ships: true },
      { label: "Downloads", href: "/downloads", ships: true },
    ],
  },
  {
    label: "Company",
    href: "/about",
    entries: [
      { label: "About Us", href: "/about", ships: true },
      { label: "Contact", href: "/contact", ships: true },
      { label: "Careers", href: "/careers", ships: true },
      { label: "Partners", href: "/partners", ships: true },
    ],
  },
] as const;

/**
 * Utility entries — present in the bar beside the groups.
 *
 * Tracking is here rather than in the CTA slot on purpose: §20 treats it as an
 * ACTION for an existing customer, not an acquisition call. Putting it where
 * the primary CTA goes would tell a first-time visitor that the main thing
 * this company offers is a lookup box.
 */
export const NAV_UTILITIES: readonly NavEntry[] = [
  { label: "Track Shipment", href: "/track", ships: true },
  { label: "Login", href: "/login-center", ships: true },
] as const;

/**
 * Primary call to action.
 *
 * It used to point at `/#quote` — which is the home page's CARRIER setup form
 * (truck type, trailer, home state, truck count), not a freight quote. A
 * shipper following the site's single loudest call to action landed on a form
 * asking how many trucks they own. It now points at the dedicated page.
 */
export const PRIMARY_CTA: NavEntry = {
  label: "Request a Quote",
  href: "/request-a-quote",
  ships: true,
};

/**
 * Secondary, carrier-side.
 *
 * Points at `/become-a-carrier`, which hosts the real `CarrierWizard` —
 * company info, documents, agreement, portal. Not at the marketing hub: a
 * call to action labelled "Start Dispatching" that lands on another marketing
 * page has not started anything.
 */
export const SECONDARY_CTA: NavEntry = {
  label: "Start Dispatching",
  href: "/become-a-carrier",
  ships: true,
};

/**
 * The footer's seven columns.
 *
 * `Support` carries the single low-emphasis staff entry. `Legal` links the
 * shells: they are real pages that state their own status honestly, and
 * linking them is how a visitor discovers the policy exists at all — the
 * pages are `noindex` until counsel delivers text.
 */
export const FOOTER_COLUMNS: readonly NavGroup[] = [
  {
    label: "Services",
    href: "/dispatch-services",
    entries: [
      { label: "Dispatch Services", href: "/dispatch-services", ships: true },
      {
        label: "Freight Brokerage",
        href: "/shippers",
        ships: true,
        brokerageGated: true,
      },
      {
        label: "New Authority Program",
        href: "/start-your-trucking-company",
        ships: true,
      },
    ],
  },
  {
    label: "Carriers",
    href: "/become-a-carrier",
    entries: [
      { label: "Become a Carrier", href: "/become-a-carrier", ships: true },
      { label: "Start Dispatching", href: "/become-a-carrier", ships: true },
      { label: "Carrier Login", href: "/portal", ships: true },
      { label: "Carrier Resources", href: "/carrier-resources", ships: true },
    ],
  },
  {
    label: "Shippers",
    href: "/shippers",
    entries: [
      { label: "Request a Quote", href: "/request-a-quote", ships: true },
      { label: "Track Shipment", href: "/track", ships: true },
      { label: "Client Login", href: "/portal", ships: true },
    ],
  },
  {
    label: "Resources",
    href: "/blog",
    entries: [
      { label: "Blog", href: "/blog", ships: true },
      { label: "FAQ", href: "/faq", ships: true },
      { label: "Knowledge Base", href: "/knowledge-base", ships: true },
      { label: "Downloads", href: "/downloads", ships: true },
    ],
  },
  {
    label: "Company",
    href: "/about",
    entries: [
      { label: "About Us", href: "/about", ships: true },
      { label: "Contact", href: "/contact", ships: true },
      { label: "Careers", href: "/careers", ships: true },
      { label: "Partners", href: "/partners", ships: true },
    ],
  },
  {
    label: "Support",
    href: "/contact",
    entries: [
      { label: "Contact", href: "/contact", ships: true },
      { label: "FAQ", href: "/faq", ships: true },
      { label: "Track Shipment", href: "/track", ships: true },
      // The one internal entry, deliberately last and unstyled as a feature.
      { label: "Staff sign-in", href: "/login", ships: true },
    ],
  },
  {
    label: "Legal",
    href: "/legal/privacy",
    entries: [
      { label: "Privacy Policy", href: "/legal/privacy", ships: true },
      { label: "Terms of Service", href: "/legal/terms", ships: true },
      { label: "Cookie Policy", href: "/legal/cookies", ships: true },
      {
        label: "Carrier Agreement",
        href: "/legal/carrier-agreement",
        ships: true,
      },
      {
        label: "Dispatch Agreement",
        href: "/legal/dispatch-agreement",
        ships: true,
      },
    ],
  },
] as const;

/** Entries that render. The single place `ships` is honoured. */
export function liveEntries(entries: readonly NavEntry[]): NavEntry[] {
  return entries.filter((e) => e.ships);
}

/**
 * The label to render for an entry, given the brokerage gate.
 *
 * M-69 / P-3: while `brokerage_active` is false the site must not describe
 * PickLoads as operating brokerage authority. "For Shippers" is an existing
 * approved V4 string — no new marketing copy is invented, and the real label
 * returns the moment the flag flips.
 */
export function entryLabel(entry: NavEntry, brokerageActive: boolean): string {
  if (entry.brokerageGated && !brokerageActive) return "For Shippers";
  return entry.label;
}
