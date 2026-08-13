import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * M-90 — proof that the five locales actually RENDER, not just that the
 * catalogues contain strings.
 *
 * ── WHY A RENDERED-OUTPUT SUITE AND NOT MORE CATALOGUE ASSERTIONS ────────
 *
 * The bug this repairs was invisible to every catalogue test in the repo, and
 * it would have been invisible to any number of new ones. `fr.json` was 98%
 * translated and the French page still showed an English navigation, English
 * page title, English process diagram and English carrier wizard — because
 * those strings had no key at all, so `useV4()` fell back to the English
 * literal it was handed. Comparing `fr.json` to `en.json` cannot see a string
 * that is in neither.
 *
 * `tests/unit/i18n-key-coverage.test.ts` closes that from the source side.
 * This file closes it from the only side a customer experiences: what the
 * browser paints. Every assertion below is a specific translated string that
 * must be on the page — so a future regression that reintroduces the silent
 * fallback fails here with the English text in the diff.
 *
 * ── WHY THE ASSERTIONS NAME EXACT STRINGS ────────────────────────────────
 *
 * A weaker test ("the page differs from /en") passes on a page that is 3%
 * translated. These name the nav, the H1, the `<title>` and the footer —
 * chrome that appears on every route — because the failure mode is a REGION of
 * the page reverting, not the whole thing.
 */

/** Reads one catalogue's `v4` namespace. Throws on a key the fixture names
 *  but the catalogue lacks — a silently-undefined expectation would make the
 *  leakage assertions below pass without testing anything. */
function catalogue(locale: string): Record<string, string> {
  return JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).v4;
}

function phrase(locale: string, key: string): string {
  const value = catalogue(locale)[key];
  if (typeof value !== "string") {
    throw new Error(`messages/${locale}.json has no v4 key "${key}"`);
  }
  return value;
}

/** The representative public routes named in the M-90 brief. */
const ROUTES = [
  "/",
  "/dispatch-services",
  "/become-a-carrier",
  "/request-a-quote",
  "/knowledge-base",
  "/contact",
  "/login",
] as const;

const LOCALES = ["en", "fr", "es", "ht", "ru"] as const;

/** `as-needed` prefixing: en lives at the bare path, everything else prefixed. */
const url = (locale: string, route: string) =>
  locale === "en" ? route : `/${locale}${route === "/" ? "" : route}`;

test.describe("locale routing", () => {
  for (const locale of LOCALES) {
    for (const route of ROUTES) {
      test(`${url(locale, route)} renders (no 404, no redirect to English)`, async ({
        page,
      }) => {
        const response = await page.goto(url(locale, route));
        expect(response?.status(), `${url(locale, route)} status`).toBe(200);
        // The redirect-back-to-/en failure mode: the URL after navigation must
        // still carry the locale the visitor asked for.
        const path = new URL(page.url()).pathname;
        if (locale === "en") {
          expect(path.startsWith("/en")).toBe(false);
        } else {
          expect(path.startsWith(`/${locale}`)).toBe(true);
        }
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
      });
    }
  }

  test("/en redirects to the unprefixed route rather than 404ing", async ({
    page,
  }) => {
    // `localePrefix: "as-needed"` means /en is not a route — it is a redirect.
    // Asserted explicitly because "the default locale 404s" is a classic
    // as-needed misconfiguration and it would look identical to a broken link.
    const response = await page.goto("/en/dispatch-services");
    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe("/dispatch-services");
  });
});

test.describe("translated copy actually renders", () => {
  /**
   * Nav, H1 and title on the home page. These strings are in the catalogue
   * for all four non-English locales — if any of them renders English, the
   * bridge has regressed.
   */
  //
  // `nav` is a NAV_GROUPS label, `util` a NAV_UTILITIES label — both reach
  // tv() through site-nav.ts, which is the path that had no catalogue keys at
  // all. Deliberately NOT the primary CTA: "Request a quote" is still
  // untranslated in ht and ru (a pre-existing gap on the M-84 baseline, not
  // something M-90 introduced), so asserting on it would either fail honestly
  // or force a fabricated translation to make a test green.
  const HOME = {
    fr: {
      nav: "Ressources",
      util: "Suivi d'expédition",
      h1: "Votre camion reste",
    },
    es: { nav: "Recursos", util: "Rastrear envío", h1: "Tu camión siempre" },
    ht: { nav: "Resous", util: "Swiv chajman", h1: "Kamyon w toujou" },
    ru: { nav: "Материалы", util: "Отследить груз", h1: "Ваш грузовик всегда" },
  } as const;

  for (const [locale, expected] of Object.entries(HOME)) {
    test(`/${locale} renders ${locale.toUpperCase()} navigation and hero`, async ({
      page,
    }) => {
      await page.goto(`/${locale}`);
      await expect(page.locator(".hero h1")).toContainText(expected.h1);
      // The navigation was the single largest untranslated region: it reaches
      // tv() through site-nav.ts, so a source scan for tv("…") never saw it.
      //
      // The two selectors are structural on purpose. A group header is
      // `.navgroup > a`; a utility is a DIRECT child anchor of `.navlinks`.
      // Matching on text alone finds the copy inside `.navpanel`, which is
      // `display: none` until the group is opened — so the assertion would
      // fail on a correctly translated page. ("Track Shipment" is both a
      // Shippers panel entry and a top-level utility, which is how that bites.)
      await expect(
        page.locator(".navlinks .navgroup > a", { hasText: expected.nav }),
      ).toBeVisible();
      await expect(
        page.locator(".navlinks > a", { hasText: expected.util }),
      ).toBeVisible();
    });
  }

  test("the process flow strip translates (it was bare JSX text)", async ({
    page,
  }) => {
    await page.goto("/fr");
    // The home page carries two `.flow` strips — the dispatch process and the
    // New Authority timeline. This test is about the first.
    const flow = page.locator(".flow").first();
    await expect(flow.locator(".flow-title")).toContainText("Notre processus");
    await expect(flow.getByText("DISPATCHER DÉDIÉ")).toBeVisible();
    await expect(flow.getByText("DEDICATED DISPATCHER")).toHaveCount(0);
  });

  test("the pricing table translates every plan name, not two of three", async ({
    page,
  }) => {
    await page.goto("/es");
    await expect(page.locator(".pricing-grid .plan h3").nth(1)).toHaveText(
      "Flota Pequeña",
    );
    await expect(page.locator(".pricing-note")).toContainText(
      "Los porcentajes",
    );
  });

  test("the language selector announces itself in the current locale", async ({
    page,
  }) => {
    await page.goto("/fr");
    await expect(page.getByLabel("Langue")).toBeVisible();
  });
});

test.describe("no English leakage for a key that IS translated", () => {
  /**
   * The strongest available assertion, and the one that directly encodes the
   * brief: for FR and ES, take strings the catalogue translates and prove the
   * English version is absent from the rendered page. A page that "mostly"
   * switches is the exact symptom that was reported.
   */
  //
  // Every pair below was verified against the real render before being
  // committed. Two candidates were REMOVED rather than forced, and both are
  // worth knowing about:
  //
  //   • `new_authority_program` on /fr — the French copy deliberately keeps
  //     the programme's proper name in English inside a French sentence
  //     ("Notre New Authority Program gère les démarches…"). The English
  //     phrase is legitimately on the page, so "English must be absent" is
  //     the wrong assertion for it, not a finding.
  //   • `how_can_we_help` on /contact — it is a `placeholder` attribute.
  //     It IS translated; body text assertions simply cannot see it.
  const SAMPLES: Record<string, ReadonlyArray<readonly [string, string]>> = {
    fr: [
      ["/", "track_shipment"],
      ["/", "resources"],
      ["/dispatch-services", "how_it_works"],
      ["/become-a-carrier", "company_info"],
      ["/request-a-quote", "how_it_works"],
      ["/contact", "your_name"],
      ["/login", "forgot_password"],
    ],
    es: [
      ["/", "track_shipment"],
      ["/", "resources"],
      ["/", "downloads"],
      ["/dispatch-services", "what_your_dispatcher_handles"],
      ["/become-a-carrier", "company_info"],
      ["/knowledge-base", "all_topics"],
    ],
  };

  for (const [locale, samples] of Object.entries(SAMPLES)) {
    for (const [route, key] of samples) {
      test(`${url(locale, route)} shows "${key}" in ${locale}, not English`, async ({
        page,
      }) => {
        const english = phrase("en", key);
        const translated = phrase(locale, key);
        // Guard the fixture itself: a key that happens to be identical in both
        // languages would make this assertion vacuous.
        expect(
          translated,
          `${key} must differ between en and ${locale} for this test to mean anything`,
        ).not.toBe(english);

        await page.goto(url(locale, route));
        const body = page.locator("body");
        await expect(body).toContainText(translated);
        await expect(body).not.toContainText(english);
      });
    }
  }
});

test.describe("language selector", () => {
  const switchTo = async (page: Page, locale: string, expectedPath: string) => {
    // Wait on the EXACT destination path. An earlier version waited on a
    // predicate ("not /fr and not /es"), which was already true of /ru while
    // switching ru→en, so it returned before the navigation and the assertion
    // read the old URL. If you are asserting where you landed, wait for
    // exactly there.
    await page.locator("select.langsel").selectOption(locale);
    await page.waitForURL((u) => u.pathname === expectedPath);
  };

  test("switching locale preserves the current route", async ({ page }) => {
    await page.goto("/dispatch-services");
    await switchTo(page, "fr", "/fr/dispatch-services");
    expect(new URL(page.url()).pathname).toBe("/fr/dispatch-services");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");

    // …and again, from a non-default locale to another non-default locale.
    await switchTo(page, "ru", "/ru/dispatch-services");
    expect(new URL(page.url()).pathname).toBe("/ru/dispatch-services");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");

    // …and back to the default, which un-prefixes rather than 404s.
    await switchTo(page, "en", "/dispatch-services");
    expect(new URL(page.url()).pathname).toBe("/dispatch-services");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("the selector shows the locale actually being rendered", async ({
    page,
  }) => {
    await page.goto("/ht/contact");
    await expect(page.locator("select.langsel")).toHaveValue("ht");
  });

  test("switching produces no hydration error and no stale English render", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/become-a-carrier");
    await switchTo(page, "es", "/es/become-a-carrier");
    // The nav is server-rendered chrome — if a cached English payload were
    // served for the Spanish URL, this is where it would show.
    await expect(
      page.locator(".navlinks").getByText("Recursos", { exact: true }),
    ).toBeVisible();
    expect(
      errors.filter((e) =>
        /hydrat|did not match|Minified React error/i.test(e),
      ),
      "hydration errors after locale switch",
    ).toEqual([]);
  });
});

test.describe("metadata", () => {
  test("title and description are localized, not English on a French page", async ({
    page,
  }) => {
    await page.goto("/fr/dispatch-services");
    await expect(page).toHaveTitle(/Services de dispatch camion/);
    const description = await page
      .locator('meta[name="description"]')
      .getAttribute("content");
    expect(description).toContain("Du dispatch sous votre propre autorité");
    // Open Graph carries the same localized copy — it is what a shared link
    // renders as, and it was English on every locale before M-90.
    const og = await page
      .locator('meta[property="og:title"]')
      .getAttribute("content");
    expect(og).toContain("Services de dispatch camion");
  });

  test("hreflang covers all five locales plus x-default on every locale", async ({
    page,
  }) => {
    for (const locale of LOCALES) {
      await page.goto(url(locale, "/dispatch-services"));
      const links = page.locator('link[rel="alternate"][hreflang]');
      const pairs = await links.evaluateAll((els) =>
        els.map((e) => [
          e.getAttribute("hreflang"),
          new URL((e as HTMLLinkElement).href).pathname,
        ]),
      );
      expect(Object.fromEntries(pairs)).toEqual({
        en: "/dispatch-services",
        es: "/es/dispatch-services",
        fr: "/fr/dispatch-services",
        ru: "/ru/dispatch-services",
        ht: "/ht/dispatch-services",
        "x-default": "/dispatch-services",
      });
    }
  });

  test("canonical points at the locale being viewed, not at English", async ({
    page,
  }) => {
    await page.goto("/ru/contact");
    const canonical = await page
      .locator('link[rel="canonical"]')
      .getAttribute("href");
    expect(new URL(canonical!).pathname).toBe("/ru/contact");
  });

  test("the sitemap lists every route in every locale", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    for (const locale of LOCALES) {
      expect(xml).toContain(`${url(locale, "/dispatch-services")}</loc>`);
    }
    expect(xml).toContain('hreflang="x-default"');
  });
});
