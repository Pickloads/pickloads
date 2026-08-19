import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * M-99 — the admin surface must express layout through the portal stylesheet,
 * not through inline style objects.
 *
 * CLAUDE.md already forbids raw hex in components. The wider problem this
 * module found is the same failure one level up: a class whose defaults suited
 * a different context, "fixed" at the call site with an inline override. Seven
 * copies of `style={{padding:0}}` on `.pempty` is not seven bugs, it is one
 * missing rule (`.pcard .pempty`). These tests keep the fix from eroding.
 */

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** The surfaces this module cleaned. Scope is deliberate — see the note on
 *  `.mono` below and the follow-up list in the module doc. */
const CLEANED = [
  "src/app/[locale]/portal/admin/page.tsx",
  "src/app/[locale]/portal/admin/users/page.tsx",
  "src/app/[locale]/portal/admin/mfa/page.tsx",
  "src/app/[locale]/portal/admin/carrier-verifications/page.tsx",
  "src/app/[locale]/portal/admin/carrier-verifications/[id]/page.tsx",
  "src/components/portal/CarrierVerificationQueueView.tsx",
  "src/components/portal/CarrierVerificationDetailView.tsx",
  "src/components/portal/CarrierReviewForm.tsx",
  "src/components/portal/PortalSidebar.tsx",
];

describe("M-99 · the cleaned admin surface carries no inline layout", () => {
  for (const file of CLEANED) {
    it(`${file} has no inline style object`, () => {
      expect(read(file)).not.toMatch(/style=\{\{/);
    });
  }

  it("no raw hex colour reaches a cleaned component (CLAUDE.md)", () => {
    for (const file of CLEANED) {
      // Allow hex inside a comment; forbid it in JSX/TS expressions.
      const code = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
      expect(code, file).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    }
  });
});

describe("M-99 · every class the cleanup introduced is real and used", () => {
  const css = read("src/app/portal.css");
  const markup = CLEANED.map(read).join("\n");

  const INTRODUCED = [
    "pdl",
    "phelp",
    "pbadges",
    "pbar-actions",
    "pactions",
    "preview-form",
    "preasons",
    "ppager",
    "pcount",
    "pgap",
    "plede",
    "pside-head",
    "tact",
    "treason",
    "nw",
    "flush",
    "psubhead",
    "pgap-sm",
    "stacked",
    "wrap",
  ];

  // Every class token that actually appears in the cleaned markup.
  const used = new Set<string>();
  for (const m of markup.matchAll(/class[Nn]ame="([^"]*)"/g)) {
    for (const t of (m[1] ?? "").split(/\s+/)) if (t) used.add(t);
  }
  // Every class token portal.css defines a rule for.
  const defined = new Set<string>();
  for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
    if (m[1]) defined.add(m[1]);
  }

  for (const cls of INTRODUCED) {
    it(`.${cls} is defined in portal.css and used in markup`, () => {
      expect(defined.has(cls), `.${cls} is used but never defined`).toBe(true);
      expect(used.has(cls), `.${cls} is defined but never used`).toBe(true);
    });
  }
});

describe("M-99 · known gap: `.mono` is applied everywhere and defined nowhere", () => {
  /**
   * `className="mono"` appears ~97 times across ~63 files and has no rule
   * outside `.pdl>dd.mono`. Every one of those elements renders in the body
   * face, which is why so many call sites bolt on an inline font-size beside
   * it. It is NOT fixed here: defining `.mono` globally would restyle public
   * marketing pages, and "the V4 prototype is FINAL — convert, never redesign"
   * makes that a separate, deliberate decision rather than a side effect of a
   * dashboard cleanup.
   *
   * This test pins the gap so it stays visible. When `.mono` is given a real
   * definition, this test fails — delete it then, and drop the note from
   * portal.css.
   */
  it("is still undefined, so the follow-up is still owed", () => {
    const css = read("src/app/portal.css") + read("src/app/globals.css");
    const standalone = css.match(/(^|[\s,}])\.mono[\s,{]/gm) ?? [];
    expect(
      standalone,
      "`.mono` now has a definition — remove this test and the portal.css note",
    ).toHaveLength(0);
  });
});
