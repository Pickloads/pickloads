import { describe, expect, it } from "vitest";

import {
  buildPublicIndex,
  searchPublic,
  type SearchDoc,
} from "@/lib/search/public-index";
import { NAV_GROUPS, FOOTER_COLUMNS } from "@/lib/site-nav";

/**
 * Search is where an authorization bypass usually arrives, so most of this
 * file is about what the index CANNOT contain.
 *
 * The design makes that structural — the index derives from the same sources
 * as the sitemap and queries nothing — but a structural property is only worth
 * anything if something checks it still holds after the next edit.
 */

const INDEX: SearchDoc[] = buildPublicIndex();
const ALL_TEXT = JSON.stringify(INDEX).toLowerCase();

describe("the index contains nothing private", () => {
  const FORBIDDEN: Array<[label: string, pattern: RegExp]> = [
    ["an admin portal route", /\/portal\/admin/],
    ["a dispatcher route", /\/portal\/dispatcher/],
    ["any portal route at all", /\/portal\//],
    // Exact segment, not prefix. `\b` matches before a hyphen, so the first
    // version of this flagged `/login-center` — which is a legitimate PUBLIC
    // page, is in PUBLIC_ROUTES, and is exactly what someone searching "sign
    // in" should find. What must stay out is the functional auth ENDPOINTS.
    ["an auth endpoint", /\/(login|create-account|invite)("|\/)/],
    ["a storage or signed URL", /storage|createsignedurl|supabase\.co|token=/],
    ["an API route", /\/api\//],
    ["a tracking number", /pl-\d{4}-\d{6}/],
    ["a document file", /\.(pdf|docx?|xlsx?)/],
  ];

  for (const [label, pattern] of FORBIDDEN) {
    it(`contains no ${label}`, () => {
      expect(ALL_TEXT).not.toMatch(pattern);
    });
  }

  it("NON-VACUITY: the sweep WOULD catch a leaked private entry", () => {
    const leaked = JSON.stringify([
      { title: "Admin", href: "/portal/admin/shipments" },
    ]).toLowerCase();
    expect(FORBIDDEN.some(([, p]) => p.test(leaked))).toBe(true);
  });

  it("and the index is not empty — not vacuous by absence", () => {
    expect(INDEX.length).toBeGreaterThan(20);
  });
});

describe("every indexed destination is a real public page", () => {
  it("every href is locale-relative and public", () => {
    for (const doc of INDEX) {
      expect(doc.href.startsWith("/"), `${doc.href} is not relative`).toBe(true);
      expect(doc.href).not.toMatch(/^https?:/);
    }
  });

  it("indexes no destination the navigation still marks as unbuilt", () => {
    // `ships: false` means the page does not exist. Search must not be the
    // one surface that links to it anyway.
    const unbuilt = [
      ...NAV_GROUPS.flatMap((g) => g.entries),
      ...FOOTER_COLUMNS.flatMap((c) => c.entries),
    ]
      .filter((e) => !e.ships)
      .map((e) => e.href);

    for (const href of unbuilt) {
      expect(
        INDEX.some((d) => d.href.split("?")[0] === href),
        `search indexes unbuilt route ${href}`,
      ).toBe(false);
    }
  });

  it("covers the destinations a visitor would actually search for", () => {
    const hrefs = INDEX.map((d) => d.href);
    for (const expected of [
      "/dispatch-services",
      "/request-a-quote",
      "/track",
      "/knowledge-base",
      "/become-a-carrier",
      "/shippers",
    ]) {
      expect(hrefs, `missing ${expected}`).toContain(expected);
    }
  });
});

describe("scoring behaves the way a person expects", () => {
  it("finds a service by name", () => {
    const hits = searchPublic("dispatch services");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.href).toBe("/dispatch-services");
  });

  it("finds equipment by slug word", () => {
    const hits = searchPublic("reefer");
    expect(hits.some((h) => h.href === "/dispatch/reefer")).toBe(true);
  });

  it("finds an answer from the FAQ body", () => {
    const hits = searchPublic("forced dispatch");
    expect(hits.some((h) => h.type === "Answer")).toBe(true);
  });

  it("ranks a title match above a body-only match", () => {
    const hits = searchPublic("track");
    expect(hits[0]!.title.toLowerCase()).toContain("track");
  });

  it("narrows on a second term rather than widening", () => {
    const one = searchPublic("dispatch");
    const two = searchPublic("dispatch reefer");
    expect(two.length).toBeLessThan(one.length);
  });

  it("returns nothing for an empty or one-character query", () => {
    expect(searchPublic("")).toEqual([]);
    expect(searchPublic("   ")).toEqual([]);
    expect(searchPublic("a")).toEqual([]);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchPublic("zzzznotathing")).toEqual([]);
  });

  it("cannot be used to fish for private records", () => {
    for (const probe of [
      "PL-2026-000101",
      "admin",
      "dispatcher",
      "invoice",
      "proof of delivery",
      "w-9",
    ]) {
      for (const hit of searchPublic(probe)) {
        expect(hit.href).not.toMatch(/\/portal\//);
        expect(hit.href).not.toMatch(/\/api\//);
      }
    }
  });
});
