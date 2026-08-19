import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * M-99 — the admin verification surfaces, measured in a real layout engine.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM THE JSDOM SUITE ──────────────────────
 *
 * `tests/unit/admin-verifications-a11y.test.tsx` proves the MARKUP: labels
 * bound to values, headings nested, axe clean, the right layout classes
 * present. It cannot prove any of the things this task was actually about,
 * because jsdom applies no stylesheet — a divider, a margin and an overflow
 * are all invisible there.
 *
 * So the same suite emits its rendered DOM as fixtures, and this file loads
 * them into Chromium behind the REAL compiled stylesheet (the one the running
 * server links, verified) at the same twelve widths M-82 established. The
 * markup is the shipped markup and the CSS is the shipped CSS. What it is NOT
 * is a running route: no server data, no hydration. The unit lane and the
 * route-level e2e cover those.
 *
 * These are the four regressions the polish was asked to guarantee:
 *   1. no horizontal overflow, at any width;
 *   2. no text sitting on a divider line;
 *   3. long values wrap instead of forcing the page wider;
 *   4. the review action row stays usable at mobile widths.
 */

const HARNESS_DIR = path.join(process.cwd(), "test-results", "tracking-harness");

/** M-82's twelve. Reused deliberately: one breakpoint list for the product. */
const BREAKPOINTS = [
  320, 360, 375, 390, 414, 480, 768, 820, 1024, 1280, 1440, 1920,
] as const;
/** The three arrangements the stylesheet produces. */
const AXE_WIDTHS = [320, 768, 1440] as const;
const HEIGHT = 900;

const FIXTURES = [
  "admin-verifications-queue",
  "admin-verifications-queue-empty",
  "admin-verifications-detail",
  "admin-verifications-detail-reviewed",
  // M-100.1 — the vocabulary the other 19 admin pages adopt through the
  // stylesheet. Those pages are async Server Components behind requireStaff,
  // so this specimen is the only way their layout gets measured at all.
  "admin-mapped-vocabulary",
  "admin-leads-board",
  "admin-security-log",
  "admin-security-log-empty",
] as const;

interface Stylesheets {
  global: string;
  portal: string;
  bodyClass: string;
}
let sheets: Stylesheets | null = null;

async function stylesheets(page: Page): Promise<Stylesheets> {
  if (sheets !== null) return sheets;
  const dir = path.join(process.cwd(), ".next", "static", "css");
  const files = readdirSync(dir).filter((f) => f.endsWith(".css"));
  let global: string | null = null;
  let portal: string | null = null;
  for (const file of files) {
    const css = readFileSync(path.join(dir, file), "utf8");
    if (css.includes(".pmain{")) portal = `/_next/static/css/${file}`;
    else if (css.includes(".track-result{")) global = `/_next/static/css/${file}`;
  }
  expect(portal, "no built stylesheet contains .pmain — rebuild").not.toBeNull();
  expect(global, "no built stylesheet contains .track-result").not.toBeNull();

  // The portal sheet must actually carry the M-99 vocabulary, or every
  // assertion below would pass against a stale build.
  const portalCss = readFileSync(
    path.join(process.cwd(), ".next", "static", "css", path.basename(portal!)),
    "utf8",
  );
  // A staleness guard, not a design assertion: if the built sheet predates the
  // design system every measurement below would pass against the old layout.
  expect(portalCss, "the built stylesheet predates .drow — rebuild").toContain(
    ".drow",
  );

  await page.goto("/track");
  const bodyClass = await page.evaluate(() => document.body.className);
  sheets = { global: global!, portal: portal!, bodyClass };
  return sheets;
}

function fixtureBody(id: string): string {
  const raw = readFileSync(path.join(HARNESS_DIR, `${id}.html`), "utf8");
  const match = /^<!--(\w+)-->\n([\s\S]*)$/.exec(raw);
  return match ? match[2]! : raw;
}

async function openFixture(page: Page, id: string): Promise<void> {
  const css = await stylesheets(page);
  const links = [css.global, css.portal]
    .map((href) => `<link rel="stylesheet" href="${href}">`)
    .join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${id}</title>${links}</head><body class="${css.bodyClass}">${fixtureBody(id)}</body></html>`;
  await page.route("**/__m99/**", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
  );
  await page.goto(`/__m99/${id}`);
  await page.waitForLoadState("load");
  await expect(page.locator("body"), `${id}: rendered empty`).not.toBeEmpty();
}

interface Probe {
  overflow: number;
  offenders: string[];
  onDivider: string[];
  overflowing: string[];
  smallTargets: string[];
}

/**
 * One evaluate, every prohibition.
 *
 * The divider check is the interesting one. A "divider" here is any element
 * drawing a top or bottom border; the violation is a TEXT box whose ink
 * overlaps that border line. Measuring the text rather than the element is
 * what distinguishes "the row has a border" (fine, always true) from "the
 * border runs through the words" (the reported defect).
 */
async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const sel = (el: Element): string => {
      const cls = (el.className || "").toString().trim().split(/\s+/).filter(Boolean);
      return `${el.tagName.toLowerCase()}${cls.length ? `.${cls.slice(0, 2).join(".")}` : ""}`;
    };
    const doc = document.documentElement;
    const overflow = Math.max(
      0,
      Math.max(doc.scrollWidth, document.body.scrollWidth) - window.innerWidth,
    );

    const offenders: string[] = [];
    const onDivider: string[] = [];
    const overflowing: string[] = [];
    const smallTargets: string[] = [];

    for (const el of document.querySelectorAll<HTMLElement>("*")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;

      // 1 · anything sticking out past the viewport
      if (r.right > window.innerWidth + 1) offenders.push(`${sel(el)} @${Math.round(r.right)}`);

      // 3 · a box whose own content is wider than it is AND spills visibly.
      //
      // `overflow:visible` only. `auto`/`scroll` is a deliberate scroller
      // (`.ptable-wrap` is one), and `hidden` is deliberate clipping — which
      // is exactly what `.sr-only` does: 1px box, 50px of text, on purpose.
      // Flagging those reported the accessibility helper as a layout bug.
      if (el.scrollWidth > el.clientWidth + 1 && cs.overflowX === "visible") {
        overflowing.push(`${sel(el)} ${el.scrollWidth}>${el.clientWidth}`);
      }

      // 4 · touch targets in the action row
      if (el.closest(".a-actions") && (el.tagName === "BUTTON" || el.tagName === "A")) {
        if (r.height < 24 || r.width < 24) {
          smallTargets.push(`${sel(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
    }

    // 2 · CLEARANCE between a horizontal rule and the text it bounds.
    //
    // The reported symptom was "text sitting directly on divider lines" —
    // which is usually not literal overstriking but zero breathing room: a
    // heading whose box starts exactly at its container's border, because the
    // container had `padding:0`. An earlier version of this checked for the
    // text ink CROSSING the line and therefore called that clean.
    //
    // So it measures the gap instead. Crossing is simply negative clearance,
    // so this subsumes the stricter test and also catches touching.
    //
    // Scope: BLOCK-level boxes only. An inline-block chip like `.pbadge` draws
    // a border 3px from its own label on purpose — that is a chip, not a rule,
    // and flagging it would report the badge design as a defect.
    const MIN_CLEARANCE = 4;
    const BLOCKISH = new Set([
      "block",
      "flex",
      "grid",
      "list-item",
      "table",
      "table-cell",
      "table-row",
      "flow-root",
    ]);
    for (const el of document.querySelectorAll<HTMLElement>("*")) {
      const cs = getComputedStyle(el);
      if (!BLOCKISH.has(cs.display)) continue;
      const hasTop =
        parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none";
      const hasBottom =
        parseFloat(cs.borderBottomWidth) > 0 && cs.borderBottomStyle !== "none";
      if (!hasTop && !hasBottom) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;

      // The text this box actually bounds — its own descendants.
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n.nodeValue ?? "").trim();
        if (text.length < 2) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const rect of range.getClientRects()) {
          if (rect.width < 2 || rect.height < 2) continue;
          // Only text horizontally under/over the rule can collide with it.
          if (!(r.left < rect.right - 2 && r.right > rect.left + 2)) continue;
          if (hasTop && rect.top - r.top < MIN_CLEARANCE) {
            onDivider.push(
              `"${text.slice(0, 28)}" is ${Math.round(rect.top - r.top)}px under the top rule of ${sel(el)}`,
            );
          }
          if (hasBottom && r.bottom - rect.bottom < MIN_CLEARANCE) {
            onDivider.push(
              `"${text.slice(0, 28)}" is ${Math.round(r.bottom - rect.bottom)}px above the bottom rule of ${sel(el)}`,
            );
          }
        }
      }
    }

    return { overflow, offenders, onDivider, overflowing, smallTargets };
  });
}

test("the harness emitted every admin fixture", () => {
  const onDisk = new Set(
    readdirSync(HARNESS_DIR)
      .filter((f) => f.endsWith(".html"))
      .map((f) => f.replace(/\.html$/, "")),
  );
  expect(
    FIXTURES.filter((id) => !onDisk.has(id)),
    "global-setup did not produce these — the matrix would silently shrink",
  ).toEqual([]);
});

for (const id of FIXTURES) {
  test(`${id} · twelve breakpoints`, async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: BREAKPOINTS[0], height: HEIGHT },
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    try {
      await openFixture(page, id);
      for (const width of BREAKPOINTS) {
        await page.setViewportSize({ width, height: HEIGHT });
        const r = await probe(page);

        expect(
          r.overflow,
          `${id} @${width}: page is ${r.overflow}px wider than the viewport — ${r.offenders.slice(0, 4).join(", ")}`,
        ).toBe(0);

        expect(
          r.onDivider.slice(0, 4),
          `${id} @${width}: a divider line runs through text`,
        ).toEqual([]);

        expect(
          r.overflowing.filter((o) => !o.startsWith("div.ptable-wrap")).slice(0, 4),
          `${id} @${width}: content wider than its own box — it should wrap`,
        ).toEqual([]);

        expect(
          r.smallTargets,
          `${id} @${width}: an action-row control is under 24x24`,
        ).toEqual([]);
      }
    } finally {
      await ctx.close();
    }
  });
}

/* ------------------------------------------------------------------ *
 * The review action row, specifically — the section the brief called
 * "unfinished", at the width where it is hardest to use.
 * ------------------------------------------------------------------ */

test("the review action row stacks rather than wrapping into a broken grid", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    viewport: { width: 320, height: HEIGHT },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  try {
    await openFixture(page, "admin-verifications-detail");
    const geometry = await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>("form .a-actions");
      if (!row) return null;
      const buttons = [...row.querySelectorAll<HTMLElement>(".btn")];
      // The CONTENT box, not the border box. `.a-actions` is a footer with
      // its own padding, so "full width" means the full width available to a
      // button — comparing against the padded outer box would ask each button
      // to be wider than the space it has.
      const cs = getComputedStyle(row);
      const inner =
        row.clientWidth -
        parseFloat(cs.paddingLeft) -
        parseFloat(cs.paddingRight);
      return {
        count: buttons.length,
        widths: buttons.map((b) => Math.round(b.getBoundingClientRect().width)),
        rowWidth: Math.round(inner),
        // Distinct top offsets = the buttons are on separate lines.
        lines: new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top)))
          .size,
      };
    });
    expect(geometry, "the action row is missing").not.toBeNull();
    expect(geometry!.count).toBe(2);
    // Full-width and stacked: two lines, each button ~the row width.
    expect(geometry!.lines, "buttons should stack at 320px").toBe(2);
    for (const w of geometry!.widths) {
      expect(w).toBeGreaterThan(geometry!.rowWidth * 0.9);
    }

    // The permanent-record warning must not sit on the textarea's border.
    const gap = await page.evaluate(() => {
      const ta = document.querySelector<HTMLElement>("#review-note");
      const hint = document.querySelector<HTMLElement>("#review-note-hint");
      if (!ta || !hint) return null;
      return Math.round(
        hint.getBoundingClientRect().top - ta.getBoundingClientRect().bottom,
      );
    });
    expect(gap, "helper text is missing").not.toBeNull();
    expect(gap!, "the hint is touching the textarea border").toBeGreaterThanOrEqual(6);
  } finally {
    await ctx.close();
  }
});

/* ------------------------------------------------------------------ *
 * Long values wrap rather than stretching the layout
 * ------------------------------------------------------------------ */

test("a 64-character digest and a long legal name wrap inside their column", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    viewport: { width: 320, height: HEIGHT },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  try {
    await openFixture(page, "admin-verifications-detail");
    const values = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".drow > dd")].map((dd) => ({
        text: (dd.textContent ?? "").slice(0, 20),
        scroll: dd.scrollWidth,
        client: dd.clientWidth,
        wrap: getComputedStyle(dd).overflowWrap,
      })),
    );
    expect(values.length).toBeGreaterThan(5);
    for (const v of values) {
      expect(
        v.scroll,
        `"${v.text}…" overflows its own cell (${v.scroll}>${v.client})`,
      ).toBeLessThanOrEqual(v.client + 1);
      expect(v.wrap).toBe("anywhere");
    }
  } finally {
    await ctx.close();
  }
});

/* ------------------------------------------------------------------ *
 * NON-VACUITY — the probe was corrected twice; prove it can still fail
 * ------------------------------------------------------------------ */

test("the probe still catches the layout this module replaced", async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    viewport: { width: 320, height: HEIGHT },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  try {
    // Load a real fixture first so the stylesheets are resolved and cached…
    await openFixture(page, "admin-verifications-detail");
    // …then replace the body with the PRE-M-99 pattern: a `.ptable-wrap` used
    // as a card (padding:0, so the heading sits on its border) and a `.ptable`
    // carrying a long unbroken value (which cannot wrap, so it spills).
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div class="portal"><div class="pmain">
          <div class="ptable-wrap">
            <h2 class="sec" style="font-size:1rem">What FMCSA returned</h2>
            <table class="ptable"><tbody>
              <tr><th scope="row" style="white-space:nowrap;padding-right:18px">Response digest</th>
                  <td>a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1a3f1 (SHA-256; the payload itself is never stored)</td></tr>
            </tbody></table>
          </div>
        </div></div>`;
    });
    const bad = await probe(page);

    // The heading now sits on the wrapper's border, and/or the row overflows.
    const caught =
      bad.onDivider.length > 0 || bad.overflow > 0 || bad.overflowing.length > 0;
    expect(
      caught,
      "the probe reported the pre-M-99 layout as clean — it proves nothing",
    ).toBe(true);
  } finally {
    await ctx.close();
  }
});

/* ------------------------------------------------------------------ *
 * axe, behind the real stylesheet — contrast is only observable here
 * ------------------------------------------------------------------ */

for (const id of FIXTURES) {
  for (const width of AXE_WIDTHS) {
    test(`axe · ${id} @${width}`, async ({ browser }) => {
      const ctx = await browser.newContext({
        viewport: { width, height: HEIGHT },
        reducedMotion: "reduce",
      });
      const page = await ctx.newPage();
      try {
        await openFixture(page, id);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(
          results.violations.map((v) => `${v.id} (${v.nodes.length})`),
          `${id} @${width}`,
        ).toEqual([]);
      } finally {
        await ctx.close();
      }
    });
  }
}

/* ------------------------------------------------------------------ *
 * M-101 — the Kanban scrollbar sits at the bottom of the workspace
 * ------------------------------------------------------------------ */

/**
 * The reported defect was a horizontal scrollbar floating in the middle of
 * the page. A scrollbar is drawn at the bottom edge of its own scroll
 * container, so "in the middle" means the container stopped there: `.kanban`
 * was as tall as its tallest column and no taller.
 *
 * This measures the container, not the scrollbar — the scrollbar has no
 * separate geometry to query, and headless Chromium does not paint overlay
 * scrollbars into screenshots. If the container reaches the bottom of the
 * workspace, so does its scrollbar.
 */
test("the leads board fills the workspace, so its scrollbar is at the bottom", async ({
  browser,
}) => {
  for (const width of [1280, 1440, 1920] as const) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    try {
      await openFixture(page, "admin-leads-board");
      const m = await page.evaluate(() => {
        const board = document.querySelector<HTMLElement>(".kanban");
        if (!board) return null;
        const r = board.getBoundingClientRect();
        const cols = [...document.querySelectorAll<HTMLElement>(".kcol")].map(
          (c) => Math.round(c.getBoundingClientRect().top),
        );
        return {
          bottom: Math.round(r.bottom),
          viewport: window.innerHeight,
          scrollsX: board.scrollWidth > board.clientWidth,
          overflowX: getComputedStyle(board).overflowX,
          pageOverflow:
            document.documentElement.scrollWidth - window.innerWidth,
          colTops: [...new Set(cols)],
          emptyColHeights: [
            ...new Set(
              [...document.querySelectorAll<HTMLElement>(".kcol")]
                .filter((c) => c.querySelectorAll(".kcard").length === 0)
                .map((c) => Math.round(c.getBoundingClientRect().height)),
            ),
          ],
        };
      });
      expect(m, "the board fixture is missing").not.toBeNull();

      // `.kanban` owns the horizontal scroll — not the page, not an ancestor.
      expect(m!.overflowX, `@${width}: the board is not the scroller`).toBe("auto");
      expect(m!.scrollsX, `@${width}: nine stages should not fit`).toBe(true);

      // It reaches the bottom of the workspace rather than stopping under the
      // tallest column. The tolerance is the page's own bottom padding.
      const gap = m!.viewport - m!.bottom;
      expect(
        gap,
        `@${width}: the board ends ${gap}px above the viewport bottom — its scrollbar is floating mid-page`,
      ).toBeLessThanOrEqual(48);

      // Moving the scrollbar down must not centre the columns.
      expect(m!.colTops, `@${width}: columns are not on one line`).toHaveLength(1);

      // An empty stage still reads as a column.
      for (const h of m!.emptyColHeights) {
        expect(h, `@${width}: an empty column collapsed`).toBeGreaterThan(140);
      }

      // Only the board scrolls sideways.
      expect(
        m!.pageOverflow,
        `@${width}: the page itself scrolls horizontally`,
      ).toBeLessThanOrEqual(1);
    } finally {
      await ctx.close();
    }
  }
});

test("the board keeps its natural height on a phone", async ({ browser }) => {
  // Forcing a viewport-height workspace at 390px would put the filters and a
  // sliver of one column on screen and nothing else.
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  try {
    await openFixture(page, "admin-leads-board");
    const m = await page.evaluate(() => {
      const page = document.querySelector<HTMLElement>(".a-page.is-board");
      return {
        display: page ? getComputedStyle(page).display : null,
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(m.display, "the desktop height chain leaked onto mobile").toBe("block");
    expect(m.pageOverflow).toBeLessThanOrEqual(1);
  } finally {
    await ctx.close();
  }
});
