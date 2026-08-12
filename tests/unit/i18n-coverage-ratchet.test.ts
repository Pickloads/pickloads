import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * M-84 — translation coverage for the tracking surfaces, measured and pinned.
 *
 * ── THE FINDING THIS EXISTS TO STOP HIDING ────────────────────────────────
 *
 * The §30 honest-label sweep turned over a much larger stone. Of the 411
 * authored strings in the `shipment.*` namespace — the public `/track` page,
 * the shipper portal, the driver page, the carrier surfaces, every
 * notification body — **363 are still the English text in `ru.json` and
 * `ht.json`.** Russian and Haitian Creole customers read the tracking system
 * in English. `es` and `fr` are essentially complete.
 *
 * That is a real §24 defect and it is not one a test can fix. Translating 726
 * strings is a translation project with a review step, not a code change, and
 * doing it unreviewed in a logistics and legal context is how you ship
 * something worse than an honest gap.
 *
 * So this file does the two things that ARE available:
 *
 *   1. **Measures it**, so the number is a fact in the build output rather
 *      than a thing somebody might notice.
 *   2. **Ratchets it**, so coverage can improve and cannot regress. Adding a
 *      new English-only string to a namespace fails here, which means the
 *      gap stops growing while it waits for a translator.
 *
 * The gap is recorded in `docs/TRACKING-ACCEPTANCE.md` (criterion 2 and the
 * open-items list) and in `docs/modules/M-84-e2e-docs-launch.md`. Nothing here
 * pretends it is closed.
 *
 * ── HOW "UNTRANSLATED" IS DECIDED ─────────────────────────────────────────
 *
 * A value byte-identical to the English one. That over-counts by a handful of
 * strings that are legitimately the same in two languages ("PickLoads", "MC",
 * "POD", "24/7"), which is why the baselines below are ceilings measured from
 * the real files rather than zero. It never UNDER-counts, and for a ratchet
 * that is the direction that matters.
 */

const LOCALES = ["es", "fr", "ru", "ht"] as const;

/**
 * The worst each locale is allowed to be, per namespace. Measured at M-84.
 * **Lower these when a translation lands. Never raise one** — a raised
 * baseline is the gap growing, which is the thing this file exists to catch.
 */
const MAX_UNTRANSLATED: Record<string, Record<string, number>> = {
  // 411 authored strings. `ru`/`ht` are essentially untranslated.
  shipment: { es: 2, fr: 7, ru: 363, ht: 363 },
  // 750 authored strings — the marketing site. The same two locales, the
  // same shape of gap, and it predates the tracking work.
  // ru/ht raised by 3 on 2026-08-11 (final-site: response wording). The
  // approved replacement for the old "within one business hour" promise added
  // three v4 strings — the promise, its confirmation form, and "Tell us about
  // your shipment." es and fr are authored; ru and ht mirror English pending
  // native review, which is the standing doctrine since M-42 and the reason
  // these two baselines are large in the first place.
  //
  // Raising a ratchet is meant to be uncomfortable, and this is the honest
  // accounting: three more strings a Russian or Haitian Creole customer reads
  // in English. Recorded in docs/COWORK-CONTENT-REVIEW.md for the translation
  // pass rather than papered over.
  //
  // ru/ht raised by 28 on 2026-08-12 (owner business decisions A1–A4, C, D2,
  // D4). Twenty-six new v4 strings plus rewritten hero and FAQ entries, all
  // authored in es and fr — which is why those two baselines did NOT move —
  // and mirroring English in ru and ht pending native review.
  //
  // The trade was deliberate and it is not a good one, only the better one:
  // the alternative was leaving "24/7 Dispatch" and a 15-minute callback
  // guarantee live in five languages because two of them lack a translator.
  // An unsupported promise in Russian is worse than an accurate sentence a
  // Russian speaker reads in English. Both are defects; only one is a claim
  // the business cannot stand behind.
  //
  // These 28 are the priority list for the native review — they are pricing,
  // availability and legal-adjacent copy, which is exactly the category
  // docs/COWORK-CONTENT-REVIEW.md §3 flags as needing a human translator
  // rather than a mirror.
  //
  // ru/ht raised by 2 more on 2026-08-12, closing decision A3 properly. The
  // first sweep corrected the FAQ prose and missed "On the road with us in 24
  // hours." — the homepage section heading and the carrier-page hero, i.e.
  // the same unconditional promise in the largest type on the site. The
  // replacement headline and its qualifier are authored in es and fr (reusing
  // the wording already approved for the FAQ answer, which is why those two
  // baselines did not move) and mirror English in ru and ht.
  //
  // Worth naming precisely, because the arithmetic flatters this: the retired
  // key HAD authored ru and ht values, so those two languages have gone from
  // a translated false promise to an untranslated true one. That is still the
  // right trade — an accurate sentence read in English beats an unsupported
  // guarantee read fluently — but it is a translation regression and it is
  // counted here rather than netted off.
  v4: { es: 14, fr: 27, ru: 456, ht: 462 },
};

function flatten(value: unknown, path: string, out: Map<string, string>): void {
  if (typeof value === "string") {
    out.set(path, value);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      flatten(v, path ? `${path}.${k}` : k, out);
    }
  }
}

function namespaceStrings(locale: string, namespace: string): Map<string, string> {
  const data = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
  const out = new Map<string, string>();
  flatten(data[namespace] ?? {}, "", out);
  return out;
}

function untranslated(locale: string, namespace: string): string[] {
  const en = namespaceStrings("en", namespace);
  const local = namespaceStrings(locale, namespace);
  const same: string[] = [];
  for (const [key, english] of en) {
    if (local.get(key) === english) same.push(key);
  }
  return same;
}

describe("i18n coverage ratchet — the tracking surfaces", () => {
  it("every locale carries every key the English catalogue defines", () => {
    // Separate from the ratchet, and non-negotiable: a MISSING key renders a
    // raw key string to the customer, which is worse than English text.
    for (const namespace of Object.keys(MAX_UNTRANSLATED)) {
      const en = namespaceStrings("en", namespace);
      for (const locale of LOCALES) {
        const local = namespaceStrings(locale, namespace);
        const missing = [...en.keys()].filter((k) => !local.has(k));
        expect(missing, `${locale}.json is missing ${namespace} keys`).toEqual([]);
      }
    }
  });

  for (const [namespace, baselines] of Object.entries(MAX_UNTRANSLATED)) {
    for (const locale of LOCALES) {
      it(`${namespace} · ${locale} — no worse than the M-84 baseline`, () => {
        const count = untranslated(locale, namespace).length;
        expect(
          count,
          `${locale}.json now has ${count} untranslated ${namespace} strings, ` +
            `baseline ${baselines[locale]}. If you ADDED an English-only string, ` +
            `translate it. If you TRANSLATED strings, lower the baseline in ` +
            `tests/unit/i18n-coverage-ratchet.test.ts and say so in the commit.`,
        ).toBeLessThanOrEqual(baselines[locale] as number);
      });
    }
  }

  it("reports the current gap, so the number is visible in the build", () => {
    const lines: string[] = [];
    for (const namespace of Object.keys(MAX_UNTRANSLATED)) {
      const total = namespaceStrings("en", namespace).size;
      for (const locale of LOCALES) {
        const n = untranslated(locale, namespace).length;
        if (n > 0) lines.push(`  ${namespace}.${locale}: ${n}/${total} untranslated`);
      }
    }
    // Always passes. It exists so the figure is printed rather than inferred.
    console.info(`[i18n coverage]\n${lines.join("\n")}`);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("NON-VACUITY — the detector finds a difference when there is one", () => {
    // `es` is essentially complete, so its shipment namespace should be
    // almost entirely DIFFERENT from English. If the comparison were broken
    // (wrong namespace, empty maps) this would read as fully untranslated.
    const total = namespaceStrings("en", "shipment").size;
    const esSame = untranslated("es", "shipment").length;
    expect(total).toBeGreaterThan(300);
    expect(esSame).toBeLessThan(total / 10);
  });
});
