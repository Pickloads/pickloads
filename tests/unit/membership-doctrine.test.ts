import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M-57 — membership-architecture doctrine, pinned statically:
 * customer-portal pages must resolve "my company" through the membership
 * helpers (getMyCarrierId / getMyShipperId), never by filtering `carriers`
 * on `profile_id`. This keeps multi-user company accounts a pure data change
 * (insert a membership row) — no page rewrites.
 */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".tsx") || full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const PORTAL_DIRS = [
  "src/app/[locale]/portal/carrier",
  "src/app/[locale]/portal/shipper",
];

describe("customer portal pages use membership helpers (M-57)", () => {
  const files = PORTAL_DIRS.flatMap((d) => walk(d));

  it("finds the portal pages", () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  for (const file of files) {
    it(`${file} has no carriers/shippers profile_id lookup`, () => {
      const src = readFileSync(file, "utf8");
      // A `.from("carriers")`/`.from("shippers")` query in the same file as a
      // `.eq("profile_id", …)` filter is the forbidden legacy pattern.
      const queriesCompanies =
        src.includes('from("carriers")') || src.includes('from("shippers")');
      const filtersProfile = /\.eq\(\s*["']profile_id["']/.test(src);
      const usesCompanyProfileFilter =
        queriesCompanies &&
        filtersProfile &&
        // Allowed: person-scoped tables (notifications/preferences/threads)
        // legitimately filter profile_id — flag only files where a company
        // query has NO membership-helper resolution.
        !/getMyCarrierId|getMyShipperId|getShipperQuotes/.test(src);
      expect(
        usesCompanyProfileFilter,
        `${file} queries carriers/shippers without the membership helpers`,
      ).toBe(false);
    });
  }
});
