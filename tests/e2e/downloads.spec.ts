import { expect, test } from "@playwright/test";

/**
 * Downloads Center — the boundary proofs, in a real browser.
 *
 * The unit suite proves the MODEL is safe. This proves the rendered page is:
 * that nothing on it hands a visitor a storage path, a signed URL or a private
 * document, and that following its links lands on the auth wall rather than on
 * somebody's insurance certificate.
 */

/** Substrings that must never appear in the public HTML of this page. */
const NEVER_IN_PUBLIC_HTML = [
  "createSignedUrl",
  "supabase.co/storage",
  "/storage/v1/object",
  "service_role",
  "token=",
  "X-Amz-Signature",
  ".pdf",
];

test.describe("Downloads Center", () => {
  test("renders the tiers without a single download control", async ({
    page,
  }) => {
    await page.goto("/downloads");
    await expect(page.locator("h1")).toBeVisible();

    // No file is hosted, so nothing may claim to download one.
    expect(await page.locator("main a[download]").count()).toBe(0);
    // And no control that looks clickable but is not.
    expect(await page.locator('main a[href="#"]').count()).toBe(0);
  });

  test("leaks no storage path, signed URL or credential into the HTML", async ({
    page,
  }) => {
    await page.goto("/downloads");
    const html = await page.content();
    for (const needle of NEVER_IN_PUBLIC_HTML) {
      expect(html, `public HTML contains ${needle}`).not.toContain(needle);
    }
  });

  test("NON-VACUITY: the sweep would catch a leaked storage URL", () => {
    const leaked =
      '<a href="https://x.supabase.co/storage/v1/object/sign/docs/w9.pdf?token=abc">W-9</a>';
    expect(NEVER_IN_PUBLIC_HTML.some((n) => leaked.includes(n))).toBe(true);
  });

  test("every outbound link is a portal ROUTE, never a file", async ({
    page,
  }) => {
    await page.goto("/downloads");
    const hrefs = await page
      .locator("main a[href]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).not.toMatch(/\.(pdf|docx?|xlsx?|zip|csv)$/i);
      expect(href).not.toMatch(/^https?:\/\/(?!.*pickloads)/);
    }
  });

  test("an authenticated destination bounces an anonymous visitor to login", async ({
    page,
  }) => {
    await page.goto("/downloads");
    const portalLink = page.locator('main a[href*="/portal/"]').first();
    await expect(portalLink).toBeVisible();
    await portalLink.click();
    // The portal's own middleware decides — this page grants nothing.
    await expect(page).toHaveURL(/\/login/);
  });

  test("OFFERS no private document publicly — describing one is fine", async ({
    page,
  }) => {
    await page.goto("/downloads");
    const publicSection = page.locator("#public-resources");

    // The distinction this test exists to draw, and the first version got it
    // wrong: telling a carrier to BRING a W-9 is necessary and explicitly
    // permitted ("may explain required documents without making the actual
    // sensitive document public"). OFFERING w-9.pdf is not. Prose is fine;
    // an offer is not. So this checks the OFFERS — the resource headings and
    // the links — never the body text.
    const offers = [
      ...(await publicSection.locator("h3").allTextContents()),
      ...(await publicSection
        .locator("a[href]")
        .evaluateAll((els) => els.map((e) => `${e.textContent} ${e.getAttribute("href")}`))),
    ]
      .join(" ")
      .toLowerCase();

    for (const term of [
      "w-9",
      "insurance certificate",
      "bill of lading",
      "proof of delivery",
      "rate confirmation",
      "invoice",
      "factoring",
      "dispatch agreement",
    ]) {
      expect(offers, `public tier OFFERS ${term}`).not.toContain(term);
    }

    // Non-vacuity: there really is a public offer heading to inspect.
    expect(await publicSection.locator("h3").count()).toBeGreaterThan(0);
  });

  test("offers no legal agreement as a finished document", async ({ page }) => {
    await page.goto("/downloads");
    const html = (await page.content()).toLowerCase();
    // docs/LEGAL-DOCUMENTS-REQUIRED.md: all of these are COUNSEL REVIEW
    // REQUIRED with no approved content. None may be downloadable.
    for (const doc of [
      "dispatch-agreement.pdf",
      "carrier-agreement.pdf",
      "terms.pdf",
      "privacy.pdf",
    ]) {
      expect(html).not.toContain(doc);
    }
  });

  test("the packet download path is not exposed while the gate is closed", async ({
    page,
  }) => {
    await page.goto("/downloads");
    const html = await page.content();
    expect(html).not.toContain("/packet/");
  });

  test("private documents are described but never linked", async ({ page }) => {
    await page.goto("/downloads");
    const priv = page.locator("#private-documents");
    await expect(priv).toBeVisible();
    // Explains where they live; offers no route of its own.
    expect(await priv.locator("a").count()).toBe(0);
  });

  test("is in the sitemap and reachable from the nav", async ({
    page,
    request,
  }) => {
    const res = await request.get("/sitemap.xml");
    expect(await res.text()).toContain("/downloads");

    await page.goto("/");
    const links = await page
      .locator("nav.sitenav a")
      .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    expect(links.some((h) => h.includes("/downloads"))).toBe(true);
  });
});
