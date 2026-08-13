import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  allCallSites,
  literalCallSites,
  metadataLiterals,
  dataModuleLabels,
  missingKeys,
  slugifyV4,
} from "../../scripts/v4-key-audit.mjs";

/**
 * M-90 — the test that would have caught the bug the language selector was
 * blamed for.
 *
 * ── THE FAILURE ──────────────────────────────────────────────────────────
 *
 * The selector worked. The routing worked. `fr.json` and `es.json` were
 * essentially complete. And a quarter of the site still rendered English in
 * every locale, because `useV4()` does this:
 *
 *     return t.has(key) ? t(key) : en;
 *
 * A string the catalogue has never heard of falls back to its English literal.
 * That is the right behaviour — the alternative is rendering a raw slug at a
 * customer — but it is SILENT. Adding a `tv("Continue to Documents →")` to a
 * component ships a perfect English page and a permanently English French one,
 * with no warning, no console message, and nothing an English-speaking
 * reviewer could see. 260 strings had accumulated that way.
 *
 * The catalogue-completeness tests that already existed could not see it:
 * they compare `fr.json` against `en.json`, and the missing strings were in
 * NEITHER. You cannot measure a gap between two files when the thing you lost
 * is in a third place — the source.
 *
 * So this test compares the SOURCE against the catalogue. It is the only
 * direction that catches a string the catalogue has never been told about.
 *
 * ── WHY IT IMPORTS THE SCRIPT ────────────────────────────────────────────
 *
 * `scripts/v4-key-audit.mjs` is the tool that repairs the gap; this is the
 * test that proves it stays closed. Sharing the collector means the check and
 * the fix cannot disagree about what a call site is — if they were reimplemented
 * separately, the day they drift is the day this test starts passing for the
 * wrong reason.
 */

const catalogue = () =>
  JSON.parse(readFileSync("messages/en.json", "utf8")) as {
    v4: Record<string, string>;
  };

describe("i18n key coverage — every translatable string has a key", () => {
  it("no tv() call site is missing from messages/en.json", () => {
    const missing = missingKeys(process.cwd()) as Array<{
      key: string;
      literal: string;
      files: string[];
    }>;
    expect(
      missing.map((m) => `${m.key} :: ${m.literal} (${m.files[0]})`),
      "These strings render their English literal in EVERY locale. Run " +
        "`node scripts/v4-key-audit.mjs --write`, then translate the new keys " +
        "in messages/{fr,es,ht,ru}.json.",
    ).toEqual([]);
  });

  it("every page title and description resolves through the catalogue", () => {
    // Metadata is the half of the fix that has no visible symptom: a French
    // page with an English <title> looks fine to everyone except the search
    // engine and the person who pasted the link into WhatsApp.
    const v4 = catalogue().v4;
    const missing = [...metadataLiterals(process.cwd()).keys()].filter(
      (lit) => !(slugifyV4(lit as string) in v4),
    );
    expect(missing).toEqual([]);
  });

  it("navigation labels come from the catalogue, not just from site-nav.ts", () => {
    // The regression that hid the longest. `tv(group.label)` puts the string
    // and the call in different files, so a source scan for `tv("…")` finds
    // nothing and the entire main menu renders English in all five locales.
    const v4 = catalogue().v4;
    const labels = [...dataModuleLabels(process.cwd()).keys()] as string[];
    expect(labels.length).toBeGreaterThan(20);
    expect(labels.filter((l) => !(slugifyV4(l) in v4))).toEqual([]);
  });

  it("NON-VACUITY — the collector actually finds the site's strings", () => {
    // If a refactor broke the regex, every assertion above would pass on an
    // empty set. Pin the shape: hundreds of literals, and specific strings
    // known to live in each of the three collection classes.
    const literals = [...literalCallSites(process.cwd()).keys()] as string[];
    const all = [...allCallSites(process.cwd()).keys()] as string[];
    expect(literals.length).toBeGreaterThan(700);
    expect(all.length).toBeGreaterThan(literals.length);
    expect(literals).toContain("Continue to Documents →");
    expect([...dataModuleLabels(process.cwd()).keys()]).toContain(
      "New Authority Program",
    );
    expect([...metadataLiterals(process.cwd()).keys()]).toContain(
      "Careers — PickLoads Logistics Group",
    );
  });

  it("the slugifier here matches the one the app runs", () => {
    // These two implementations MUST agree or the audit checks keys the
    // runtime never asks for. Sampled against the real bridge's behaviour.
    expect(slugifyV4("Continue to Documents →")).toBe("continue_to_documents");
    expect(slugifyV4("Box Truck & Hot Shot")).toBe("box_truck_hot_shot");
    expect(slugifyV4("Retail &amp; E-commerce")).toBe("retail_and_e_commerce");
    expect(slugifyV4("<b>bold</b> text")).toBe("bold_text");
    expect(slugifyV4("…")).toBe("s");
  });
});

describe("i18n catalogues — structure", () => {
  const LOCALES = ["fr", "es", "ht", "ru"] as const;

  it("every locale carries exactly the English key set, in the same order", () => {
    const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
    const enKeys = Object.keys(en.v4);
    for (const locale of LOCALES) {
      const cat = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
      // Same SET: a missing key renders a raw slug to a customer.
      expect(
        enKeys.filter((k) => !(k in cat.v4)),
        `${locale}.json is missing keys`,
      ).toEqual([]);
      expect(
        Object.keys(cat.v4).filter((k) => !(k in en.v4)),
        `${locale}.json has keys English does not`,
      ).toEqual([]);
      // Same ORDER: keeps the five files diffable side by side, which is how
      // a translator reviews them.
      expect(Object.keys(cat.v4), `${locale}.json key order`).toEqual(enKeys);
    }
  });

  it("no catalogue value is empty or whitespace", () => {
    for (const locale of ["en", ...LOCALES]) {
      const cat = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
      const blank = Object.entries(cat.v4 as Record<string, string>)
        .filter(([, v]) => typeof v !== "string" || v.trim() === "")
        .map(([k]) => k);
      expect(blank, `${locale}.json has blank values`).toEqual([]);
    }
  });
});
