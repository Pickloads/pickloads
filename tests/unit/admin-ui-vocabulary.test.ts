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
  "src/components/portal/admin-ui.tsx",
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

  /**
   * M-100 retired four of M-99's classes — `.preview-form`, `.preasons`,
   * `.pbar-actions` and `.pgap-sm` — when the design system absorbed what
   * they did. This test caught them the moment they went unused, so the RULES
   * were deleted from `portal.css` rather than the assertion being relaxed.
   * That is §24 working as intended: the list is the inventory, and anything
   * that falls off it is dead code, not a failing test.
   */
  const INTRODUCED = [
    "pdl",
    "phelp",
    "pbadges",
    "pactions",
    "ppager",
    "pcount",
    "pgap",
    "plede",
    "pside-head",
    "tact",
    "treason",
    "nw",
    "flush",
    // M-100 — the admin design system. Same guarantee: every class it
    // introduces must be defined in the stylesheet AND actually reach markup,
    // so the system cannot rot into a set of rules nothing uses.
    "a-page",
    "a-head",
    "a-crumb",
    "a-desc",
    "a-ids",
    "a-grid",
    "a-col",
    "a-card",
    "a-card-head",
    "a-card-body",
    "dlist",
    "drow",
    "dsub",
    "dgroup",
    "a-badge",
    "a-badges",
    "a-reasons",
    "a-code",
    "a-callout",
    "a-note",
    "a-state",
    "a-actions",
    "a-field",
    "a-hint",
    "a-empty",
    "a-sublabel",
    "tid",
    "psubhead",
    "stacked",
    "wrap",
  ];

  // Every class token that actually appears in the cleaned markup.
  //
  // Two forms reach the DOM and both have to be read, or a class that is only
  // ever applied through a tone/variant expression reads as dead:
  //   className="a-card"                       — a plain attribute
  //   className={`a-badge is-${tone}`}         — a template literal
  //   className={x ? "a-callout is-inset" : "a-callout"}
  // Interpolations are stripped, so `is-${tone}` contributes "is-" and never
  // a token that could make a missing class look present.
  const used = new Set<string>();
  // Interpolations are stripped FIRST, for two reasons: `is-${tone}` must not
  // contribute a token that could make a missing class look present, and the
  // `}` inside `${tone}` would otherwise terminate the className={...} match
  // early and hide every class in a template literal.
  const flat = markup.replace(/\$\{[^}]*\}/g, " ");
  const addTokens = (raw: string) => {
    for (const t of raw.split(/\s+/)) if (t) used.add(t);
  };
  for (const m of flat.matchAll(/class[Nn]ame="([^"]*)"/g)) {
    addTokens(m[1] ?? "");
  }
  for (const m of flat.matchAll(/class[Nn]ame=\{([^}]*)\}/g)) {
    for (const lit of (m[1] ?? "").matchAll(/"([^"]*)"|`([^`]*)`/g)) {
      addTokens(lit[1] ?? lit[2] ?? "");
    }
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
