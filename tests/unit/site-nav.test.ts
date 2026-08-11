import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  entryLabel,
  FOOTER_COLUMNS,
  liveEntries,
  NAV_GROUPS,
  NAV_UTILITIES,
  PRIMARY_CTA,
  SECONDARY_CTA,
  type NavEntry,
} from "@/lib/site-nav";

/**
 * Phase B — the site's information architecture, proved.
 *
 * The headline property: **no rendered link points at a route that does not
 * exist.** §63 forbids dead links in production, and a nav entry to a 404 is
 * worse than a missing one — it advertises a capability the business does not
 * have, which is the same class of dishonesty as a fabricated statistic.
 *
 * This runs against the REAL app directory, so adding a nav entry for an
 * unbuilt page fails here rather than in someone's browser.
 */

const APP_DIR = path.join(process.cwd(), "src", "app", "[locale]");
const SITE_DIR = path.join(APP_DIR, "(site)");

/** Every public route on disk, as locale-relative paths ("/", "/about", …). */
function routesOnDisk(): Set<string> {
  const found = new Set<string>();

  const walk = (dir: string, prefix: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (!statSync(full).isDirectory()) continue;
      // Route groups like "(site)" and "(auth)" do not appear in the URL.
      const segment = name.startsWith("(") && name.endsWith(")") ? "" : `/${name}`;
      const next = `${prefix}${segment}`;
      if (existsSync(path.join(full, "page.tsx"))) found.add(next === "" ? "/" : next);
      walk(full, next);
    }
  };

  walk(APP_DIR, "");
  if (existsSync(path.join(SITE_DIR, "page.tsx"))) found.add("/");
  return found;
}

const ROUTES = routesOnDisk();

/**
 * Does `href` resolve?
 *
 *   "/about"            → an exact route
 *   "/#quote"           → the home page plus an in-page anchor
 *   "/legal/privacy"    → matches the dynamic route "/legal/[doc]"
 */
function resolves(href: string): boolean {
  const [pathPart] = href.split("#");
  const target = pathPart === "" ? "/" : pathPart!;
  if (ROUTES.has(target)) return true;
  // Dynamic segment match: /legal/privacy against /legal/[doc].
  const parts = target.split("/").filter(Boolean);
  for (const route of ROUTES) {
    const rparts = route.split("/").filter(Boolean);
    // A CATCH-ALL IS NOT A DESTINATION. `[...rest]` is the branded 404
    // handler; counting it as a match makes every conceivable href "resolve"
    // and turns this whole file into a test that cannot fail. The non-vacuity
    // case caught exactly that.
    if (rparts.some((r) => r.startsWith("[..."))) continue;
    if (rparts.length !== parts.length) continue;
    if (rparts.every((r, i) => r.startsWith("[") || r === parts[i])) return true;
  }
  return false;
}

function allRendered(): NavEntry[] {
  return [
    ...NAV_GROUPS.flatMap((g) => [
      { label: g.label, href: g.href, ships: true },
      ...liveEntries(g.entries),
    ]),
    ...liveEntries(NAV_UTILITIES),
    ...FOOTER_COLUMNS.flatMap((c) => liveEntries(c.entries)),
    PRIMARY_CTA,
    SECONDARY_CTA,
  ];
}

describe("link integrity (§63 — no dead links)", () => {
  it("found the real app routes — the test is not vacuous", () => {
    expect(ROUTES.size).toBeGreaterThan(10);
    expect(ROUTES.has("/about")).toBe(true);
    expect(ROUTES.has("/track")).toBe(true);
  });

  for (const entry of allRendered()) {
    it(`"${entry.label}" → ${entry.href} resolves to a real route`, () => {
      expect(resolves(entry.href)).toBe(true);
    });
  }

  it("NON-VACUITY: a made-up destination does NOT resolve", () => {
    expect(resolves("/definitely-not-a-page")).toBe(false);
  });

  it("every group header is itself a destination, never a dead trigger", () => {
    for (const group of NAV_GROUPS) {
      expect(resolves(group.href), `${group.label} header`).toBe(true);
    }
  });
});

describe("unbuilt destinations are declared but never rendered", () => {
  const pending = [
    ...NAV_GROUPS.flatMap((g) => g.entries),
    ...FOOTER_COLUMNS.flatMap((c) => c.entries),
  ].filter((e) => !e.ships);

  it("the scheduled-but-unbuilt set is exactly what the gap audit lists", () => {
    const hrefs = [...new Set(pending.map((e) => e.href))].sort();
    // /knowledge-base left this list when its page shipped and its flag was
    // flipped. Pinning the set is the point: an entry cannot quietly become
    // visible, and one cannot quietly stay hidden after its page exists.
    expect(hrefs).toEqual([
      "/careers",
      "/carrier-resources",
      "/partners",
    ]);
  });

  it("none of them is rendered", () => {
    const rendered = new Set(allRendered().map((e) => e.href));
    for (const entry of pending) {
      expect(rendered.has(entry.href), `${entry.label} must not render`).toBe(
        false,
      );
    }
  });

  it("and none of them exists on disk yet — so the flags are honest", () => {
    for (const entry of pending) {
      expect(resolves(entry.href), `${entry.href}`).toBe(false);
    }
  });
});

describe("approved login posture", () => {
  const everyHref = [
    ...NAV_GROUPS.flatMap((g) => [g.href, ...g.entries.map((e) => e.href)]),
    ...NAV_UTILITIES.map((e) => e.href),
    ...FOOTER_COLUMNS.flatMap((c) => c.entries.map((e) => e.href)),
  ];

  it("exposes NO dispatcher or admin portal path anywhere in the public IA", () => {
    for (const href of everyHref) {
      expect(href).not.toContain("/portal/admin");
      expect(href).not.toContain("/portal/dispatcher");
    }
  });

  it("offers the three approved customer doors", () => {
    const labels = [
      ...NAV_GROUPS.flatMap((g) => g.entries.map((e) => e.label)),
      ...FOOTER_COLUMNS.flatMap((c) => c.entries.map((e) => e.label)),
    ];
    expect(labels).toContain("Carrier Login");
    expect(labels).toContain("Client Login");
  });

  it("carries exactly ONE staff entry, and it is in the footer", () => {
    const navStaff = [
      ...NAV_GROUPS.flatMap((g) => g.entries),
      ...NAV_UTILITIES,
    ].filter((e) => e.label.toLowerCase().includes("staff"));
    expect(navStaff).toHaveLength(0);

    const footStaff = FOOTER_COLUMNS.flatMap((c) => c.entries).filter((e) =>
      e.label.toLowerCase().includes("staff"),
    );
    expect(footStaff).toHaveLength(1);
    expect(footStaff[0]!.href).toBe("/login");
  });
});

describe("brokerage gate in the IA (§14, §57)", () => {
  it("relabels Freight Brokerage while the gate is closed — link untouched", () => {
    const entry = NAV_GROUPS.flatMap((g) => g.entries).find(
      (e) => e.brokerageGated,
    )!;
    expect(entry.href).toBe("/shippers");
    expect(entryLabel(entry, false)).toBe("For Shippers");
    expect(entryLabel(entry, true)).toBe("Freight Brokerage");
  });

  it("gates the footer entry the same way — one rule, both surfaces", () => {
    const entry = FOOTER_COLUMNS.flatMap((c) => c.entries).find(
      (e) => e.brokerageGated,
    )!;
    expect(entryLabel(entry, false)).toBe("For Shippers");
  });

  it("does not gate anything else — an over-broad gate hides real pages", () => {
    const gated = [
      ...NAV_GROUPS.flatMap((g) => g.entries),
      ...FOOTER_COLUMNS.flatMap((c) => c.entries),
    ].filter((e) => e.brokerageGated);
    expect(gated.every((e) => e.href === "/shippers")).toBe(true);
  });
});

describe("call-to-action hierarchy (§10, §20)", () => {
  it("the primary CTA is the quote, not tracking", () => {
    expect(PRIMARY_CTA.label).toBe("Request a Quote");
    expect(SECONDARY_CTA.label).toBe("Start Dispatching");
  });

  it("tracking is a utility entry, never the primary CTA", () => {
    expect(PRIMARY_CTA.href).not.toBe("/track");
    expect(SECONDARY_CTA.href).not.toBe("/track");
    expect(NAV_UTILITIES.some((e) => e.href === "/track")).toBe(true);
  });
});

describe("structure the certified responsive suite depends on", () => {
  it("renders five groups plus two utilities in the bar", () => {
    expect(NAV_GROUPS).toHaveLength(5);
    expect(liveEntries(NAV_UTILITIES)).toHaveLength(2);
  });

  it("the mobile drawer still offers at least eight destinations", () => {
    const drawer = new Set([
      ...NAV_GROUPS.flatMap((g) => liveEntries(g.entries).map((e) => e.href)),
      ...liveEntries(NAV_UTILITIES).map((e) => e.href),
      PRIMARY_CTA.href,
    ]);
    expect(drawer.size).toBeGreaterThanOrEqual(8);
  });

  it("the footer has the seven approved columns", () => {
    expect(FOOTER_COLUMNS.map((c) => c.label)).toEqual([
      "Services",
      "Carriers",
      "Shippers",
      "Resources",
      "Company",
      "Support",
      "Legal",
    ]);
  });
});
