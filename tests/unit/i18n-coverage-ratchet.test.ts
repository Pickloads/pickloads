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
  //
  // ru/ht raised by 4 more on 2026-08-13 (P0 login fix). Three are the login
  // page's own copy — it read "Carrier & staff sign in" while BOTH signup
  // flows send their verification link there, so a shipper who had just
  // confirmed their email landed on a form addressed to somebody else. The
  // fourth is the new rate-limit message on the sign-in action. es and fr are
  // authored; ru and ht mirror English pending native review.
  //
  // Same honest note as the A3 entry above: the three replaced keys HAD ru and
  // ht values, so those locales trade a fluent sentence that excluded shippers
  // for an accurate English one. Counted here rather than netted off.
  //
  // ── M-90 (2026-08-13): ALL FOUR RAISED, AND THE NUMBERS GOT WORSE ON
  //    PAPER BECAUSE THE MEASUREMENT GOT HONEST ─────────────────────────────
  //
  // es 14→33, fr 27→46, ru 460→521, ht 466→540.
  //
  // Read that as a regression and you have it backwards. 260 keys were ADDED
  // to the catalogue in this commit, and every one of them was already on the
  // live site — as an English literal that `useV4()` fell back to because the
  // key did not exist. The whole main navigation, the carrier wizard, the
  // process flow strip, the 404, the cookie banner, both equipment pickers,
  // every page `<title>`. None of it was in this file's denominator, so this
  // ratchet was measuring 769 strings and reporting on a site that rendered
  // 1,029. The gap it certified was real; the gap it did NOT see was 260
  // strings wide and applied to all four locales at once, including the two
  // it called "essentially complete".
  //
  // What actually changed per locale:
  //
  //   es +19 / fr +19 — every added string is translated EXCEPT the equipment
  //     loanwords and proper nouns the site keeps in English on purpose
  //     ("Dry Van", "Hot Shot", "BOC-3 + UCR", "FAQ", "…"). Those are counted
  //     as untranslated here because byte-equality cannot tell a deliberate
  //     loanword from a missed string, which is the documented over-count.
  //
  //   ru +61 / ht +74 — the ordinary UI and marketing copy among the additions
  //     IS translated (nav, buttons, form labels, wizard steps, metadata).
  //     61 of the 260 are byte-identical to English in BOTH ru and ht. Six of
  //     those are proper nouns and symbols that stay as they are in any
  //     language ("…", "Hot Shot", "Owner-Operator", "LLC + EIN",
  //     "BOC-3 + UCR", "Legal"). The other 55 are deliberate:
  //     dispatch-agreement and
  //     ESIGN wording, FMCSA/MC/USDOT/BOC-3 filing copy, insurance minimums,
  //     surety-bond status, fee-calculation terms, the privacy and cookie
  //     statements, and the "not a live GPS position" disclaimer. Those are
  //     the categories docs/COWORK-CONTENT-REVIEW.md §3 reserves for a native
  //     translator, and machine-translating a legal consent into Haitian
  //     Creole to make a number in this file go down is the trade this repo
  //     has refused four times already. They are listed by key in
  //     docs/modules/M-90-i18n-repair.md so the review has a work queue.
  //
  // ── M-94 (2026-08-18): ru +9, ht +9. es and fr DID NOT MOVE ─────────────
  //
  // The carrier pre-check added 32 v4 strings — the FMCSA verification screen,
  // its three outcomes, the fee placeholder, two new step labels and the
  // corrected "account created" wording. All 32 are authored in es and fr,
  // which is why those two baselines are unchanged.
  //
  // NINE of them mirror English in ru and ht, and they are exactly the nine
  // that docs/COWORK-CONTENT-REVIEW.md §3 reserves for a native translator:
  //
  //   the $9.99 fee, twice (`9_99_one_time_onboarding_fee`,
  //   `pickloads_charges_a_9_99_…`) — a price;
  //   `nothing_is_charged_today_…` — a statement about when money is taken
  //   and what activation depends on;
  //   `account_created_pending_compliance_review` and
  //   `account_created_pending_review_your_account_is_not_activ` — what a
  //   created account does and does not entitle the carrier to;
  //   `we_couldn_t_verify_this_usdot_number_with_fmcsa_please_r` — the
  //   adverse outcome an applicant is shown;
  //   `onboarding_begins_…`, `onboarding_starts_…` and
  //   `it_starts_with_verification_…` — the public promise about what the
  //   process is and what it costs.
  //
  // Every one is a commitment about money, eligibility or a federal record.
  // Machine-translating those into Haitian Creole to make a number in this
  // file go down is the trade this repo has refused five times now: an
  // accurate English sentence read by a Russian or Haitian Creole speaker is a
  // defect, and a fluent mistranslation of a price or a refusal is a worse
  // one. They are the priority queue for the native review.
  //
  // The other 23 — labels, buttons, field hints, step names, the manual-review
  // and unverified-carrier explanations — ARE translated in ru and ht.
  //
  // ── M-95 (2026-08-19): ru +8, ht +8. es and fr AGAIN DID NOT MOVE ───────
  //
  // The Stripe fee step added 20 v4 strings — the Checkout screen, the payment
  // return page and its four outcomes. All 20 are authored in es and fr.
  //
  // EIGHT mirror English in ru and ht, and every one of them is a statement
  // about MONEY:
  //
  //   "Your $9.99 verification fee is confirmed…" and "Pay $9.99 and
  //   continue" — a price;
  //   "Payment cancelled — nothing was charged", "…so no money has moved",
  //   "…nothing is lost", "…Nothing has been charged" — four separate
  //   assurances about whether a card was debited;
  //   "…PickLoads never sees or stores your card details. Paying does not
  //   activate your account…" — a security claim and an activation claim in
  //   one sentence;
  //   "Card payments are processed by Stripe. Your payment is confirmed
  //   with Stripe directly…" — how and when money is taken.
  //
  // These are the worst possible strings to machine-translate. A carrier who
  // reads a fluent but wrong sentence about whether they have been charged
  // does not have a translation problem, they have a money problem — and the
  // one thing worse than reading "nothing was charged" in English is reading
  // something that does not quite mean that in Haitian Creole. They join the
  // priority queue in docs/COWORK-CONTENT-REVIEW.md §3.
  //
  // The other 12 — buttons, headings, "we're confirming your payment", the
  // page title — ARE translated in ru and ht.
  //
  // The direction that matters is unchanged: a raised baseline still has to
  // explain itself, and these lines are that explanation.
  v4: { es: 33, fr: 46, ru: 538, ht: 557 },
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

function namespaceStrings(
  locale: string,
  namespace: string,
): Map<string, string> {
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
        expect(missing, `${locale}.json is missing ${namespace} keys`).toEqual(
          [],
        );
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
        if (n > 0)
          lines.push(`  ${namespace}.${locale}: ${n}/${total} untranslated`);
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
