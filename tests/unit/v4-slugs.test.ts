import { describe, expect, it } from "vitest";
import { slugifyV4 } from "@/i18n/v4";
import enCatalog from "../../messages/en.json";
import esCatalog from "../../messages/es.json";

/**
 * slugifyV4 (runtime key lookup) must produce the exact same slugs as
 * scripts/extract-i18n.mjs (catalog generation) — the two are copies of one
 * algorithm. These tests pin the algorithm AND prove that real component
 * strings resolve to keys present in the generated en/es catalogs.
 */

const en: Record<string, string> = enCatalog.v4;
const es: Record<string, string> = esCatalog.v4;

describe("slugifyV4 algorithm", () => {
  it("lowercases and collapses punctuation runs to single underscores", () => {
    expect(slugifyV4("Need a dispatcher?")).toBe("need_a_dispatcher");
    expect(slugifyV4("One flat percentage. Nothing hidden.")).toBe(
      "one_flat_percentage_nothing_hidden",
    );
  });

  it("strips HTML tags and maps &amp; to and", () => {
    expect(slugifyV4("Load booking <b>fast</b>")).toBe("load_booking_fast");
    expect(slugifyV4("Dry Van &amp; Reefer")).toBe("dry_van_and_reefer");
  });

  it("truncates at 56 chars without a trailing underscore", () => {
    const long =
      "Tell us about your operation — we respond fast, typically within the hour during business hours.";
    const key = slugifyV4(long);
    expect(key.length).toBeLessThanOrEqual(56);
    expect(key.endsWith("_")).toBe(false);
    expect(key).toBe(
      "tell_us_about_your_operation_we_respond_fast_typically_w",
    );
  });

  it("falls back to 's' for empty/symbol-only input", () => {
    expect(slugifyV4("")).toBe("s");
    expect(slugifyV4("→ · —")).toBe("s");
  });
});

describe("component strings resolve in the generated catalogs", () => {
  const knownStrings = [
    "Need a dispatcher?", // QuickQuote heading
    "Pricing", // Pricing eyebrow
    "One flat percentage. Nothing hidden.", // Pricing heading
    "Straight answers. No fine print.", // FAQ hero
    "Become a Carrier", // nav / login link
    "Tell us about your operation — we respond fast, typically within the hour during business hours.",
  ];

  for (const source of knownStrings) {
    it(`"${source.slice(0, 44)}…" resolves in en + es`, () => {
      const key = slugifyV4(source);
      expect(en[key], `missing en key ${key}`).toBeTruthy();
      expect(es[key], `missing es key ${key}`).toBeTruthy();
    });
  }

  it("es catalog actually translates the quick-quote heading", () => {
    expect(es[slugifyV4("Need a dispatcher?")]).toBe(
      "¿Necesitas un dispatcher?",
    );
    expect(en[slugifyV4("Need a dispatcher?")]).toBe("Need a dispatcher?");
  });

  it("rich hero keys exist in both catalogs", () => {
    expect(en["rich_hero_title"]).toContain("<em>loaded</em>");
    expect(es["rich_hero_title"]).toContain("<em>cargado</em>");
  });

  it("en and es catalogs cover the identical key set", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });
});
