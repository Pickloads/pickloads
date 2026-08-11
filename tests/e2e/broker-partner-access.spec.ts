import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * M-81 — §12's broker-partner access in a real browser.
 *
 * ── WHAT THIS LANE CAN AND CANNOT PROVE, STATED UP FRONT ──────────────────
 *
 * The flow the module is measured on is *invite → accept → partner portal →
 * sees the linked shipment only*. Three of its four steps sit behind a real
 * Supabase session, and this lane runs `next start` on PLACEHOLDER credentials
 * by design (M-41): there is no Supabase, no service-role key, no way to mint
 * an invite and no way to hold a session. A browser here reaches the login
 * bounce and nothing else.
 *
 * That is not a gap being papered over. It is ASSERTED below, and each
 * displaced step is proved where it can actually be proved:
 *
 *   invite → accept
 *       → `tests/integration/broker-partner-access.test.ts` (token lifecycle:
 *         hash storage, uniqueness, single use, the accepted-XOR-revoked
 *         CHECK) and `tests/unit/shipment-broker-permissions.test.ts` (the
 *         accept schema carries no role and no organization id, and the
 *         `role: "broker"` literal exists in exactly one place).
 *   partner portal → sees the linked shipment only
 *       → the same integration file, as REAL authenticated sessions under the
 *         REAL 0018/0019/0024/0029 policies, plus §16 of
 *         `supabase/tests/20_rls_isolation.sql`.
 *   the rendered surface
 *       → `tests/unit/broker-portal-a11y.test.tsx`, which renders the actual
 *         components through the actual `toBrokerDto` and axe-scans them in
 *         eleven states across three locales.
 *
 * What is proved HERE, in a real browser, is the part the other lanes cannot
 * reach: the partner routes are session-gated in every locale, the ONE
 * unauthenticated surface in this module (the invite-accept page) renders,
 * is accessible and is honest, no partner surface leaks into a public
 * artifact, and the page survives §22's 320px floor.
 *
 * Seeding a session and a fabricated partner organization into this lane
 * would mean shipping a fake shared shipment into the product, which §30
 * forbids in the same breath as fake GPS and fake ETAs.
 */

const BROKER_HOME = "/portal/broker";
const BROKER_DETAIL =
  "/portal/broker/shipments/11111111-1111-1111-1111-111111111111";
const BROKER_LIST_ALIAS = "/portal/broker/shipments";
const ADMIN_BROKERS = "/portal/admin/brokers";

/** 64 hex characters — the exact shape of a real invite token (M-58/M-81). */
const INVITE_LINK = `/broker-invite/${"a".repeat(64)}`;

const LOCALES = ["", "/es", "/fr", "/ru", "/ht"] as const;

/* ================================================================== *
 * 1 · Every partner surface is session-gated, in every locale
 * ================================================================== */

test("the partner routes bounce to /login in every locale", async ({ page }) => {
  for (const prefix of LOCALES) {
    for (const path of [BROKER_HOME, BROKER_DETAIL, BROKER_LIST_ALIAS]) {
      await page.goto(`${prefix}${path}`);
      await expect(
        page,
        `${prefix}${path} must bounce to /login rather than render a shipment`,
      ).toHaveURL(/\/login/);
    }
  }
});

test("the partner ADMIN surface is gated too", async ({ page }) => {
  for (const prefix of LOCALES) {
    await page.goto(`${prefix}${ADMIN_BROKERS}`);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("no query parameter turns a gated partner surface into a reader", async ({
  page,
}) => {
  // §3: no role may reach another company's shipment through URL
  // manipulation. A partner id is not a second door — the organization comes
  // from the session's membership, never from the URL.
  for (const suffix of [
    "?broker_partner_id=11111111-1111-1111-1111-111111111111",
    "?verified=1&active=1",
    "?before=2026-01-01T00:00:00.000Z",
    "?page=1&status=delivered",
  ]) {
    await page.goto(`${BROKER_HOME}${suffix}`);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("the login bounce preserves the partner surface as its destination", async ({
  page,
}) => {
  await page.goto(BROKER_DETAIL);
  const next = new URL(page.url()).searchParams.get("next");
  expect(next).toContain("/portal/broker/shipments/");
});

/* ================================================================== *
 * 2 · The ONE unauthenticated surface — the invite accept page
 * ================================================================== */

test("a malformed invite token 404s before any lookup", async ({ page }) => {
  for (const token of ["short", "A".repeat(64), `${"a".repeat(63)}`, "../../etc"]) {
    const response = await page.goto(`/broker-invite/${token}`);
    expect(
      response?.status(),
      `token ${token} must not render the accept form`,
    ).toBeGreaterThanOrEqual(400);
  }
});

test("a well-formed invite link renders the accept form and states the limits", async ({
  page,
}) => {
  await page.goto(INVITE_LINK);
  /*
   * RENDERED text only. `body.textContent` in an app-router page also returns
   * the RSC flight payload inside `<script>`, which carries the whole i18n
   * catalogue — asserting against it would be asserting about the framework's
   * serialization rather than about what an invitee sees.
   */
  const visible = await page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script, template, noscript").forEach((n) => n.remove());
    return clone.textContent ?? "";
  });

  expect(visible).toContain("Accept your partner invite");
  // §3 stated to the person it constrains.
  expect(visible).toContain("invitation-only");
  // §12's deny list, on the first screen a partner ever sees.
  expect(visible).toContain("never shows carrier records, billing or rates");

  await expect(page.locator("input[name='full_name']")).toBeVisible();
  await expect(page.locator("input[name='password']")).toBeVisible();
  // The token travels as a hidden field, never as a visible value.
  expect(await page.locator("input[name='token']").count()).toBe(1);
  expect(
    await page.locator("input[name='token']").getAttribute("type"),
  ).toBe("hidden");
  // Nothing on this form lets an invitee choose an organization or a role.
  expect(await page.locator("select[name='role']").count()).toBe(0);
  expect(await page.locator("[name='broker_partner_id']").count()).toBe(0);
  expect(await page.locator("[name='verification_status']").count()).toBe(0);
});

test("the invite page is noindex and carries no shipment data", async ({
  page,
}) => {
  await page.goto(INVITE_LINK);
  const robots = await page
    .locator('meta[name="robots"]')
    .getAttribute("content");
  expect(robots).toContain("noindex");
  /*
   * RENDERED text only, for the reason M-77's spec records: `page.content()`
   * in an app-router page includes the RSC flight payload, which carries the
   * whole five-locale catalogue — placeholders and all — so asserting against
   * it would be asserting about the framework's serialization rather than
   * about what an invitee sees.
   */
  const visible = await page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("script, template, noscript").forEach((n) => n.remove());
    return clone.textContent ?? "";
  });
  expect(visible).not.toMatch(/PL-\d{4}-\d{6}/);
});

/* ================================================================== *
 * 3 · No partner surface leaks into a public artifact
 * ================================================================== */

test("partner surfaces are absent from the sitemap and disallowed in robots", async ({
  request,
}) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).not.toContain("/portal/broker");
  expect(sitemap).not.toContain("/broker-invite");
  expect(sitemap).not.toContain("/portal/admin/brokers");

  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /portal");
});

/* ================================================================== *
 * 4 · axe — the unauthenticated surface, scanned for real
 * ================================================================== */

test("the invite accept page has no WCAG A/AA violations", async ({ page }) => {
  await page.goto(INVITE_LINK);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`),
  ).toEqual([]);
});

/* ================================================================== *
 * 5 · Responsive — §22's 320px floor
 * ================================================================== */

const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568 },
  { name: "390x844", width: 390, height: 844 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "1440x900", width: 1440, height: 900 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`the invite page does not overflow at ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(INVITE_LINK);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(
      overflow,
      `horizontal overflow of ${overflow}px at ${viewport.name} (WCAG 1.4.10)`,
    ).toBeLessThanOrEqual(1);
  });
}
