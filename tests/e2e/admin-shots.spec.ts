import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * M-100 — screenshot harness for the admin redesign.
 *
 * Not an assertion suite. It renders the shipped fixtures behind the shipped
 * stylesheet and writes PNGs, so a BEFORE and an AFTER can actually be looked
 * at rather than described. The brief (§29) asks for visual validation and
 * says to say so plainly if the tooling is unavailable — this is the tooling.
 *
 * Output: test-results/admin-shots/<label>/<fixture>-<width>.png
 * Run with:  npx playwright test tests/e2e/admin-shots.spec.ts
 *            SHOT_LABEL=before|after
 */

const HARNESS_DIR = path.join(process.cwd(), "test-results", "tracking-harness");
const LABEL = process.env.SHOT_LABEL ?? "after";
const OUT = path.join(process.cwd(), "test-results", "admin-shots", LABEL);

const WIDTHS = [390, 768, 1440, 1920] as const;
const FIXTURES = [
  "admin-verifications-detail",
  "admin-verifications-detail-reviewed",
  "admin-verifications-queue",
  "admin-mapped-vocabulary",
  "admin-leads-board",
  "admin-security-log",
] as const;

interface Sheets {
  global: string;
  portal: string;
  bodyClass: string;
}
let sheets: Sheets | null = null;

async function stylesheets(page: Page): Promise<Sheets> {
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

test.describe("admin screenshots", () => {
  for (const id of FIXTURES) {
    for (const width of WIDTHS) {
      test(`${id} @ ${width}`, async ({ page }) => {
        const css = await stylesheets(page);
        const links = [css.global, css.portal]
          .map((href) => `<link rel="stylesheet" href="${href}">`)
          .join("");
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${id}</title>${links}</head><body class="${css.bodyClass}">${fixtureBody(id)}</body></html>`;
        await page.route("**/__shot/**", (route) =>
          route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
        );
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(`/__shot/${id}`);
        await page.waitForLoadState("load");
        mkdirSync(OUT, { recursive: true });
        await page.screenshot({
          path: path.join(OUT, `${id}-${width}.png`),
          fullPage: true,
        });

        // The security log hides its metadata behind a disclosure, so the
        // closed shot cannot show the half this module is judged on.
        if (id === "admin-security-log") {
          await page.evaluate(() => {
            for (const d of document.querySelectorAll("details")) {
              d.setAttribute("open", "");
            }
          });
          await page.screenshot({
            path: path.join(OUT, `${id}-expanded-${width}.png`),
            fullPage: true,
          });
        }
      });
    }
  }
});
