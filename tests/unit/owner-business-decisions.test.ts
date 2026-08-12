import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ONBOARDING_TIMING } from "@/lib/copy/onboarding-timing";
import { DISPATCH_TIERS, DISPATCH_FEE_RATES } from "@/lib/pricing";

/**
 * The owner's pre-launch business decisions, 2026-08-12 — enforced.
 *
 * ── WHY A TEST AND NOT A DOCUMENT ─────────────────────────────────────────
 *
 * Every claim removed here was approved copy once. "24/7 Dispatch" was in the
 * topbar of every page; "15min · Callback promise" was a headline stat. They
 * were not mistakes at the time — they were decisions, and decisions get
 * re-made by whoever writes the next section and remembers the old wording.
 *
 * A document saying "we no longer promise 24/7" does not survive that. A
 * failing test does.
 *
 * ── WHAT IS DELIBERATELY *NOT* BANNED ─────────────────────────────────────
 *
 * The scan covers public, customer-facing source. It exempts:
 *
 *   * `src/emails/LeadNotificationEmail.tsx` — an INTERNAL staff email. The
 *     15-minute figure survives there on purpose (decision A2): an
 *     operational target addressed to an employee is not a public promise.
 *     Exempting the file by name, rather than loosening the pattern, is what
 *     keeps that distinction visible.
 *   * comments — this rule is explained in prose in several files, and a
 *     doctrine that fails on its own documentation teaches people to delete
 *     the documentation.
 *   * `content/states.ts` market ranges like "$2.40–$2.90/mi", which are
 *     hedged spot-market estimates ("Estimates, not promises"), not a
 *     PickLoads performance statistic. Decision C removed the "$2.90 average
 *     rate/mile" STAT; it did not ban discussing market rates.
 */

const SRC = path.join(process.cwd(), "src");

/** Files whose content is exempt, with the reason it is exempt. */
const EXEMPT = new Map<string, string>([
  [
    "src/emails/LeadNotificationEmail.tsx",
    "internal staff notification — 15-minute internal KPI is approved (A2)",
  ],
]);

/**
 * Staff-only trees. Decision A2 keeps 15 minutes as an internal operational
 * target, and the admin dashboard is where an operational target belongs —
 * "not contacted yet — 15-min target" on a lead, "target ≤ 15 min" on the
 * ops board. No customer can reach these routes: they are behind auth, they
 * carry `noindex`, and `robots.txt` disallows `/portal`.
 *
 * Exempting by PREFIX and not by loosening the pattern is the point. The
 * public site still cannot say "15 minutes" anywhere at all.
 */
const STAFF_ONLY_PREFIXES = ["src/app/[locale]/portal/admin/"];

function publicSourceFiles(): string[] {
  const out: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(tsx|ts)$/.test(entry.name)) out.push(p);
    }
  })(SRC);
  return out;
}

/**
 * Source with comments stripped — see the note above.
 *
 * Trailing comments are stripped too, not just whole-line ones: the first
 * draft missed `900, // 15 min` in the notification back-off table and
 * reported a seconds-to-minutes annotation as a public promise.
 */
function codeOf(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:'"`])\/\/.*$/gm, "$1");
}

function isExempt(rel: string): boolean {
  return EXEMPT.has(rel) || STAFF_ONLY_PREFIXES.some((p) => rel.startsWith(p));
}

interface ForbiddenClaim {
  /** The owner decision that removed this claim. */
  readonly decision: string;
  readonly label: string;
  readonly pattern: RegExp;
  /**
   * The exact wording this replaced, carried on the record itself.
   *
   * It lived in a parallel array indexed by position, which is how a
   * non-vacuity control silently stops proving the pattern next to it —
   * reorder the list and every proof shifts by one. Same object, no indices.
   */
  readonly replaced: string;
}

const FORBIDDEN: readonly ForbiddenClaim[] = [
  {
    decision: "A1",
    label: "24/7 availability claim",
    pattern: /\b24\s*\/\s*7\b/,
    replaced: "☎ (908) 404-5373 · 24/7 Dispatch",
  },
  {
    decision: "A2",
    label: "15-minute callback promise",
    pattern: /\b15[\s-]?(minute|min)s?\b/i,
    replaced: "a dispatcher calls you back within 15 minutes",
  },
  {
    decision: "A3",
    label: "unconditional first-load-in-24-hours",
    pattern: /first load within 24|first load in 24/i,
    replaced: "most carriers get their first load within 24 hours",
  },
  {
    decision: "A3",
    label: "any bare 24-hour onboarding promise",
    // The first sweep corrected the FAQ prose and missed "On the road with us
    // in 24 hours." — which was the homepage section heading AND the carrier
    // page hero, i.e. the same claim in the largest type on the site. Matching
    // the phrase rather than the sentence is what catches the next restatement.
    //
    // The approved range reads "24–48 hours" and does not match: this fires on
    // a bare 24 only. `src/lib/shipments/driver-token.ts` says "Default 24
    // hours" about a token TTL, in a comment, which `codeOf` strips.
    pattern: /\b(?:in|within)\s*24\s*hours\b/i,
    replaced: "On the road with us in 24 hours.",
  },
  {
    decision: "A4",
    label: "RATE IN 1 HOUR",
    pattern: /rate in 1 hour/i,
    replaced: "RATE IN 1 HOUR",
  },
  {
    decision: "A4",
    label: "SAME-DAY DOCS",
    pattern: /same[\s-]day docs/i,
    replaced: "SAME-DAY DOCS",
  },
  {
    decision: "A4",
    label: "guaranteed same-day document delivery",
    pattern: /documents delivered same day/i,
    replaced: "with documents delivered same day.",
  },
  {
    decision: "C",
    label: "$2.90 rate-per-mile statistic",
    pattern: /\$?2\.90\s*(avg|average)?\s*(rpm|rate\/mile)/i,
    replaced: "$2.90 avg RPM",
  },
  {
    decision: "C",
    label: "avg rate/mile statistic label",
    pattern: /avg(\.|erage)?\s*rate\/mile/i,
    replaced: "Avg rate/mile booked*",
  },
];

describe("owner business decisions — public copy", () => {
  const files = publicSourceFiles();

  it("finds source to scan (non-vacuity)", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  for (const { decision, label, pattern } of FORBIDDEN) {
    it(`${decision} — no ${label} in public source`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        const rel = path.relative(process.cwd(), file).replace(/\\/g, "/");
        if (isExempt(rel)) continue;
        if (pattern.test(codeOf(file))) offenders.push(rel);
      }
      expect(offenders, `${label} found in: ${offenders.join(", ")}`).toEqual(
        [],
      );
    });
  }

  it("NON-VACUITY: every pattern matches the wording it replaced", () => {
    // A scan that finds nothing is indistinguishable from a scan that cannot
    // find anything. Each pattern is proved against the real sentence it was
    // written to delete — and because `replaced` travels on the same record,
    // adding a claim without proving it is not possible.
    for (const { label, pattern, replaced } of FORBIDDEN) {
      expect(
        pattern.test(replaced),
        `${label}: pattern does not match "${replaced}"`,
      ).toBe(true);
    }
  });

  it("the internal-KPI exemption is real, not a hole", () => {
    // If this file ever stops containing the internal target, the exemption
    // is dead weight and should be deleted rather than left as a standing
    // hole in the scan.
    const rel = "src/emails/LeadNotificationEmail.tsx";
    expect(readFileSync(path.join(process.cwd(), rel), "utf8")).toMatch(
      /15 minutes/,
    );
    // And it must still be an INTERNAL notification, not something that grew
    // a customer-facing render path.
    expect(readFileSync(path.join(process.cwd(), rel), "utf8")).toContain(
      "InternalNotification",
    );
  });
});

describe("owner business decisions — locale catalogues", () => {
  // The catalogues are where a removed claim hides best: `tv()` keys are
  // truncated slugs, so rewriting an English literal can leave the old
  // sentence rendering from the catalogue under an unchanged key. That is
  // exactly what happened to the hero and the FAQ during this pass — both
  // edits were inert until the catalogue was updated too.
  const LOCALES = ["en", "es", "fr", "ru", "ht"] as const;
  const CLAIMS: Array<[string, RegExp]> = [
    ["24/7", /\b24\s*\/\s*7\b/],
    ["15 minutes", /\b15\s*(minute|min)/i],
    ["first load within 24", /first load within 24/i],
    // A catalogue entry outlives the component that rendered it: the retired
    // "On the road with us in 24 hours." had authored es/fr/ru/ht values, and
    // deleting only the English literal would have left four languages still
    // making the promise.
    [
      "bare 24-hour promise",
      /\b(?:in|within)\s*24\s*(hours|horas|heures|èdtan|часов)\b/i,
    ],
    ["RATE IN 1 HOUR", /rate in 1 hour/i],
    ["SAME-DAY DOCS", /same[\s-]day docs/i],
    ["avg rate/mile", /rate\/mile|tarifa\/milla|tarif moyen\/mile/i],
  ];

  for (const locale of LOCALES) {
    it(`${locale}.json carries no removed claim`, () => {
      const cat: unknown = JSON.parse(
        readFileSync(
          path.join(process.cwd(), `messages/${locale}.json`),
          "utf8",
        ),
      );
      const hits: string[] = [];
      (function walk(node: unknown, prefix: string) {
        if (typeof node === "string") {
          for (const [label, pattern] of CLAIMS) {
            if (pattern.test(node)) hits.push(`${prefix} (${label})`);
          }
        } else if (node && typeof node === "object") {
          for (const [k, v] of Object.entries(node)) {
            walk(v, prefix ? `${prefix}.${k}` : k);
          }
        }
      })(cat, "");
      expect(
        hits,
        `removed claims still in ${locale}.json: ${hits.join(", ")}`,
      ).toEqual([]);
    });
  }
});

describe("dispatch pricing is single-sourced and consistent", () => {
  it("matches the owner-approved sheet exactly", () => {
    expect(DISPATCH_TIERS.map((t) => [t.id, t.rate])).toEqual([
      ["owner_operator", 5],
      ["small_fleet", 4.5],
      ["box_truck_hot_shot", 8],
    ]);
  });

  it("no content module names a dispatch fee outside the approved set", () => {
    // Prose cannot import a constant, so it is checked instead. The pattern
    // targets sentences that tie a percentage to the FEE — "8% per load",
    // "flat 5% fee" — and not every percentage on the site.
    const modules = [
      "src/content/equipment.ts",
      "src/content/faq.ts",
      "src/content/states.ts",
    ];
    const FEE_CLAIM =
      /(\d+(?:\.\d+)?)\s*%\s*(?:of gross\b|per load\b|fee\b|for (?:owner|small|box|hot))|(?:flat|fee (?:is|of))\s+(\d+(?:\.\d+)?)\s*%/gi;

    const offenders: string[] = [];
    for (const rel of modules) {
      const text = readFileSync(path.join(process.cwd(), rel), "utf8");
      for (const m of text.matchAll(FEE_CLAIM)) {
        const rate = Number(m[1] ?? m[2]);
        if (!DISPATCH_FEE_RATES.includes(rate)) {
          offenders.push(`${rel}: ${rate}% — "${m[0].trim()}"`);
        }
      }
    }
    expect(
      offenders,
      `unapproved dispatch fee: ${offenders.join(" | ")}`,
    ).toEqual([]);
  });

  it("NON-VACUITY: a 10% box-truck fee would be caught", () => {
    // The Cowork audit reported a competing 10% box-truck tier. It was not
    // present on this branch — but "not present" is only worth knowing if the
    // check could have found it.
    const FEE_CLAIM =
      /(\d+(?:\.\d+)?)\s*%\s*(?:of gross\b|per load\b|fee\b|for (?:owner|small|box|hot))|(?:flat|fee (?:is|of))\s+(\d+(?:\.\d+)?)\s*%/gi;
    const bad = "Our fee for box trucks is 10% per load, the published tier.";
    const found = [...bad.matchAll(FEE_CLAIM)].map((m) => Number(m[1] ?? m[2]));
    expect(found).toContain(10);
    expect(DISPATCH_FEE_RATES).not.toContain(10);
  });

  it("the rendered components read the constant rather than a literal", () => {
    for (const rel of [
      "src/components/sections/Pricing.tsx",
      "src/components/sections/WhyStats.tsx",
    ]) {
      expect(
        readFileSync(path.join(process.cwd(), rel), "utf8"),
        `${rel} must import from @/lib/pricing`,
      ).toContain("@/lib/pricing");
    }
  });
});

describe("removed claims cannot ride into the bundle", () => {
  /**
   * `src/i18n/request.ts` loaded catalogues as
   * `import(`../../messages/${locale}.json`)`. A template-literal specifier
   * makes webpack emit a CONTEXT MODULE — it bundles every file matching
   * `messages/*.json` because it cannot know which one runtime will ask for.
   *
   * `messages/_key-index.json` is a generated slug→English map that no
   * application code reads, and it still carries the full pre-decision
   * wording. It shipped in the server bundle: unreachable, so nothing ever
   * rendered it, and present in every deployment. "We removed that claim" and
   * "that claim is not in what we ship" had quietly stopped being the same
   * statement, which is the only reason this is worth a test.
   */
  it("catalogue imports are explicit, not a webpack context module", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/i18n/request.ts"),
      "utf8",
    );
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:'"`])\/\/.*$/gm, "$1");

    expect(
      /import\(\s*`[^`]*\$\{/.test(code),
      "a template-literal dynamic import bundles every file in the directory",
    ).toBe(false);

    for (const locale of ["en", "es", "fr", "ru", "ht"]) {
      expect(code, `no explicit import for ${locale}`).toContain(
        `../../messages/${locale}.json`,
      );
    }
  });

  it("no non-locale file in messages/ is imported by application code", () => {
    // `_key-index.json` is allowed to exist and to be stale — regenerating it
    // means running the fail-closed extractor. It is NOT allowed to be
    // referenced from src/, which is what put it in the bundle.
    for (const file of publicSourceFiles()) {
      expect(
        codeOf(file),
        `${file} references the generated key index`,
      ).not.toContain("_key-index");
    }
  });

  const BUILD = path.join(process.cwd(), ".next", "server");
  const built = existsSync(BUILD);

  // Only meaningful after `npm run build`; the certification lane always
  // builds. Skipping loudly beats passing vacuously on a clean checkout.
  it.skipIf(!built)("the built server output carries no retired claim", () => {
    const RETIRED = [
      "24/7",
      "RATE IN 1 HOUR",
      "SAME-DAY DOCS",
      "first load within 24",
      "in 24 hours",
      "Flat dispatch fee",
      "States covered",
      "Avg rate/mile",
      "J. Baptiste",
    ];
    const offenders: string[] = [];
    (function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.(js|html|json|rsc)$/.test(entry.name)) continue;
        // Sourcemaps carry vendor text and are not the shipped artefact.
        if (entry.name.endsWith(".map")) continue;
        const text = readFileSync(p, "utf8");
        for (const claim of RETIRED) {
          if (text.includes(claim)) {
            offenders.push(`${path.relative(BUILD, p)}: ${claim}`);
          }
        }
      }
    })(BUILD);
    expect(
      offenders,
      `retired claims in the build: ${offenders.join(" | ")}`,
    ).toEqual([]);
  });

  it("NON-VACUITY: the build scan is looking at a real, populated build", () => {
    if (!built) return; // paired with skipIf above
    // A scan of an empty or missing tree passes trivially. The 15-minute
    // internal KPI is known to be in there (LeadNotificationEmail, approved
    // under A2), so finding it proves the walk reaches real chunk content.
    let sawInternalKpi = false;
    (function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith(".js")) {
          if (readFileSync(p, "utf8").includes("call within 15 minutes")) {
            sawInternalKpi = true;
          }
        }
      }
    })(BUILD);
    expect(
      sawInternalKpi,
      "build scan found no known-present string — it is not reading the bundle",
    ).toBe(true);
  });
});

describe("onboarding timing is single-sourced (decision A3)", () => {
  it("headline and qualifier carry the approved 24–48 wording", () => {
    expect(ONBOARDING_TIMING.headline).toBe("On the road within 24–48 hours.");
    expect(ONBOARDING_TIMING.qualifier).toContain("24–48 hours");
    expect(ONBOARDING_TIMING.qualifier).toContain("after completed paperwork");
    // The qualifier names what PickLoads does not control. Without it the
    // headline is the claim decision A3 removed, only with a wider range.
    expect(ONBOARDING_TIMING.qualifier).toContain("market availability");
  });

  it("both surfaces read the constant instead of restating it", () => {
    // These two rendered the same sentence independently, which is why the
    // first correction reached the FAQ and left the heading behind.
    for (const rel of [
      "src/components/sections/HowAndCompare.tsx",
      "src/app/[locale]/(site)/become-a-carrier/page.tsx",
    ]) {
      const text = readFileSync(path.join(process.cwd(), rel), "utf8");
      expect(text, `${rel} must import ONBOARDING_TIMING`).toContain(
        "@/lib/copy/onboarding-timing",
      );
      // The qualifier is not optional decoration — a surface that shows the
      // headline alone has re-made the unconditional promise.
      expect(text, `${rel} must render the qualifier`).toContain(
        "ONBOARDING_TIMING.qualifier",
      );
    }
  });

  it("every locale carries the replacement, not just English", () => {
    // A `tv()` miss falls back to the English literal, so a missing key is
    // silent — the page still reads correctly in English while four locales
    // quietly stop being translated.
    for (const locale of ["en", "es", "fr", "ru", "ht"]) {
      const cat = JSON.parse(
        readFileSync(
          path.join(process.cwd(), `messages/${locale}.json`),
          "utf8",
        ),
      ) as { v4: Record<string, string> };
      expect(
        cat.v4["on_the_road_within_24_48_hours"],
        `${locale}.json is missing the approved headline`,
      ).toBeTruthy();
      expect(
        cat.v4["on_the_road_with_us_in_24_hours"],
        `${locale}.json still carries the retired headline`,
      ).toBeUndefined();
    }
  });
});

describe("gates stay closed", () => {
  const seed = readFileSync(
    path.join(process.cwd(), "supabase/seed.sql"),
    "utf8",
  );

  it("brokerage_active is false in the seed", () => {
    expect(seed).toMatch(/\('brokerage_active',\s*'false'/);
  });

  it("referral_program_active is false in the seed (decision D1)", () => {
    expect(seed).toMatch(/\('referral_program_active',\s*'false'/);
  });

  it("testimonials_visible is false in the seed (decision E)", () => {
    expect(seed).toMatch(/\('testimonials_visible',\s*'false'/);
  });

  it("packet_downloads_live is false in the seed", () => {
    expect(seed).toMatch(/\('packet_downloads_live',\s*'false'/);
  });

  it("no testimonial content is shipped in source (decision E)", () => {
    // The prototype's sample quotes and their invented author names must not
    // reappear as "placeholder" data.
    for (const file of publicSourceFiles()) {
      // Comment-stripped: `src/lib/testimonials.ts` DOCUMENTS that the
      // prototype's sample author must never render, and a rule that fails
      // on its own explanation gets the explanation deleted.
      expect(codeOf(file), `${file}: sample testimonial author`).not.toContain(
        "J. Baptiste",
      );
    }
  });
});

describe("New Authority is operated by PickLoads (decision D4)", () => {
  const page = readFileSync(
    path.join(
      process.cwd(),
      "src/app/[locale]/(site)/start-your-trucking-company/page.tsx",
    ),
    "utf8",
  );

  it("names PickLoads Logistics Group LLC as the operator", () => {
    expect(page).toContain(
      "The New Authority Program is operated by PickLoads Logistics Group LLC.",
    );
  });

  it("never names Larocque Group as the operator", () => {
    // The Cowork audit reported this on an older snapshot. It is not present
    // here, and this is what keeps it that way.
    expect(page).not.toMatch(/Larocque Group/i);
  });

  it("keeps the not-a-law-firm and no-guarantee disclaimers", () => {
    expect(page).toMatch(/not a law firm/i);
    expect(page).toMatch(/cannot guarantee approval/i);
    expect(page).toMatch(/not FMCSA, USDOT or any government agency/i);
  });
});
