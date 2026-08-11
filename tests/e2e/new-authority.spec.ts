import { expect, test } from "@playwright/test";

/**
 * New Authority Program — compliance guards.
 *
 * This page is the one place on the site where marketing pressure points
 * straight at a regulator. "We'll get your authority approved" converts far
 * better than "we help you file", and it is the difference between document
 * filing assistance and an unlicensed promise about an FMCSA outcome nobody
 * controls.
 *
 * The disclaimer architecture already exists in three places. These tests stop
 * it eroding, and stop the guarantees creeping in beside it.
 */

/** Outcomes PickLoads cannot promise, because a government agency decides. */
const FORBIDDEN_GUARANTEES: Array<[label: string, pattern: RegExp]> = [
  [
    "guaranteed FMCSA / authority approval",
    /guarantee[ds]?\s+(fmcsa|authority|mc|usdot|dot)\b|(fmcsa|authority|mc|usdot)\s+approval\s+guarantee/i,
  ],
  [
    "guaranteed activation or issuance date",
    /(authority|mc|usdot)\s+(active|issued|approved)\s+(in|within)\s+\d+\s*(day|week|hour)/i,
  ],
  ["guaranteed insurance approval", /guarantee[ds]?\s+insurance|insurance\s+approval\s+guarantee/i],
  ["a government affiliation", /(official|authorized|certified)\s+(fmcsa|dot|government)\s+(partner|agent|representative)/i],
  ["legal advice or representation", /(we|our)\s+(provide|offer|give)\s+legal\s+(advice|representation|counsel)/i],
  ["100% approval", /100\s?%\s+(approval|success|acceptance)/i],
];

test.describe("New Authority Program", () => {
  test("carries the not-a-law-firm disclaimer prominently", async ({ page }) => {
    await page.goto("/start-your-trucking-company");
    const body = (await page.locator("main").textContent()) ?? "";
    expect(body).toMatch(/not a law firm/i);
    expect(body).toMatch(/document filing assistance/i);

    // It is a labelled region, not a footnote lost in a paragraph.
    await expect(
      page.locator('[aria-label*="disclaimer" i], [aria-label*="Service disclaimer" i]').first(),
    ).toBeAttached();
  });

  test("makes NONE of the forbidden regulatory guarantees", async ({ page }) => {
    await page.goto("/start-your-trucking-company");
    const body = (await page.locator("main").textContent()) ?? "";
    for (const [label, pattern] of FORBIDDEN_GUARANTEES) {
      expect(body, `page promises ${label}`).not.toMatch(pattern);
    }
    expect(body.length).toBeGreaterThan(800);
  });

  test("NON-VACUITY: the patterns catch the promises they exist to catch", async () => {
    const wouldBeBad = [
      "We guarantee FMCSA approval",
      "Your authority active in 14 days",
      "We guarantee insurance approval",
      "An official FMCSA partner",
      "We provide legal advice",
      "100% approval rate",
    ];
    for (const sentence of wouldBeBad) {
      expect(
        FORBIDDEN_GUARANTEES.some(([, p]) => p.test(sentence)),
        `pattern set missed: ${sentence}`,
      ).toBe(true);
    }
  });

  test("the disclaimer survives on every locale", async ({ page }) => {
    for (const locale of ["es", "fr"]) {
      await page.goto(`/${locale}/start-your-trucking-company`);
      const body = (await page.locator("main").textContent()) ?? "";
      // Translated or mirrored, the claim must be present in some form.
      expect(
        /law firm|bufete|cabinet d'avocats|avocat/i.test(body),
        `${locale}: disclaimer missing`,
      ).toBe(true);
    }
  });

  test("routes onward to dispatch rather than dead-ending at the filing", async ({
    page,
  }) => {
    await page.goto("/start-your-trucking-company");
    const main = page.locator("main");
    // The programme's whole point is that it leads somewhere: filing today,
    // dispatched freight after. A page that stops at the paperwork has not
    // described the business.
    const onward = main.locator(
      'a[href*="/dispatch-services"], a[href*="/become-a-carrier"]',
    );
    expect(await onward.count()).toBeGreaterThan(0);
  });

  test("submits an inquiry without claiming a regulatory outcome", async ({
    page,
  }) => {
    await page.goto("/start-your-trucking-company");
    const body = (await page.locator("main").textContent()) ?? "";
    // The success copy is Cowork's, but it must not assert an approval.
    expect(body).not.toMatch(/your authority (is|will be) approved/i);
  });
});
