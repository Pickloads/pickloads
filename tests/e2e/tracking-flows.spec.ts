import { expect, test } from "@playwright/test";

/**
 * M-84 — §27's five named E2E flows, as ROUTES, in a real browser.
 *
 * ── WHAT THIS FILE IS FOR, AND WHAT IT DELIBERATELY IS NOT ────────────────
 *
 * The flows themselves — the shipper walk, the dispatcher walk, the carrier
 * walk, the public lookup, the six security refusals — are proved in
 * `tests/integration/tracking-flows.test.ts` against a real PostgreSQL 16 with
 * real sessions, real policies and the real functions from `src/`. They are
 * proved there because they can only be proved there: this lane runs
 * `next start` on PLACEHOLDER credentials (M-41), so there is no Supabase, no
 * service-role key and no way to mint a session. Producing "shipper opens
 * their shipment" here would mean seeding a fabricated shipment into the
 * product, which §30 forbids in the same breath as fake GPS and fake ETAs.
 *
 * What a browser CAN prove, and nothing else in the suite does, is the
 * skeleton every flow walks on:
 *
 *   1. **Every route each flow traverses exists in the built app.** A flow
 *      whose third step 404s is broken however green its query tests are.
 *      Route existence is a build-time fact, and this is the only lane that
 *      observes the build.
 *
 *   2. **Each route's gate is the RIGHT gate.** Three kinds live side by
 *      side — public (`/track`), session-gated (`/portal/**`), and
 *      bearer-credential (`/driver/update/[token]`) — and the failure that
 *      matters is a portal route quietly becoming public. Asserting the gate
 *      per route, per flow, is a cheap standing check against exactly that.
 *
 *   3. **The public flow's refusal is safe in the rendered page**, not merely
 *      in the returned object: no shipment data, no hint of which factor was
 *      wrong, nothing in the HTML that names a financial field.
 *
 * The five flows are named as `describe` blocks, in §27's own words and order,
 * so a reader comparing the directive to the suite can do it by eye.
 */

/* ------------------------------------------------------------------ *
 * Gates
 * ------------------------------------------------------------------ */

/** A route only a signed-in user may reach: it must bounce, preserving `next`. */
async function expectSessionGated(
  page: import("@playwright/test").Page,
  path: string,
): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status(), `${path} must not 404`).toBeLessThan(400);
  await expect(page, `${path} must bounce to /login`).toHaveURL(/\/login\?next=/);
  const next = new URL(page.url()).searchParams.get("next");
  expect(next, `${path} must preserve its destination`).toContain(
    path.split("?")[0],
  );
}

/** A route anyone may reach: it must render, and it must not be a 404 shell. */
async function expectPublic(
  page: import("@playwright/test").Page,
  path: string,
): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status(), `${path} must render`).toBeLessThan(400);
  await expect(page.locator("main#main")).toBeVisible();
}

/**
 * Values that must never appear in HTML the browser can reach without a
 * session.
 *
 * COLUMN NAMES, not UI labels, and the distinction is the whole point. There
 * are no real amounts in this lane, so an amount sweep would prove nothing;
 * a column name in the markup is the artefact that precedes a leak, because
 * it means a staff-shaped row reached a public serializer.
 *
 * `rate_confirmation` is deliberately ABSENT from this list even though it
 * reads like a match. It is a document-type LABEL ("Carrier rate
 * confirmation") that next-intl ships in the message payload of every page;
 * a label is not a value, and asserting against it would fail on a string
 * that is doing its job. The payload's breadth is recorded as an observation
 * in `docs/modules/M-84-e2e-docs-launch.md` rather than pretended away here.
 */
const FINANCIAL_TOKENS = [
  "carrier_pay",
  "gross_shipper_amount",
  "delay_reason_internal",
  "margin_cents",
  "shipper_reference",
];

/* ================================================================== *
 * §27 · Shipper flow
 * Login → view shipments → open shipment → view timeline → download POD
 * → submit support message
 * ================================================================== */

test.describe("§27 shipper flow — every route exists and every one is session-gated", () => {
  const SHIPMENT_ID = "11111111-1111-1111-1111-111111111111";

  test("the whole walk bounces to login, step by step, in order", async ({
    page,
  }) => {
    // Steps 1–4 and 6. The POD download (step 5) is a server action reached
    // from the detail page, so its route IS the detail page; the action's own
    // three gates are proved in the integration lane.
    for (const path of [
      "/portal/shipper", // 1 · login lands here
      "/portal/shipper/shipments", // 2 · view shipments
      `/portal/shipper/shipments/${SHIPMENT_ID}`, // 3 · open shipment (4 · timeline is on it)
      "/portal/shipper/support", // 6 · submit support message
    ]) {
      await expectSessionGated(page, path);
    }
  });

  test("a malformed shipment id is bounced by the SESSION gate, not by a 500", async ({
    page,
  }) => {
    // Order matters: authentication has to run in front of validation, or a
    // stranger learns which ids parse.
    await expectSessionGated(page, "/portal/shipper/shipments/not-a-uuid");
  });
});

/* ================================================================== *
 * §27 · Public tracking flow
 * Enter tracking number → enter secondary verification → view approved
 * public shipment data → invalid access fails safely
 * ================================================================== */

test.describe("§27 public tracking flow — two factors in, one honest refusal out", () => {
  test("step 1+2 — the page asks for BOTH factors and requires both", async ({
    page,
  }) => {
    await expectPublic(page, "/track");
    await expect(page.locator("#tk-number")).toHaveAttribute("required", "");
    await expect(page.locator("#tk-secondary")).toHaveAttribute("required", "");
  });

  test("step 4 — an invalid lookup fails safely IN THE RENDERED PAGE", async ({
    page,
  }) => {
    await page.goto("/track");
    await page.fill("#tk-number", "PL-2026-999999");
    await page.fill("#tk-secondary", "99999");
    await page.click('button[type="submit"]');

    // Something must come back — a refusal or the honest "unavailable" this
    // lane produces without a database. Either way: no shipment, no leak.
    await expect(page.locator("main#main")).toBeVisible();
    const html = (await page.locator("main#main").innerHTML()).toLowerCase();
    for (const token of FINANCIAL_TOKENS) {
      expect(html, `the refused page named ${token}`).not.toContain(token);
    }
    // No timeline, no status chip, nothing that would imply the number exists.
    await expect(page.locator("[data-testid='tracking-result']")).toHaveCount(0);
  });

  test("with scripting off the page says so and gives a phone number (M-84)", async ({
    page,
  }) => {
    // HONEST STATEMENT OF A LIMIT, asserted rather than assumed. The form is
    // a client component reading `?number=` through `useSearchParams`, so
    // Next.js renders it on the client and it is genuinely NOT in the static
    // HTML — verified here, not guessed:
    const response = await page.goto("/track");
    const html = (await response?.text()) ?? "";
    expect(html, "the form is client-rendered — this is the premise").not.toContain(
      'id="tk-number"',
    );

    // …which is why the server-rendered <noscript> block has to exist. A
    // heading that promises a lookup over an empty panel is a false statement
    // made by omission (§30).
    expect(html).toContain("<noscript>");
    expect(html).toContain("(908) 404-5373");

    // And with scripting ON, the form is there — so the noscript block is a
    // fallback and not the product.
    await expect(page.locator("#tk-number")).toBeVisible();
  });
});

/* ================================================================== *
 * §27 · Dispatcher flow
 * Create shipment → assign carrier → update pickup status → record delay
 * → update ETA → mark delivered → request POD → complete shipment
 * ================================================================== */

test.describe("§27 dispatcher flow — the operational surfaces exist and are staff-gated", () => {
  test("board, create form and detail all bounce", async ({ page }) => {
    for (const path of [
      "/portal/admin/shipments", // board (steps 3–8 act from here)
      "/portal/admin/shipments/new", // step 1 · create shipment
      "/portal/admin/shipments/11111111-1111-1111-1111-111111111111", // step 2+
    ]) {
      await expectSessionGated(page, path);
    }
  });
});

/* ================================================================== *
 * §27 · Carrier flow
 * Login → view assigned shipment → update en route → confirm pickup
 * → upload BOL → mark delivered → upload POD
 * ================================================================== */

test.describe("§27 carrier flow — portal routes gated, driver link bearer-gated", () => {
  test("the carrier portal walk bounces to login", async ({ page }) => {
    for (const path of [
      "/portal/carrier",
      "/portal/carrier/shipments",
      "/portal/carrier/shipments/11111111-1111-1111-1111-111111111111",
    ]) {
      await expectSessionGated(page, path);
    }
  });

  test("the driver link is a BEARER route — no session, no leak, no 404 oracle", async ({
    page,
  }) => {
    // §13: a driver has no account. The route must therefore NOT bounce to
    // login (that would make the link unusable) and must NOT confirm whether
    // a token exists (that would make it enumerable).
    // SEQUENTIALLY — one `page` cannot serve three concurrent navigations,
    // and a racing `Promise.all` here compares whichever document happened to
    // win rather than three separate answers.
    const responses: {
      path: string;
      status: number;
      url: string;
      body: string;
    }[] = [];
    for (const path of [
      "/driver/update/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "/driver/update/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "/driver/update/short",
    ]) {
      const res = await page.goto(path);
      responses.push({
        path,
        status: res?.status() ?? 0,
        url: page.url(),
        body: (await page.locator("body").innerText()).trim(),
      });
    }

    for (const r of responses) {
      expect(r.url, `${r.path} must not bounce to login`).not.toMatch(/\/login/);
    }
    // Every refusal renders the same page. A well-formed unknown token and a
    // malformed one must be indistinguishable to the person holding them.
    const [first, second, malformed] = responses;
    expect(first?.status).toBe(second?.status);
    expect(first?.body).toBe(second?.body);
    expect(malformed?.body).toBe(first?.body);
  });
});

/* ================================================================== *
 * §27 · Security flow
 * The browser-observable half. The six refusals themselves are proved in
 * tests/integration/tracking-flows.test.ts, under real sessions.
 * ================================================================== */

test.describe("§27 security flow — what a browser alone can prove", () => {
  test("no tracking surface is reachable without its gate", async ({ page }) => {
    // The complete list of shipment-bearing routes. If a new one is added
    // without a gate, this fails — which is the point of enumerating them
    // here rather than trusting the middleware matcher.
    for (const path of [
      "/portal/shipper/shipments",
      "/portal/carrier/shipments",
      "/portal/broker/shipments",
      "/portal/admin/shipments",
    ]) {
      await expectSessionGated(page, path);
    }
  });

  test("the public tracking page exposes no financial vocabulary at all", async ({
    page,
  }) => {
    const response = await page.goto("/track");
    const html = ((await response?.text()) ?? "").toLowerCase();
    for (const token of FINANCIAL_TOKENS) {
      expect(html, `/track shipped the token ${token}`).not.toContain(token);
    }
  });

  test("§30 — /track makes no 'live tracking' claim and no AI claim", async ({
    page,
  }) => {
    await page.goto("/track");
    const text = (await page.locator("main#main").innerText()).toLowerCase();
    // The forbidden claims. "Live location available" IS permitted by §30 as
    // a label; "live tracking" as a product claim is not, while updates are
    // manual.
    expect(text).not.toContain("live tracking");
    expect(text).not.toContain("ai-powered");
    expect(text).not.toContain("ai powered");
  });
});
