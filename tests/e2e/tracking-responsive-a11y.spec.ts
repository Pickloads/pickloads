import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * ============================================================================
 * M-82 — §22 responsive + §23 accessibility QA for every tracking surface.
 * ============================================================================
 *
 * ── WHAT THIS SUITE IS FOR ────────────────────────────────────────────────
 *
 * §22 names TWELVE widths. The suite that existed before this module used
 * seven (M-62's five, M-73 and M-76 added 320 and 1920 as range endpoints),
 * and `FINAL-IMPLEMENTATION-PLAN` §4 records that gap as an *unstated
 * downgrade*. This closes it: all twelve, on every surface M-73→M-81 shipped,
 * plus §22's eleven named prohibitions, §22's mobile priority order, and §23
 * measured against REAL CSS rather than jsdom's absence of it.
 *
 * ── HOW SESSION-GATED SURFACES ARE REACHED ────────────────────────────────
 *
 * `/track` and `/driver/update/[token]` are real routes and are driven as
 * such. Everything else (shipper, dispatcher, carrier, broker) needs a
 * Supabase session the secretless lane cannot mint — asserted, not assumed, by
 * `responsive.spec.ts`'s session-gate test and by each module's own e2e spec.
 * Those surfaces are measured from HARNESS FIXTURES: the DOM their real
 * components produce, emitted by the jsdom a11y suites (`tests/harness/emit.
 * ts`), served from this origin through `page.route`, and styled by the
 * stylesheets the running server actually links — verified below, not assumed.
 *
 * What that buys, which no previous module had: a real layout engine over real
 * CSS. Overflow, clipping, touch-target geometry, date-input intrinsic width
 * and axe's colour-contrast rule are all *measurable* here and all of them are
 * silently "incomplete" in jsdom.
 *
 * What it does NOT claim: it is not a running route. No server data, no
 * hydration, no client navigation. Behaviour lives in each module's own spec;
 * this suite owns LAYOUT and ACCESSIBILITY.
 *
 * ── DOCUMENTED SAMPLING ───────────────────────────────────────────────────
 *
 * 12 widths × 27 surface-states × (layout probe + axe) would be ~650 axe runs
 * and roughly half an hour. The split, stated rather than silently dropped:
 *
 *   * LAYOUT probes (overflow, clipping, targets, tables, date inputs, map,
 *     modals, hidden actions, priority order) run at **all twelve widths on
 *     every surface**. That is §22's actual subject and it is not sampled.
 *   * AXE runs at **320 / 768 / 1440** — the narrowest width, the tablet
 *     breakpoint where the card-table and drawer rules switch, and the desktop
 *     width. Those are the three layouts the CSS actually produces; the other
 *     nine widths render one of the same three arrangements, and axe's
 *     viewport-sensitive rules (`target-size`, `color-contrast`) depend on the
 *     arrangement, not on the pixel count. Sampling is by ARRANGEMENT, and the
 *     layout probe — which does run at all twelve — is what proves no fourth
 *     arrangement exists.
 */

/**
 * Twelve viewport changes plus a full axe pass over a dispatcher detail page —
 * the largest DOM in the product — does not fit the suite's 30s default. The
 * budget is generous rather than tight on purpose: a flaky timeout here would
 * be read as a layout regression and waste the reader's time.
 */
test.beforeEach(({}, testInfo) => {
  testInfo.setTimeout(180_000);
});

/* ------------------------------------------------------------------ *
 * §22's twelve widths, verbatim.
 * ------------------------------------------------------------------ */
const BREAKPOINTS = [
  320, 360, 375, 390, 414, 480, 768, 820, 1024, 1280, 1440, 1920,
] as const;

/** The three arrangements the stylesheets produce. See the sampling note. */
const AXE_WIDTHS = [320, 768, 1440] as const;

/** Heights are incidental to reflow; one tall enough to avoid scroll games. */
const HEIGHT = 900;

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const HARNESS_DIR = path.join(process.cwd(), "test-results", "tracking-harness");

/**
 * Every state, named. The list is EXHAUSTIVE and asserted against the
 * directory: a fixture that stops being emitted fails the run instead of
 * quietly shrinking the matrix.
 */
const FIXTURES = [
  // §8 public tracking result — M-73
  "track-result-populated",
  "track-result-exception",
  "track-result-cancelled",
  "track-result-delayed",
  "track-result-empty",
  // §11 shipper — M-74 (+ M-77 documents, M-78 exceptions, M-80 map)
  "shipper-tiles",
  "shipper-list-populated",
  "shipper-list-empty",
  "shipper-list-failed",
  "shipper-detail-populated",
  "shipper-detail-exception",
  "shipper-detail-degraded",
  // §14 dispatcher board + §5 search + detail — M-75
  "dispatcher-board",
  "dispatcher-board-empty",
  "dispatcher-new",
  "dispatcher-board-failed",
  "dispatcher-search",
  "dispatcher-column",
  "dispatcher-detail",
  // §13 carrier + driver — M-76
  "carrier-list",
  "carrier-detail",
  "carrier-detail-no-actions",
  "driver-granted",
  "driver-expired",
  // §12 broker partner — M-81
  "broker-list",
  "broker-detail",
  // §9 map and its accessible alternative — M-80
  "map-mounted",
  "map-text-only",
] as const;

type FixtureId = (typeof FIXTURES)[number];

/** Surfaces §22's "mobile tracking page" priority order applies to. */
const PRIORITY_SURFACES: FixtureId[] = [
  "track-result-populated",
  "track-result-exception",
  "track-result-delayed",
  "shipper-detail-populated",
  "shipper-detail-exception",
];

/** §22's order, most important first. */
const PRIORITY_ORDER = [
  "status",
  "eta",
  "route",
  "timeline",
  "support",
  "documents",
  "map",
] as const;

function fixtureBody(id: string): { shell: string; body: string } {
  const raw = readFileSync(path.join(HARNESS_DIR, `${id}.html`), "utf8");
  const match = /^<!--(\w+)-->\n([\s\S]*)$/.exec(raw);
  if (match === null) throw new Error(`${id}.html has no shell marker`);
  return { shell: match[1]!, body: match[2]! };
}

/* ------------------------------------------------------------------ *
 * Real stylesheets
 * ------------------------------------------------------------------ */

interface Stylesheets {
  /** globals.css + v4.css + @font-face — what every route links. */
  global: string;
  /** portal.css — linked by the portal layout only. */
  portal: string;
  /** The `<body class>` the real layout sets (next/font variables). */
  bodyClass: string;
}

let sheets: Stylesheets | null = null;

/**
 * Locate the built CSS chunks and prove the global one is the file the running
 * server links. Without that check the harness could be measured against a
 * stale build and report a clean sheet that means nothing.
 */
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
  expect(global, "no built stylesheet contains .track-result").not.toBeNull();
  expect(portal, "no built stylesheet contains .pmain").not.toBeNull();

  await page.goto("/track");
  const linked = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map(
      (l) => new URL(l.href).pathname,
    ),
  );
  expect(
    linked,
    "the running server does not link the stylesheet this suite measures — rebuild",
  ).toContain(global);
  const bodyClass = await page.evaluate(() => document.body.className);

  sheets = { global: global!, portal: portal!, bodyClass };
  return sheets;
}

/**
 * Serve a fixture from THIS origin so the real stylesheets resolve, then load
 * it. Same-origin matters: a `data:` or `about:blank` document cannot load
 * `/_next/static/css/…`, and inlining the CSS would lose the cascade order the
 * production `<head>` establishes.
 */
async function openFixture(page: Page, id: string): Promise<void> {
  const { shell, body } = fixtureBody(id);
  const css = await stylesheets(page);
  const links = [css.global, ...(shell === "portal" ? [css.portal] : [])]
    .map((href) => `<link rel="stylesheet" href="${href}">`)
    .join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${id}</title>${links}</head><body class="${css.bodyClass}">${body}</body></html>`;

  await page.route("**/__m82/**", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
  );
  await page.goto(`/__m82/${id}`);
  // The stylesheets are <link>s; `load` guarantees they applied.
  await page.waitForLoadState("load");
  await expect(
    page.locator("body"),
    `${id}: fixture rendered empty`,
  ).not.toBeEmpty();
}

/* ------------------------------------------------------------------ *
 * The probe — one page.evaluate, every §22 prohibition
 * ------------------------------------------------------------------ */

interface Probe {
  overflow: number;
  offenders: string[];
  spills: string[];
  smallTargets: string[];
  clipped: string[];
  dateInputs: {
    sel: string;
    fontSize: number;
    boxSizing: string;
    spills: boolean;
    innerOverflow: number;
  }[];
  maps: { sel: string; w: number; h: number; containerW: number }[];
  modals: string[];
  tables: { sel: string; strategy: string; problem: string | null }[];
  actions: string[];
  targets: string[];
  priority: { key: string; index: number }[];
  animated: string[];
}

async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const name = (el: Element): string => {
      const cls =
        typeof el.className === "string" && el.className.trim() !== ""
          ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}`
          : "";
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls}`;
    };
    const visible = (el: Element): boolean => {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    /**
     * True when an ancestor legitimately contains this element's overflow —
     * either by scrolling it (`auto`/`scroll`, a deliberate affordance) or by
     * clipping it (`hidden`/`clip`, which produces no scrollbar and nothing
     * visible outside the box).
     *
     * The `hidden` half matters for one specific idiom: `.ptable--cards thead`
     * is the visually-hidden pattern (`position:absolute; 1px box;
     * overflow:hidden; clip`). Its `<th>` children still LAY OUT at their
     * natural widths — a `getBoundingClientRect().right` of 470px on a 320px
     * screen — while being wholly invisible and wholly unable to widen the
     * page. Counting them as spills would report eleven phantom failures on
     * every card table and bury the two real overflow defects underneath.
     */
    const inScroller = (el: Element): boolean => {
      let p = el.parentElement;
      while (p !== null && p !== document.body) {
        const s = getComputedStyle(p);
        const contains = (v: string) =>
          v === "auto" || v === "scroll" || v === "hidden" || v === "clip";
        if (contains(s.overflowX) || contains(s.overflowY)) return true;
        p = p.parentElement;
      }
      return false;
    };
    /** The visually-hidden idiom (1px box + overflow hidden) is not clipping. */
    const isVisuallyHidden = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      return r.width <= 2 || r.height <= 2;
    };

    const all = [...document.querySelectorAll<HTMLElement>("body *")];

    // 1 — no horizontal page overflow
    const overflow = de.scrollWidth - de.clientWidth;
    const offenders: string[] = [];
    if (overflow > 1) {
      const wide = all
        .filter((el) => visible(el))
        .map((el) => ({ el, right: el.getBoundingClientRect().right }))
        .filter((x) => x.right > vw + 1 && !inScroller(x.el))
        .sort((a, b) => b.right - a.right)
        .slice(0, 8);
      offenders.push(...wide.map((x) => `${name(x.el)} → ${Math.round(x.right)}px`));
    }

    // 2 — nothing outside the viewport (form controls, actions, anything)
    const spills = all
      .filter((el) => visible(el) && !inScroller(el))
      // Only RIGHTWARD spill. Elements parked off-screen to the LEFT are the
      // deliberate visually-hidden idiom (`.skip-link`, `.sr-only`, the
      // off-canvas drawer at `translateX(-103%)`), which is a pattern this
      // codebase uses on purpose and which creates no scrollbar.
      .filter((el) => el.getBoundingClientRect().right > vw + 1)
      .map((el) => `${name(el)} [${Math.round(el.getBoundingClientRect().left)}…${Math.round(el.getBoundingClientRect().right)}]`)
      .slice(0, 10);

    // 3 — no tiny touch targets (WCAG 2.2 AA 2.5.8, 24×24 minimum).
    // Inline links inside running prose take the spec's inline exception; a
    // control rendered as a block/flex/inline-block box does not.
    const CONTROL = "button,select,summary,[role='button'],input:not([type='hidden'])";
    const smallTargets: string[] = [];
    for (const el of all) {
      if (!visible(el)) continue;
      const tag = el.tagName.toLowerCase();
      const isControl = el.matches(CONTROL);
      const display = getComputedStyle(el).display;
      const isBlockLink =
        tag === "a" && display !== "inline" && !el.closest("p,li,dd,td");
      if (!isControl && !isBlockLink) continue;
      if (tag === "input") {
        const type = (el as HTMLInputElement).type;
        if (type === "checkbox" || type === "radio") {
          // WCAG 2.5.8 measures the TARGET, and for a checkbox the target
          // includes its label — clicking the label toggles the control. Both
          // bindings count: a label that WRAPS the input and a `label[for]`
          // that points at it. This codebase uses both (`.psh-toggle` wraps;
          // the staff document form uses `for`), and only accepting the first
          // would report a conforming control as a failure.
          const labels = [
            el.closest("label"),
            el.id === ""
              ? null
              : document.querySelector(`label[for="${CSS.escape(el.id)}"]`),
          ].filter((l): l is HTMLLabelElement => l !== null);
          if (
            labels.some((l) => {
              const lr = l.getBoundingClientRect();
              return Math.min(lr.width, lr.height) >= 24;
            })
          )
            continue;
        }
      }
      const r = el.getBoundingClientRect();
      if (Math.min(r.width, r.height) < 24)
        smallTargets.push(`${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }

    // 4 — no fixed-height card cutting content, no clipped timeline
    const clipped = all
      .filter((el) => visible(el) && !isVisuallyHidden(el))
      .filter((el) => {
        const s = getComputedStyle(el);
        const hiddenY = s.overflowY === "hidden" || s.overflowY === "clip";
        const hiddenX = s.overflowX === "hidden" || s.overflowX === "clip";
        return (
          (hiddenY && el.scrollHeight > el.clientHeight + 2) ||
          (hiddenX && el.scrollWidth > el.clientWidth + 2)
        );
      })
      .map(
        (el) =>
          `${name(el)} content ${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight}`,
      )
      .slice(0, 10);

    // 5 — no iOS date-input overflow
    const dateInputs = [
      ...document.querySelectorAll<HTMLInputElement>(
        "input[type='date'],input[type='datetime-local'],input[type='time'],input[type='month']",
      ),
    ]
      .filter((el) => visible(el))
      .map((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const parent = el.parentElement!.getBoundingClientRect();
        return {
          sel: name(el),
          fontSize: parseFloat(s.fontSize),
          boxSizing: s.boxSizing,
          spills: r.right > Math.min(vw, parent.right) + 1,
          innerOverflow: el.scrollWidth - el.clientWidth,
        };
      });

    // 6 — no oversized map
    const maps = [...document.querySelectorAll<HTMLElement>(".shipmap")]
      .filter((el) => visible(el))
      .map((el) => {
        const r = el.getBoundingClientRect();
        const parent = el.parentElement!.getBoundingClientRect();
        return {
          sel: name(el),
          w: Math.round(r.width),
          h: Math.round(r.height),
          containerW: Math.round(parent.width),
        };
      });

    // 7 — no mobile modal exceeding screen
    const modals = [
      ...document.querySelectorAll<HTMLElement>(
        "dialog,[role='dialog'],[role='alertdialog']",
      ),
    ]
      .filter((el) => visible(el))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > vw + 1 || r.left < -1 || r.right > vw + 1;
      })
      .map(name);

    // 8 — no unreadable shipment table
    const tables = [...document.querySelectorAll<HTMLTableElement>("table")]
      .filter((el) => visible(el))
      .map((el) => {
        const cards = el.classList.contains("ptable--cards");
        const cells = [...el.querySelectorAll("tbody td")];
        if (cards) {
          const unlabelled = cells.filter(
            (td) => (td.getAttribute("data-th") ?? "") === "",
          ).length;
          return {
            sel: name(el),
            strategy: "cards",
            problem:
              unlabelled === 0 ? null : `${unlabelled} cell(s) without data-th`,
          };
        }
        let scroller: HTMLElement | null = el.parentElement;
        while (scroller !== null && scroller !== document.body) {
          const s = getComputedStyle(scroller);
          if (s.overflowX === "auto" || s.overflowX === "scroll") break;
          scroller = scroller.parentElement;
        }
        if (scroller === null || scroller === document.body)
          return {
            sel: name(el),
            strategy: "none",
            problem: "neither a card transform nor a scroll container",
          };
        const scrolls = scroller.scrollWidth > scroller.clientWidth + 1;
        const focusable = scroller.querySelector(
          "a[href],button,input,select,textarea,[tabindex]",
        );
        return {
          sel: name(el),
          strategy: "scroll",
          problem:
            scrolls && focusable === null && scroller.tabIndex < 0
              ? "scrollable region is not keyboard reachable"
              : null,
        };
      });

    // 9 — no hidden actions: the set of reachable controls, by label
    const label = (el: Element): string =>
      (
        el.getAttribute("aria-label") ??
        el.textContent ??
        (el as HTMLInputElement).value ??
        ""
      )
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 60);
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        "a[href],button,summary,input[type='submit']",
      ),
    ].filter((el) => visible(el));
    const actions = controls
      .map((el) => `${el.tagName.toLowerCase()}:${label(el)}`)
      .sort();
    /**
     * The same set keyed by DESTINATION rather than wording. On the live
     * routes the site nav deliberately re-labels itself between the desktop
     * row and the mobile drawer ("Dispatch" → "Dispatch Services", "Shippers"
     * → "Shippers & Freight Quote"), so a label comparison reports a dozen
     * false losses and hides the one real one. What §22 actually prohibits is
     * losing the ACTION, and an action is where it goes.
     */
    const targets = controls
      .map((el) => {
        const href = el.getAttribute("href");
        if (href !== null && href !== "")
          return `→${href.replace(/^https?:\/\/[^/]+/, "")}`;
        return `${el.tagName.toLowerCase()}:${label(el)}`;
      })
      .sort();

    // 10 — §22 mobile priority order
    const priority = [...document.querySelectorAll<HTMLElement>("[data-prio]")]
      .map((el, index) => ({ key: el.dataset.prio!, index }))
      .filter((p) => p.key !== "");

    // 11 — reduced motion (the page is emulated with `reduce`)
    const animated = all
      .filter((el) => visible(el))
      .filter((el) => {
        const s = getComputedStyle(el);
        const dur = (v: string) =>
          v.split(",").some((p) => parseFloat(p) > 0.01);
        return (
          (s.animationName !== "none" && dur(s.animationDuration)) ||
          (s.transitionProperty !== "none" && dur(s.transitionDuration))
        );
      })
      .map(name)
      .slice(0, 10);

    return {
      overflow,
      offenders,
      spills,
      smallTargets,
      clipped,
      dateInputs,
      maps,
      modals,
      tables,
      actions,
      targets,
      priority,
      animated,
    };
  });
}

function assertProbe(p: Probe, where: string, vw: number): void {
  expect(
    p.overflow,
    `${where}: horizontal page overflow of ${p.overflow}px. Widest: ${p.offenders.join(", ") || "unidentified"}`,
  ).toBeLessThanOrEqual(1);
  expect(p.spills, `${where}: element(s) outside the viewport`).toEqual([]);
  expect(p.smallTargets, `${where}: touch target(s) under 24×24`).toEqual([]);
  expect(
    p.clipped,
    `${where}: fixed-size box(es) cutting their own content`,
  ).toEqual([]);
  expect(p.modals, `${where}: modal(s) exceeding the screen`).toEqual([]);
  for (const d of p.dateInputs) {
    expect(
      d.boxSizing,
      `${where}: ${d.sel} is content-box — padding pushes a full-width date field past its container`,
    ).toBe("border-box");
    expect(
      d.fontSize,
      `${where}: ${d.sel} renders at ${d.fontSize}px — iOS Safari zooms any field under 16px on focus, which scrolls the page sideways (§22 "no iOS date-input overflow")`,
    ).toBeGreaterThanOrEqual(16);
    expect(d.spills, `${where}: ${d.sel} overflows its container`).toBe(false);
    expect(
      d.innerOverflow,
      `${where}: ${d.sel} is narrower than its own control content by ${d.innerOverflow}px`,
    ).toBeLessThanOrEqual(1);
  }
  for (const m of p.maps) {
    expect(
      m.w,
      `${where}: ${m.sel} is ${m.w}px wide inside a ${m.containerW}px container`,
    ).toBeLessThanOrEqual(m.containerW + 1);
    expect(m.h, `${where}: ${m.sel} is ${m.h}px tall (cap 320)`).toBeLessThanOrEqual(
      321,
    );
    expect(
      m.h,
      `${where}: ${m.sel} takes ${m.h}px of a ${vw}px-wide phone screen`,
    ).toBeLessThanOrEqual(Math.round(HEIGHT * 0.6));
  }
  const badTables = p.tables.filter((t) => t.problem !== null);
  expect(
    badTables.map((t) => `${t.sel}: ${t.problem}`),
    `${where}: unreadable table(s)`,
  ).toEqual([]);
  expect(
    p.animated,
    `${where}: animation/transition still running under prefers-reduced-motion:reduce`,
  ).toEqual([]);
}

/* ------------------------------------------------------------------ *
 * 1 · the fixture matrix — 12 widths × every session-gated surface
 * ------------------------------------------------------------------ */

test("the harness emitted every named surface state", () => {
  const onDisk = new Set(
    readdirSync(HARNESS_DIR)
      .filter((f) => f.endsWith(".html"))
      .map((f) => f.replace(/\.html$/, "")),
  );
  const missing = FIXTURES.filter((id) => !onDisk.has(id));
  expect(
    missing,
    "global-setup did not produce these fixtures — the matrix would silently shrink",
  ).toEqual([]);
});

for (const id of FIXTURES) {
  test(`§22 · ${id} · twelve breakpoints`, async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: BREAKPOINTS[0], height: HEIGHT },
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    try {
      await openFixture(page, id);

      // The widest arrangement is the reference for "no hidden actions".
      await page.setViewportSize({ width: 1920, height: HEIGHT });
      const desktop = await probe(page);

      for (const width of BREAKPOINTS) {
        await page.setViewportSize({ width, height: HEIGHT });
        const p = await probe(page);
        assertProbe(p, `${id} @ ${width}px`, width);

        // §22 "no hidden actions": nothing reachable on a desktop may vanish
        // on a phone. Duplicate labels are compared as multisets so a lost
        // second copy is caught too.
        const lost = [...desktop.actions];
        for (const a of p.actions) {
          const i = lost.indexOf(a);
          if (i >= 0) lost.splice(i, 1);
        }
        expect(
          lost,
          `${id} @ ${width}px: action(s) present at 1920px are gone here`,
        ).toEqual([]);

        // §22 mobile priority order.
        if (PRIORITY_SURFACES.includes(id)) {
          const seen = p.priority.map((x) => x.key);
          const expectedOrder = PRIORITY_ORDER.filter((k) => seen.includes(k));
          expect(
            seen,
            `${id} @ ${width}px: §22's priority order is status → ETA → route → timeline → support → documents → map`,
          ).toEqual(expectedOrder);
          expect(
            seen.length,
            `${id} @ ${width}px: no [data-prio] landmarks found — the order is unprovable`,
          ).toBeGreaterThanOrEqual(4);
        }
      }
    } finally {
      await ctx.close();
    }
  });
}

/* ------------------------------------------------------------------ *
 * 2 · axe over every fixture, at the three arrangements
 * ------------------------------------------------------------------ */

for (const id of FIXTURES) {
  test(`§23 · axe · ${id}`, async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: AXE_WIDTHS[0], height: HEIGHT },
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    try {
      await openFixture(page, id);
      for (const width of AXE_WIDTHS) {
        await page.setViewportSize({ width, height: HEIGHT });
        const results = await new AxeBuilder({ page })
          .withTags(AXE_TAGS)
          .analyze();
        const summary = results.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.slice(0, 4).map((n) => n.target.join(" ")),
        }));
        expect(
          summary,
          `${id} @ ${width}px\n${JSON.stringify(summary, null, 2)}`,
        ).toEqual([]);
      }
    } finally {
      await ctx.close();
    }
  });
}

/* ------------------------------------------------------------------ *
 * 3 · the two real routes, at all twelve widths
 * ------------------------------------------------------------------ */

/**
 * Destinations the site chrome deliberately drops on a phone, with the
 * two-step route that replaces them stated rather than waved at.
 *
 *   * `mailto:support@pickloads.com` — the topbar's `.tb-hide` address. The
 *     drawer's "Support" entry goes to `/contact`, which renders the same
 *     address. M-59 made that trade on purpose to fit the topbar in 320px.
 *
 * NOTHING ELSE is exempt. `/#quote` used to be on this list by omission — the
 * `Start Carrier Setup` button in `.nav-cta` had no drawer or footer
 * equivalent at all — and M-82 fixed the nav rather than widening the
 * exemption, which is the whole point of measuring by destination.
 */
const CHROME_EXEMPT = ["→mailto:support@pickloads.com"];

const LIVE_ROUTES = [
  { path: "/track", slug: "track-lookup" },
  { path: `/driver/update/${"A".repeat(43)}`, slug: "driver-live" },
  // §24: the longest translated strings are the widest failure case, and the
  // tracking form is the surface a notification link lands on in any locale.
  { path: "/es/track", slug: "track-lookup-es" },
] as const;

for (const route of LIVE_ROUTES) {
  test(`§22 · live ${route.path} · twelve breakpoints`, async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: BREAKPOINTS[0], height: HEIGHT },
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    try {
      const response = await page.goto(route.path);
      expect(response?.status(), `${route.path} must render`).toBeLessThan(400);
      await page.setViewportSize({ width: 1920, height: HEIGHT });
      const desktop = await probe(page);
      for (const width of BREAKPOINTS) {
        await page.setViewportSize({ width, height: HEIGHT });
        const p = await probe(page);
        assertProbe(p, `${route.path} @ ${width}px`, width);

        // §22 "no hidden actions" — measured the way a user meets it. Below
        // 960px the site nav swaps its link row for the hamburger drawer, so
        // the honest question is not "is the link still in the bar" but "can
        // the person still get there", and getting there costs one tap on a
        // control this suite presses. `responsive.spec.ts` owns the drawer's
        // own geometry; what is owned here is the SET of destinations.
        const menu = page.locator(".menu-btn");
        const collapsed =
          (await menu.count()) > 0 && (await menu.first().isVisible());
        if (collapsed) await menu.first().click();
        const reachable = collapsed ? (await probe(page)).targets : p.targets;
        if (collapsed) await menu.first().click();

        // SETS, not multisets. The topbar renders `/login` twice ("Carrier
        // Login", "Shipper Login") and the drawer renders it once, because
        // sign-in is role-routed server-side and there is only one door. A
        // destination reachable once is reachable; counting copies would
        // report that as two losses and mean nothing. The FIXTURE matrix above
        // still compares multisets — those surfaces have no collapsing chrome
        // and a disappearing second copy there IS a lost control.
        const here = new Set(reachable);
        const lost = [...new Set(desktop.targets)].filter((a) => !here.has(a));
        expect(
          lost.filter((a) => !CHROME_EXEMPT.includes(a)),
          `${route.path} @ ${width}px: destination(s) reachable at 1920px cannot be reached here, drawer included`,
        ).toEqual([]);
      }
    } finally {
      await ctx.close();
    }
  });
}

/* ------------------------------------------------------------------ *
 * 4 · §23 — no critical information on hover only (a CSS audit)
 * ------------------------------------------------------------------ */

test("§23 · no rule reveals content on :hover without a :focus equivalent", async ({
  page,
}) => {
  await openFixture(page, "shipper-detail-populated");
  const offenders = await page.evaluate(() => {
    const REVEALING = ["display", "visibility", "opacity", "content"];
    const found: string[] = [];
    const focusRules = new Set<string>();
    const hoverRules: { selector: string; props: string[] }[] = [];
    const walk = (rules: CSSRuleList) => {
      for (const rule of rules) {
        if (rule instanceof CSSGroupingRule) {
          walk(rule.cssRules);
          continue;
        }
        if (!(rule instanceof CSSStyleRule)) continue;
        const sel = rule.selectorText;
        if (/:focus(-visible|-within)?\b/.test(sel))
          focusRules.add(sel.replace(/:focus(-visible|-within)?/g, ""));
        if (!/:hover\b/.test(sel)) continue;
        const props = [...rule.style].filter((p) => REVEALING.includes(p));
        // A hover that DIMS (opacity < 1) or hides is not revealing anything;
        // one that raises opacity or switches display/visibility on is.
        const revealing = props.filter((p) => {
          const v = rule.style.getPropertyValue(p).trim();
          if (p === "opacity") return parseFloat(v) >= 1;
          if (p === "display") return v !== "none";
          if (p === "visibility") return v === "visible";
          return v !== "" && v !== "none" && v !== '""';
        });
        if (revealing.length > 0) hoverRules.push({ selector: sel, props: revealing });
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules);
      } catch {
        /* cross-origin sheet — none exist here */
      }
    }
    for (const h of hoverRules) {
      const bare = h.selector.replace(/:hover/g, "");
      if (!focusRules.has(bare))
        found.push(`${h.selector} { ${h.props.join(", ")} }`);
    }
    return found;
  });
  expect(
    offenders,
    "§23: these rules reveal content on hover with no keyboard/focus equivalent",
  ).toEqual([]);
});

/* ------------------------------------------------------------------ *
 * 5 · §23 — the accessible map alternative, under a screen-reader shape
 * ------------------------------------------------------------------ */

test("§23 · the map's accessible alternative carries the map's facts", async ({
  page,
}) => {
  await openFixture(page, "map-mounted");
  // The SVG is an image with a name and a description, and it is not the only
  // carrier of the information.
  const svg = page.locator("svg.shipmap");
  await expect(svg).toHaveAttribute("role", "img");
  const described = await svg.getAttribute("aria-labelledby");
  expect(described, "the map has no accessible name/description").not.toBeNull();
  for (const id of described!.split(/\s+/)) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }

  await openFixture(page, "map-text-only");
  // With NO map mounted the same facts are still on the page, visible (not
  // sr-only), in a list, with machine-readable timestamps.
  const list = page.locator("ol.shipmap-list");
  await expect(list).toBeVisible();
  const items = list.locator("li");
  expect(await items.count()).toBeGreaterThan(0);
  for (let i = 0; i < (await items.count()); i++) {
    const li = items.nth(i);
    await expect(li.locator("time")).toHaveAttribute("datetime", /\d{4}-\d{2}/);
    await expect(li.locator(".shipmap-place")).not.toBeEmpty();
  }
  // The summary is a live region, so a new reading is announced rather than
  // silently redrawn.
  await expect(page.locator(".shipmap-alt [role='status']").first()).toBeVisible();
});

/* ------------------------------------------------------------------ *
 * 6 · §23 — headings, status text, focus visibility, live regions
 * ------------------------------------------------------------------ */

test("§23 · every tracking surface has one h1 and no skipped heading level", async ({
  page,
}) => {
  // The fixtures are page FRAGMENTS wrapped in the shell their route renders;
  // those that carry their own <h1> are the ones the route owns.
  for (const id of FIXTURES) {
    await openFixture(page, id);
    const levels = await page.evaluate(() =>
      [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
        .filter((h) => getComputedStyle(h).display !== "none")
        .map((h) => Number(h.tagName[1])),
    );
    const h1s = levels.filter((l) => l === 1).length;
    expect(h1s, `${id}: expected exactly one h1, found ${h1s}`).toBeLessThanOrEqual(1);
    for (let i = 1; i < levels.length; i++) {
      expect(
        levels[i]! - levels[i - 1]!,
        `${id}: heading level jumps from h${levels[i - 1]} to h${levels[i]}`,
      ).toBeLessThanOrEqual(1);
    }
  }
});

test("§23 · status is carried by TEXT, not colour alone", async ({ page }) => {
  for (const id of [
    "track-result-populated",
    "track-result-delayed",
    "shipper-detail-populated",
    "shipper-list-populated",
    "carrier-list",
    "broker-list",
    "dispatcher-board",
  ]) {
    await openFixture(page, id);
    const empties = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          ".track-status,.pbadge,.track-step .st,[class*='kprio-']",
        ),
      ]
        .filter((el) => getComputedStyle(el).display !== "none")
        .filter((el) => (el.textContent ?? "").trim() === "")
        .map((el) => el.className),
    );
    expect(
      empties,
      `${id}: colour-coded element(s) with no text label`,
    ).toEqual([]);
  }
});

test("§23 · every filter control is keyboard reachable and labelled", async ({
  page,
}) => {
  for (const id of [
    "shipper-list-populated",
    "dispatcher-board",
    "carrier-list",
    "broker-list",
  ]) {
    await openFixture(page, id);
    const problems = await page.evaluate(() => {
      const out: string[] = [];
      for (const form of document.querySelectorAll("form")) {
        for (const el of form.querySelectorAll<HTMLElement>(
          "input,select,textarea,button",
        )) {
          if ((el as HTMLInputElement).type === "hidden") continue;
          if (el.tabIndex < 0) out.push(`${el.id || el.tagName}: tabindex ${el.tabIndex}`);
          const labelled =
            el.getAttribute("aria-label") !== null ||
            el.getAttribute("aria-labelledby") !== null ||
            (el.id !== "" &&
              document.querySelector(`label[for="${el.id}"]`) !== null) ||
            el.closest("label") !== null ||
            el.tagName === "BUTTON";
          if (!labelled) out.push(`${el.id || el.tagName}: no label`);
        }
      }
      return out;
    });
    expect(problems, `${id}: filter control problems`).toEqual([]);
  }
});

test("§23 · focus-visible produces a visible outline on tracking controls", async ({
  page,
}) => {
  await openFixture(page, "shipper-list-populated");
  const first = page.locator("form input, form select, form button").first();
  await first.focus();
  const outline = await first.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      width: parseFloat(s.outlineWidth),
      style: s.outlineStyle,
      shadow: s.boxShadow,
      border: s.borderColor,
    };
  });
  expect(
    outline.width > 0 && outline.style !== "none",
    `focused control has no outline: ${JSON.stringify(outline)}`,
  ).toBe(true);
});

test("§23 · aria-live announces the states that change without navigation", async ({
  page,
}) => {
  // The timeline's text equivalent, the list result count, the location
  // summary and every async form result are the four things that change under
  // the reader's feet. Each must be a live region.
  const expectations: [string, string][] = [
    ["track-result-populated", ".track-result [role='status']"],
    ["shipper-list-populated", "[role='status']"],
    ["shipper-detail-populated", ".shipmap-alt [role='status']"],
    ["dispatcher-board", "[role='status']"],
    ["dispatcher-board-failed", "[role='alert'],[role='status']"],
    ["shipper-list-failed", "[role='alert'],[role='status']"],
    ["driver-granted", "[role='status'],[role='alert']"],
  ];
  for (const [id, selector] of expectations) {
    await openFixture(page, id);
    const count = await page.locator(selector).count();
    expect(count, `${id}: no live region matching ${selector}`).toBeGreaterThan(0);
  }
});

test("§23 · error and empty states are announced and readable", async ({
  page,
}) => {
  for (const id of [
    "shipper-list-empty",
    "shipper-list-failed",
    "dispatcher-board-empty",
    "dispatcher-board-failed",
    "shipper-detail-degraded",
    "track-result-empty",
  ]) {
    await openFixture(page, id);
    const live = await page
      .locator("[role='status'],[role='alert']")
      .filter({ hasText: /\S/ })
      .count();
    expect(live, `${id}: no announced empty/error state`).toBeGreaterThan(0);
  }
});

test('§22 · "do not force desktop tables onto mobile" — every CUSTOMER table is a card table', async ({
  page,
}) => {
  /**
   * §22's closing instruction, checked rather than asserted in prose.
   *
   * The rule M-59 set is a division of labour, not a blanket: CUSTOMER-facing
   * tables become stacked cards below 640px (`.ptable--cards` + a `data-th` on
   * every body cell), while STAFF tables keep the controlled horizontal scroll
   * because a dispatcher scanning across sixty shipments wants the columns.
   * M-73→M-81 added tables on both sides of that line, and nothing until now
   * checked which side a new one landed on.
   *
   * Customer surfaces here = everything a shipper, carrier, broker partner or
   * public visitor sees. The dispatcher board and detail are staff and are
   * deliberately absent.
   */
  const CUSTOMER: FixtureId[] = [
    "track-result-populated",
    "track-result-exception",
    "shipper-list-populated",
    "shipper-detail-populated",
    "shipper-detail-exception",
    "carrier-list",
    "carrier-detail",
    "broker-list",
    "broker-detail",
  ];
  await page.setViewportSize({ width: 320, height: HEIGHT });
  for (const id of CUSTOMER) {
    await openFixture(page, id);
    const problems = await page.evaluate(() => {
      const out: string[] = [];
      for (const table of document.querySelectorAll<HTMLTableElement>("table")) {
        if (getComputedStyle(table).display === "none") continue;
        const caption =
          table.querySelector("caption")?.textContent?.trim() ??
          table.querySelector("th")?.textContent?.trim() ??
          "(unnamed)";
        if (!table.classList.contains("ptable--cards")) {
          out.push(`"${caption}" is a desktop table with no card transform`);
          continue;
        }
        // The transform is only readable if every cell says what it is.
        const unlabelled = [...table.querySelectorAll("tbody td")].filter(
          (td) => (td.getAttribute("data-th") ?? "").trim() === "",
        ).length;
        if (unlabelled > 0)
          out.push(`"${caption}" has ${unlabelled} cell(s) without data-th`);
        // …and only actually stacked if the rows became blocks.
        const row = table.querySelector("tbody tr");
        if (row !== null && getComputedStyle(row).display !== "block")
          out.push(`"${caption}" rows did not stack at 320px`);
      }
      return out;
    });
    expect(problems, `${id}: customer table problems`).toEqual([]);
  }
});

test("§23 · document labels are meaningful, not file names alone", async ({
  page,
}) => {
  for (const id of ["shipper-detail-populated", "carrier-detail", "broker-detail"]) {
    await openFixture(page, id);
    const rows = await page.evaluate(() => {
      const out: { text: string; hasType: boolean }[] = [];
      for (const el of document.querySelectorAll("[data-doc-row]")) {
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        out.push({ text, hasType: (el.getAttribute("data-doc-type") ?? "") !== "" });
      }
      return out;
    });
    expect(rows.length, `${id}: no document rows found`).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.hasType, `${id}: document row without a type: ${row.text}`).toBe(
        true,
      );
      expect(
        row.text.length,
        `${id}: document row label is too thin: "${row.text}"`,
      ).toBeGreaterThan(8);
    }
  }
});
