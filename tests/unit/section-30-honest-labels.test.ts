import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * M-84 — §30's honest-product rules, as a standing guard.
 *
 * ── WHY A TEST AND NOT A CODE REVIEW ──────────────────────────────────────
 *
 * §30 forbids claiming "live tracking" when the system has only manual
 * updates, and forbids calling anything "AI-powered" unless real, validated
 * AI is doing it. M-73 filed both as findings. Nothing enforced them, and
 * ten modules later the marketing surfaces still carried five separate "live
 * tracking" claims in all five locales — on `/shippers`, in its metadata, in
 * the JSON-LD service description, in the home-page teaser and as a node in
 * the process diagram. M-84 removed them.
 *
 * A finding that gets fixed once and can be reintroduced by anybody writing a
 * plausible marketing sentence is not fixed; it is postponed. This file is
 * the guard, and it runs in the unit lane so a reintroduction fails in
 * seconds rather than in a legal review.
 *
 * ── WHAT IS SCANNED ───────────────────────────────────────────────────────
 *
 * All five message catalogues (every customer-visible string ships through
 * them) and the static content modules. Not `src/**` component source: the
 * English literals there are lookup KEYS whose values come from the
 * catalogues, so scanning both would report every violation twice while
 * proving the same thing once.
 *
 * ── WHY THE PATTERNS ARE NARROW ───────────────────────────────────────────
 *
 * "Live" is a perfectly honest word in "24/7 live support" (humans answer),
 * "live dispatch support", "document uploads aren't live yet" (a feature is
 * not switched on) and "once our brokerage division is live". A guard that
 * banned the word would be turned off within a month. What §30 forbids is
 * "live" applied to TRACKING, LOCATION or STATUS — a claim about freshness
 * the system cannot honour while a dispatcher is the sensor.
 */

const CATALOGUES = ["en", "es", "fr", "ru", "ht"].map(
  (l) => `messages/${l}.json`,
);

/**
 * The forbidden claims. Each is `live`/`real-time`/`realtime` bound to a
 * tracking noun, in every authored language, plus the AI claim.
 *
 * The non-English patterns are not decoration. A claim is a claim in the
 * language the customer reads it in, and an English-only guard would let
 * "seguimiento en vivo" through while congratulating itself.
 */
const FORBIDDEN: readonly { label: string; pattern: RegExp }[] = [
  { label: "en · live tracking", pattern: /\blive\s+(shipment\s+)?(tracking|location|status)\b/i },
  { label: "en · real(-)time tracking", pattern: /\breal[\s-]?time\s+(shipment\s+)?(tracking|location|status|updates?)\b/i },
  // The first draft of this file matched only "seguimiento en vivo",
  // "отслеживание в реальном времени" and "swiv an dirèk" — and passed, while
  // "rastreo en vivo", "живым отслеживанием" and "swivi an dirèk" were still
  // shipping. A guard that matches only the phrasing you happened to think of
  // is a guard that reports success. These are inflection-tolerant.
  { label: "es · seguimiento/rastreo en vivo · en tiempo real", pattern: /(seguimiento|rastreo|localizaci[oó]n|ubicaci[oó]n)\s+(en\s+vivo|en\s+tiempo\s+real)/i },
  { label: "fr · suivi/position en direct · en temps réel", pattern: /(suivi|position|localisation)\s+(en\s+direct|en\s+temps\s+r[ée]el)/i },
  // `\w` is [A-Za-z0-9_] in JavaScript — it does NOT match Cyrillic. The
  // first draft used it here and the Russian patterns silently matched
  // nothing at all, which is the most expensive kind of passing test.
  // Explicit ranges, and the non-vacuity block below is what caught it.
  { label: "ru · отслеживание в реальном времени", pattern: /отслеживани[а-яё]*\s+в\s+реальном\s+времени/i },
  { label: "ru · живое/реальное отслеживание", pattern: /(жив|реальн)[а-яё]+\s+отслеживани[а-яё]*/i },
  { label: "ht · swiv an dirèk", pattern: /swiv\w*\s+an\s+dir[èe]k/i },
  { label: "any · AI-powered", pattern: /\bAI[\s-]?(powered|driven)\b/i },
];

/**
 * Strings that must survive — the word "live" used honestly.
 *
 * §30 bans "live tracking" because it implies a GPS position the platform does
 * not have. It does NOT ban "live support", which means a human answers the
 * phone — a true statement about a different thing. This control exists so a
 * future sweep for the banned phrase cannot quietly take the honest use with
 * it.
 *
 * Both original anchors were rewritten by the owner's 2026-08-12 availability
 * decision: "24/7 live support, weekends included" became a seven-day claim,
 * and the "Live dispatch support" stat tile no longer says "live" at all. The
 * anchor is re-pointed at the surviving honest use rather than dropped —
 * removing it would retire the control at the exact moment the copy churned,
 * which is when it is most useful.
 */
const MUST_SURVIVE = ["Live support 7 days a week, weekends included"];

/**
 * §30's six APPROVED labels, by message key and by the exact English wording
 * the directive gives them.
 *
 * `shipment.label.live_location_available` — "Live location available" — trips
 * the tracking pattern above and is nevertheless required: it is one of the
 * six labels §30 names, and it renders only when a Mode B/C source actually
 * has a position. The exemption is therefore by KEY, and it is pinned: a
 * separate test asserts each exempted key's English value is still §30's
 * wording verbatim, so the exemption cannot be widened by editing the value
 * into a marketing sentence.
 */
const SECTION_30_LABELS: Readonly<Record<string, string>> = {
  "shipment.label.last_updated_by_dispatch": "Last updated by dispatch",
  "shipment.label.milestone_tracking": "Milestone tracking",
  "shipment.label.live_location_available": "Live location available",
  "shipment.label.location_unavailable": "Location temporarily unavailable",
  "shipment.label.eta_by_dispatcher": "ETA provided by dispatcher",
  "shipment.label.tracking_link_expired": "Tracking link expired",
};

function walk(value: unknown, path: string, out: { path: string; text: string }[]) {
  if (typeof value === "string") {
    out.push({ path, text: value });
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      walk(v, path ? `${path}.${k}` : k, out);
    }
  }
}

function stringsIn(file: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  walk(JSON.parse(readFileSync(file, "utf8")), "", out);
  return out;
}

describe("§30 honest product rules — the forbidden claims are absent", () => {
  for (const file of CATALOGUES) {
    it(`${file} makes no forbidden tracking claim`, () => {
      const offences: string[] = [];
      for (const { path, text } of stringsIn(file)) {
        if (path in SECTION_30_LABELS) continue; // §30's own approved labels
        for (const rule of FORBIDDEN) {
          if (rule.pattern.test(text)) {
            offences.push(`${rule.label} — ${path}: ${JSON.stringify(text)}`);
          }
        }
      }
      expect(
        offences,
        `§30 forbids claiming live/real-time tracking while updates are manual`,
      ).toEqual([]);
    });
  }

  it("the static content modules make none either", () => {
    const offences: string[] = [];
    for (const name of readdirSync("src/content")) {
      if (!name.endsWith(".ts")) continue;
      const text = readFileSync(`src/content/${name}`, "utf8");
      for (const rule of FORBIDDEN) {
        if (rule.pattern.test(text)) {
          offences.push(`${rule.label} — src/content/${name}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it("NON-VACUITY — the patterns catch the sentences that were actually shipped", () => {
    // The five real strings M-84 removed, plus one per non-English locale.
    // If a pattern is ever loosened into uselessness, these fail.
    const removed = [
      "Vetted carriers, live tracking and claims support — see why shippers choose PickLoads.",
      "Full truckload and partial freight with vetted carriers, live tracking and one point of contact.",
      "Live shipment tracking & proactive updates",
      "your dispatcher shares live status here",
      "Real-time tracking on every load",
      // The four the FIRST version of these patterns let through — kept
      // because they are the evidence that "we localised the guard" is not
      // the same as "the guard matches the language".
      "Carriers verificados, rastreo en vivo y apoyo en reclamos",
      "Проверенные перевозчики, живое отслеживание и поддержка",
      "перевозками с реальным отслеживанием",
      "Carriers verifye, swivi an dirèk ak sipò reklamasyon",
      "seguimiento en vivo de sus envíos",
      "suivi en direct de votre expédition",
      "отслеживание в реальном времени",
      "swiv an dirèk pou chajman ou",
      "Our AI-powered dispatch desk",
    ];
    for (const sentence of removed) {
      expect(
        FORBIDDEN.some((r) => r.pattern.test(sentence)),
        `no pattern catches: ${sentence}`,
      ).toBe(true);
    }
  });

  it("NON-VACUITY — the honest uses of 'live' are NOT caught", () => {
    // A guard that also banned these would be switched off, and then it would
    // guard nothing. This asserts the guard is narrow enough to keep.
    const honest = [
      ...MUST_SURVIVE,
      "Document uploads aren't live yet",
      "once our brokerage division is live",
      "A dispatcher answers live, 24/7",
    ];
    for (const sentence of honest) {
      expect(
        FORBIDDEN.some((r) => r.pattern.test(sentence)),
        `over-broad: ${sentence} is honest and was flagged`,
      ).toBe(false);
    }
  });

  it("the exempted keys still carry §30's exact wording, in English", () => {
    // The exemption above is by key. This is what stops it becoming a hole:
    // change `live_location_available` into a marketing sentence and the key
    // is still exempt from the pattern, but this test fails on the wording.
    const en = new Map(stringsIn("messages/en.json").map((s) => [s.path, s.text]));
    for (const [key, wording] of Object.entries(SECTION_30_LABELS)) {
      expect(en.get(key), `${key} is no longer §30's approved label`).toBe(
        wording,
      );
    }
  });

  it("all six §30 labels are TRANSLATED in every authored locale", () => {
    // §24: a label the customer cannot read is not a label. This found two
    // real gaps — `live_location_available` and `location_unavailable` were
    // still English in ru and ht at M-83.
    const english = stringsIn("messages/en.json");
    const byPath = new Map(english.map((s) => [s.path, s.text]));
    for (const file of CATALOGUES) {
      if (file.endsWith("en.json")) continue;
      const local = new Map(stringsIn(file).map((s) => [s.path, s.text]));
      for (const key of Object.keys(SECTION_30_LABELS)) {
        const value = local.get(key);
        expect(value, `${file} is missing ${key}`).toBeDefined();
        expect(
          value,
          `${file}: ${key} is still the English string — §24`,
        ).not.toBe(byPath.get(key));
      }
    }
  });

  it("the honest uses are still present in the English catalogue", () => {
    // Proving the previous test is about real strings, not hypotheticals.
    const en = stringsIn("messages/en.json").map((s) => s.text);
    for (const survivor of MUST_SURVIVE) {
      expect(en, `${survivor} was removed — over-correction`).toContain(survivor);
    }
  });
});
