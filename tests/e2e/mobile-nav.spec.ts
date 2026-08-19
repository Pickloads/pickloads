import { expect, test, type Page } from "@playwright/test";

/**
 * The mobile navigation drawer — scroll containment.
 *
 * ── THE REPORTED BUG ─────────────────────────────────────────────────────
 *
 * "On mobile, when the hamburger menu is opened, swiping/scrolling moves the
 * page behind the menu instead of scrolling only the menu content."
 *
 * Both halves of it are here. The drawer renders inside `nav.sitenav`, which
 * is `position: sticky`, so it stayed pinned while the document scrolled
 * underneath — and it had no height cap and no scroller of its own, so on a
 * phone the bottom of a flat list of every destination on the site was simply
 * unreachable.
 *
 * ── WHY THESE ASSERTIONS AND NOT A UNIT TEST ─────────────────────────────
 *
 * Everything that was wrong is browser behaviour: sticky positioning, scroll
 * chaining, a body lock that has to survive `position: fixed`, a viewport that
 * changes height when a toolbar appears. jsdom has no scrolling and no sticky
 * layout, so a unit test here would assert that the fix was WRITTEN, not that
 * it WORKS. This file measures the page.
 *
 * The one thing it cannot measure is iOS Safari itself — Playwright's WebKit
 * is not Mobile Safari and this project runs Chromium. The `position: fixed`
 * body lock is the technique chosen BECAUSE `overflow: hidden` is known to
 * fail there; that choice is documented in `SiteNav.tsx` and verified here on
 * the engine available, which is the honest limit of this lane.
 */

/** A 320px-wide phone viewport, below the 960px drawer breakpoint. */
const PHONE = { width: 360, height: 640 };
/** The narrowest viewport the project supports. */
const NARROW = { width: 320, height: 568 };

async function openDrawer(page: Page) {
  await page.getByRole("button", { name: /menu/i }).click();
  await expect(page.locator("#mobile-menu")).toBeVisible();
}

async function scrollY(page: Page) {
  // With the body locked the document scroll is 0 and the position is held in
  // `body.style.top`, so "where is the reader?" has to read both.
  return page.evaluate(() => {
    const top = document.body.style.top;
    if (document.body.style.position === "fixed" && top) {
      return Math.abs(parseInt(top, 10));
    }
    return Math.round(window.scrollY);
  });
}

test.describe("mobile navigation drawer", () => {
  test.use({ viewport: PHONE });

  test("the page behind the open drawer does not move, by one pixel", async ({
    page,
  }) => {
    await page.goto("/become-a-carrier");
    await page.evaluate(() => window.scrollTo(0, 600));
    const before = await scrollY(page);
    expect(before).toBeGreaterThan(0);

    await openDrawer(page);
    expect(await scrollY(page)).toBe(before);

    // Every way a page can be asked to move.
    await page.mouse.wheel(0, 800);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => window.scrollBy(0, 1200));
    await page.keyboard.press("End");

    expect(
      await scrollY(page),
      "the document scrolled while the drawer was open",
    ).toBe(before);
  });

  test("closing restores the exact previous scroll position", async ({
    page,
  }) => {
    await page.goto("/become-a-carrier");
    await page.evaluate(() => window.scrollTo(0, 750));
    const before = await scrollY(page);

    await openDrawer(page);
    await page.mouse.wheel(0, 500);
    await page.getByRole("button", { name: /menu/i }).click();
    await expect(page.locator("#mobile-menu")).toBeHidden();

    // "No page jump" is the requirement, and a jump is what a naive
    // `position: fixed` lock produces: the document scroll resets to 0 and the
    // reader is thrown to the top of an article they were halfway through.
    expect(Math.round(await page.evaluate(() => window.scrollY))).toBe(before);
  });

  test("Escape closes it, restores the position and returns focus", async ({
    page,
  }) => {
    await page.goto("/become-a-carrier");
    await page.evaluate(() => window.scrollTo(0, 400));
    const before = await scrollY(page);

    await openDrawer(page);
    await page.keyboard.press("Escape");
    await expect(page.locator("#mobile-menu")).toBeHidden();
    expect(Math.round(await page.evaluate(() => window.scrollY))).toBe(before);

    const focused = await page.evaluate(
      () => document.activeElement?.className ?? "",
    );
    expect(focused).toContain("menu-btn");
  });

  test("the drawer scrolls on its own and every item is reachable", async ({
    page,
  }) => {
    await page.goto("/");
    await openDrawer(page);

    const drawer = page.locator("#mobile-menu");
    const metrics = await drawer.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowY: getComputedStyle(el).overflowY,
      overscroll: getComputedStyle(el).overscrollBehaviorY,
      viewport: window.innerHeight,
    }));

    // It IS its own scroller, and it is bounded by the viewport rather than by
    // its content — the two facts the fix turns on.
    expect(metrics.overflowY).toBe("auto");
    expect(metrics.overscroll).toBe("contain");
    expect(metrics.clientHeight).toBeLessThanOrEqual(metrics.viewport);

    // The last destination in the list can actually be brought into view.
    const last = drawer.locator("a").last();
    await last.scrollIntoViewIfNeeded();
    const box = await last.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(metrics.viewport + 1);
  });

  test("no horizontal overflow while the drawer is open", async ({ page }) => {
    await page.setViewportSize(NARROW);
    await page.goto("/");
    await openDrawer(page);
    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth > window.innerWidth + 1 ||
        document.body.scrollWidth > window.innerWidth + 1,
    );
    expect(overflows).toBe(false);
  });

  test("the sticky nav stays pinned to the top while the body is locked", async ({
    page,
  }) => {
    // The specific risk of a `position: fixed` body lock: sticky elements can
    // lose their containing block and slide off-screen. If this ever breaks,
    // the drawer opens somewhere the user cannot see.
    await page.goto("/become-a-carrier");
    await page.evaluate(() => window.scrollTo(0, 900));
    await openDrawer(page);
    const navTop = await page
      .locator("nav.sitenav")
      .evaluate((el) => el.getBoundingClientRect().top);
    expect(navTop).toBeGreaterThanOrEqual(-1);
    expect(navTop).toBeLessThan(120);
  });

  test("a link click closes it and leaves the new page scrollable", async ({
    page,
  }) => {
    await page.goto("/");
    await openDrawer(page);
    await page.locator("#mobile-menu a").first().click();
    await expect(page.locator("#mobile-menu")).toBeHidden();

    // The lock is released on EVERY close path, including a route change. A
    // leaked lock leaves the whole site unscrollable with no visible cause.
    const locked = await page.evaluate(
      () => getComputedStyle(document.body).position === "fixed",
    );
    expect(locked).toBe(false);
    await page.evaluate(() => window.scrollTo(0, 300));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test("Tab does not walk out of the open drawer", async ({ page }) => {
    await page.goto("/become-a-carrier");
    await openDrawer(page);
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return true;
        return Boolean(
          active.closest("#mobile-menu") || active.classList.contains("menu-btn"),
        );
      });
      expect(inside, `focus escaped the drawer after ${i + 1} tabs`).toBe(true);
    }
  });

  test("the toggle keeps its ARIA state", async ({ page }) => {
    await page.goto("/");
    const button = page.getByRole("button", { name: /menu/i });
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toHaveAttribute("aria-controls", "mobile-menu");
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("desktop is untouched", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("no hamburger, no drawer, no lock", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /menu/i })).toBeHidden();
    await expect(page.locator("#mobile-menu")).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, 500));
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(
      await page.evaluate(
        () => getComputedStyle(document.body).position === "fixed",
      ),
    ).toBe(false);
  });

  test("resizing up from a phone releases a lock that has no control left", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/");
    await page.getByRole("button", { name: /menu/i }).click();
    await expect(page.locator("#mobile-menu")).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator("#mobile-menu")).toBeHidden();
    expect(
      await page.evaluate(
        () => getComputedStyle(document.body).position === "fixed",
      ),
      "the body stayed locked after the drawer's only control disappeared",
    ).toBe(false);
  });
});
