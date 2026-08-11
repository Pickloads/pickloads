import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  SECTION_27_FLOWS,
  SECTION_27_INTEGRATION,
  SECTION_27_RESPONSIVE,
  SECTION_27_RESPONSIVE_SURFACES,
  SECTION_27_UNIT,
  SECTION_27_VIEWPORTS,
  type CoverageBinding,
} from "../support/section-27-catalogue";

/**
 * M-84 — the §27 coverage index, verified.
 *
 * `tests/support/section-27-catalogue.ts` claims that each of §27's named
 * requirements is honoured by a specific test in a specific file. This file
 * proves those claims still hold, so the index cannot quietly become fiction
 * while every lane stays green.
 *
 * ── WHAT IS PROVED, IN ORDER OF STRENGTH ──────────────────────────────────
 *
 *   1. SHAPE — the index names exactly the counts §27 names: 8 unit tests,
 *      11 integration tests, 5 flows totalling 31 steps, 6 responsive
 *      surfaces × 5 viewports. Dropping a requirement fails here, which is
 *      the failure a hand-maintained table makes impossible to notice.
 *   2. RESOLUTION — every binding's file exists and contains a test declared
 *      with exactly that title. A rename or a deletion fails with the
 *      requirement it was covering named in the message.
 *   3. NON-VACUITY — the extractor and the matcher are shown to be capable of
 *      failing, by running them against a title that does not exist, a file
 *      that does not exist, and a title that appears in the file only as
 *      prose. Without this, a broken extractor that returned every string in
 *      the file would make the whole suite pass and prove nothing.
 *
 * ── WHAT IS NOT PROVED, SAID PLAINLY ──────────────────────────────────────
 *
 * That the bound tests are CORRECT, or that they execute in CI. The first is
 * the job of the tests themselves (each carries its own injection control or
 * sentinel sweep); the second is the job of the module gate, which runs all
 * four lanes. This file proves the index is honest about what exists.
 */

const TEST_DECLARATION =
  /(?:^|\n)\s*(?:it|test)(?:\.\w+)*\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
const DESCRIBE_DECLARATION =
  /(?:^|\n)\s*describe(?:\.\w+)*\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

const fileCache = new Map<string, string>();

function read(file: string): string {
  const cached = fileCache.get(file);
  if (cached !== undefined) return cached;
  const text = readFileSync(file, "utf8");
  fileCache.set(file, text);
  return text;
}

/**
 * Every title declared in a file, as a Set.
 *
 * Deliberately NOT a substring search over the file. A title that happened to
 * appear inside a comment — and these files are heavily commented, often
 * quoting the very tests they describe — would satisfy a substring check while
 * the test itself had been deleted. Only strings in the FIRST argument
 * position of an `it` / `test` / `describe` call count.
 */
export function declaredTitles(file: string): Set<string> {
  const source = read(file);
  const titles = new Set<string>();
  for (const pattern of [TEST_DECLARATION, DESCRIBE_DECLARATION]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = pattern.exec(source);
    while (match !== null) {
      titles.add(match[2] as string);
      match = pattern.exec(source);
    }
  }
  return titles;
}

function assertResolves(binding: CoverageBinding): void {
  const titles = declaredTitles(binding.file);
  expect(
    titles.has(binding.title),
    `§27 "${binding.requirement}" claims ${binding.file} declares a test titled\n` +
      `  ${binding.title}\n` +
      `…and it does not. Either the test was renamed (update the catalogue) or ` +
      `the coverage was lost (that is the finding).`,
  ).toBe(true);
}

/* ================================================================== *
 * 1 · Shape — the index names what §27 names
 * ================================================================== */

describe("§27 coverage index — shape", () => {
  it("names all EIGHT unit tests §27 lists", () => {
    expect(SECTION_27_UNIT).toHaveLength(8);
    expect(SECTION_27_UNIT.map((b) => b.requirement)).toEqual([
      "tracking-number generation",
      "public DTO serializer",
      "status transitions",
      "ETA formatting",
      "event visibility",
      "permission helpers",
      "access-code verification",
      "notification deduplication",
    ]);
  });

  it("names all ELEVEN integration tests §27 lists", () => {
    expect(SECTION_27_INTEGRATION).toHaveLength(11);
    expect(SECTION_27_INTEGRATION.map((b) => b.requirement)).toEqual([
      "create shipment",
      "assign carrier",
      "create shipment event",
      "update status",
      "public tracking lookup",
      "shipper portal lookup",
      "carrier update",
      "document upload",
      "POD upload",
      "notification generation",
      "exception creation and resolution",
    ]);
  });

  it("names all FIVE flows and every one of their thirty-one steps", () => {
    expect(SECTION_27_FLOWS.map((f) => f.flow)).toEqual([
      "Shipper flow",
      "Public tracking flow",
      "Dispatcher flow",
      "Carrier flow",
      "Security flow",
    ]);
    const stepCounts = SECTION_27_FLOWS.map((f) => f.steps.length);
    expect(stepCounts).toEqual([6, 4, 8, 7, 6]);
    expect(stepCounts.reduce((a, b) => a + b, 0)).toBe(31);
  });

  it("names §27's six responsive surfaces and five viewports", () => {
    expect(SECTION_27_RESPONSIVE_SURFACES).toHaveLength(6);
    expect(SECTION_27_RESPONSIVE_SURFACES.map((s) => s.surface)).toEqual([
      "public /track",
      "authenticated shipment list",
      "shipment detail",
      "dispatcher board",
      "status-update form",
      "mobile timeline",
    ]);
    expect(SECTION_27_VIEWPORTS).toEqual([
      { width: 375, height: 812 },
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
    ]);
  });

  it("declares a caveat wherever the proof is narrower than the sentence", () => {
    // Not "every binding has a caveat" — most do not need one. What is
    // asserted is that the caveats present are real prose and not placeholders,
    // because an empty-string caveat would read as "no caveat" in the docs.
    const all: CoverageBinding[] = [
      ...SECTION_27_UNIT,
      ...SECTION_27_INTEGRATION,
      ...SECTION_27_FLOWS.flatMap((f) => f.steps),
      SECTION_27_RESPONSIVE,
    ];
    for (const binding of all) {
      if (binding.caveat === undefined) continue;
      expect(
        binding.caveat.trim().length,
        `${binding.requirement}: an empty caveat is worse than none`,
      ).toBeGreaterThan(30);
    }
    // And at least some exist — an index with no caveats at all would mean
    // somebody stopped writing them, not that the coverage became perfect.
    expect(all.filter((b) => b.caveat !== undefined).length).toBeGreaterThan(4);
  });
});

/* ================================================================== *
 * 2 · Resolution — every binding points at a test that exists
 * ================================================================== */

describe("§27 coverage index — every binding resolves", () => {
  for (const binding of SECTION_27_UNIT) {
    it(`unit · ${binding.requirement}`, () => assertResolves(binding));
  }

  for (const binding of SECTION_27_INTEGRATION) {
    it(`integration · ${binding.requirement}`, () => assertResolves(binding));
  }

  for (const flow of SECTION_27_FLOWS) {
    for (const step of flow.steps) {
      it(`${flow.flow} · ${step.requirement}`, () => assertResolves(step));
    }
  }

  it("responsive · the harness guard", () => {
    assertResolves(SECTION_27_RESPONSIVE);
  });

  it("responsive · every named surface's fixtures are still emitted", () => {
    // The generated per-fixture tests cannot be bound by title, so the binding
    // is by FIXTURE ID against the spec's own list. A fixture deleted from
    // `FIXTURES` shrinks the matrix without failing anything in M-82's suite;
    // it fails here, named by the §27 surface that depended on it.
    const spec = read(SECTION_27_RESPONSIVE.file);
    const block = /const FIXTURES = \[([\s\S]*?)\] as const;/.exec(spec);
    expect(block, "FIXTURES list not found — the spec was restructured").not.toBeNull();
    const declared = new Set(
      [...(block?.[1] ?? "").matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]),
    );
    expect(declared.size).toBeGreaterThan(20);
    for (const surface of SECTION_27_RESPONSIVE_SURFACES) {
      for (const fixture of surface.fixtures) {
        expect(
          declared.has(fixture),
          `§27 surface "${surface.surface}" is measured as fixture "${fixture}", ` +
            `which ${SECTION_27_RESPONSIVE.file} no longer emits`,
        ).toBe(true);
      }
    }
  });

  it("responsive · the twelve measured widths cover §27's five viewports", () => {
    const spec = read(SECTION_27_RESPONSIVE.file);
    const block = /const BREAKPOINTS = \[([\s\S]*?)\] as const;/.exec(spec);
    const widths = new Set(
      [...(block?.[1] ?? "").matchAll(/\d+/g)].map((m) => Number(m[0])),
    );
    for (const viewport of SECTION_27_VIEWPORTS) {
      expect(
        widths.has(viewport.width),
        `§27 names ${viewport.width}×${viewport.height}; the suite no longer ` +
          `measures ${viewport.width}px`,
      ).toBe(true);
    }
  });
});

/* ================================================================== *
 * 3 · Non-vacuity — the matcher can fail
 * ================================================================== */

describe("§27 coverage index — NON-VACUITY of the checker itself", () => {
  const REAL_FILE = "tests/unit/shipment-dto.test.ts";

  it("rejects a title that is not declared anywhere in the file", () => {
    expect(() =>
      assertResolves({
        requirement: "a requirement nobody covers",
        file: REAL_FILE,
        title: "this test has never existed and never will",
      }),
    ).toThrow();
  });

  it("rejects a file that does not exist", () => {
    expect(() =>
      assertResolves({
        requirement: "a requirement in a deleted file",
        file: "tests/unit/this-file-was-deleted.test.ts",
        title: "anything",
      }),
    ).toThrow();
  });

  it("does NOT count a title that appears only in prose or a comment", () => {
    // The trap this file exists to avoid. These suites quote their own test
    // names in their header comments; a substring search would find the quote
    // and report coverage for a test that had been deleted.
    const source = readFileSync(REAL_FILE, "utf8");
    const titles = declaredTitles(REAL_FILE);
    const commentOnly = "ANTI-VACUITY";
    // The phrase IS in the file…
    expect(source).toContain(commentOnly);
    // …but is not, by itself, a declared title.
    expect(titles.has(commentOnly)).toBe(false);
  });

  it("extracts a plausible NUMBER of titles — an empty or total set is a bug", () => {
    const titles = declaredTitles(REAL_FILE);
    expect(titles.size).toBeGreaterThan(10);
    // A matcher that returned every string literal in the file would return
    // hundreds; this file's assertion messages alone would exceed the count.
    const literals = (readFileSync(REAL_FILE, "utf8").match(/"[^"\n]{4,}"/g) ?? [])
      .length;
    expect(titles.size).toBeLessThan(literals);
  });
});
