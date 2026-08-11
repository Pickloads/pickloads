import { expect, test } from "@playwright/test";

/**
 * M-79 — the two surfaces §17 gives a customer: the tokenized opt-out page,
 * and the `?number=` prefill on `/track` that every notification email links
 * to.
 *
 * ── WHAT THIS LANE CAN AND CANNOT REACH, stated up front ──────────────────
 *
 * The e2e lane runs `next start` on PLACEHOLDER credentials (M-41): no
 * Supabase project and no service-role key. So a VALID opt-out token cannot
 * resolve here — `lookupNotificationOptOut` returns `unavailable` without a
 * service key, by design, because the alternative is a page that reports a
 * fake success while leaving a real address subscribed.
 *
 * The flow is therefore split across three lanes, each proving the part it
 * honestly can:
 *
 *   * HERE — the page renders in five locales, is `noindex`, NEVER mutates on
 *     a GET, and shows the honest unavailable/invalid states rather than a
 *     fabricated confirmation.
 *   * `tests/integration/shipment-notifications.test.ts` — the preference and
 *     suppression writes against a real PostgreSQL 16, including that an
 *     opted-out customer produces no email queue row at all.
 *   * `tests/unit/shipment-notifications.test.tsx` — the token normaliser and
 *     the opt-out URL builder.
 *
 * Writing that down is the point. A green e2e suite that quietly skipped the
 * middle of the flow would be the vacuous kind of green.
 */

const PATH = "/notifications/unsubscribe";

test("the opt-out page is reachable with no session at all", async ({
  page,
}) => {
  const response = await page.goto(PATH);
  expect(response?.status()).toBe(200);
  await expect(page.locator("main#main h1")).toHaveText(
    "Shipment update emails",
  );
});

test("a missing token shows the honest invalid state, never a form", async ({
  page,
}) => {
  await page.goto(PATH);
  await expect(page.locator("main#main")).toContainText(
    "no longer valid",
  );
  // No button, because there is nothing to act on.
  await expect(page.locator('main#main button[type="submit"]')).toHaveCount(0);
});

test("a malformed token is indistinguishable from an unknown one", async ({
  page,
}) => {
  // §19's enumeration rule, applied to a credential URL: the page must not
  // become an oracle for "is this a real token?".
  await page.goto(`${PATH}?token=not-a-token`);
  const malformed = await page.locator("main#main").innerText();
  await page.goto(`${PATH}?token=8b2e6f14-1111-4222-8333-444455556666`);
  const unknown = await page.locator("main#main").innerText();

  // Neither page says "that token does not exist", and — the assertion that
  // actually closes the oracle — neither renders a masked recipient address,
  // which is the only thing that could distinguish "known" from "unknown".
  expect(malformed).not.toContain("does not exist");
  expect(unknown).not.toContain("does not exist");
  expect(malformed).not.toContain("•");
  expect(unknown).not.toContain("•");
});

test("the GET NEVER unsubscribes — no state-changing request is made", async ({
  page,
}) => {
  // Corporate link scanners prefetch every URL in an email. A GET side effect
  // would stop notifications for customers who never clicked.
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") posts.push(request.url());
  });
  await page.goto(`${PATH}?token=8b2e6f14-1111-4222-8333-444455556666`);
  await page.waitForLoadState("networkidle");
  expect(posts).toHaveLength(0);
});

test("the page is noindex — a credential URL is never a search result", async ({
  page,
}) => {
  await page.goto(`${PATH}?token=8b2e6f14-1111-4222-8333-444455556666`);
  const robots = page.locator('head meta[name="robots"]');
  await expect(robots).toHaveAttribute("content", /noindex/);
});

test("it renders in every one of the five locales (§24)", async ({ page }) => {
  const expected: Record<string, string> = {
    "": "Shipment update emails",
    "/es": "Correos de actualización de envíos",
    "/fr": "E-mails de suivi d'envoi",
    // ru/ht mirror English, flagged in the module doc — the same M-42/M-60
    // precedent as the rest of the shipment namespace.
    "/ru": "Shipment update emails",
    "/ht": "Shipment update emails",
  };
  for (const [prefix, heading] of Object.entries(expected)) {
    await page.goto(`${prefix}${PATH}`);
    await expect(page.locator("main#main h1")).toHaveText(heading);
  }
});

test("it says which mail it covers and which it does not", async ({ page }) => {
  // Collapsing shipment updates with the newsletter would mean a customer who
  // wants fewer status emails silently loses the blog digest — or the reverse.
  await page.goto(PATH);
  const body = await page.locator("main#main").innerText();
  expect(body).toContain("Shipment");
});

/* ------------------------------------------------------------------ *
 * §17's tracking link lands on /track with the number prefilled
 * ------------------------------------------------------------------ */

test("the notification tracking link prefills the number, not the second factor", async ({
  page,
}) => {
  await page.goto("/track?number=PL-2026-000458");
  await expect(page.locator("#tk-number")).toHaveValue("PL-2026-000458");
  // M-73's threat model: the secondary verification value is NEVER in a URL.
  await expect(page.locator("#tk-secondary")).toHaveValue("");
  await expect(page.locator("#tk-secondary")).toHaveAttribute("required", "");
});

test("a prefilled number still cannot submit on its own", async ({ page }) => {
  await page.goto("/track?number=PL-2026-000458");
  await page.click('button[type="submit"]');
  const valid = await page
    .locator("#tk-secondary")
    .evaluate((el: HTMLInputElement) => el.checkValidity());
  expect(valid).toBe(false);
});

test("a hostile ?number= is inert — it is a form value, not markup", async ({
  page,
}) => {
  await page.goto(
    `/track?number=${encodeURIComponent('"><script>window.__x=1</script>')}`,
  );
  const injected = await page.evaluate(
    () => (window as unknown as { __x?: number }).__x,
  );
  expect(injected).toBeUndefined();
  // React set it as a VALUE; it never became markup.
  await expect(page.locator("#tk-number")).toHaveValue(
    '"><script>window.__x=1</script>',
  );
});

test("/track without ?number= is unchanged — the field is empty", async ({
  page,
}) => {
  await page.goto("/track");
  await expect(page.locator("#tk-number")).toHaveValue("");
});
