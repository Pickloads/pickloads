/**
 * How long onboarding takes — the approved wording, in one place.
 *
 * ── WHAT WAS WRONG WITH THE OLD SENTENCE ─────────────────────────────────
 *
 * "On the road with us in 24 hours." was the section heading on the homepage
 * AND the hero of the carrier landing page. It is an unconditional promise
 * about an outcome PickLoads does not control: load availability, broker
 * acceptance, market rates and shipper decisions all sit outside the four
 * steps the page describes, and so does whether the carrier's own paperwork
 * arrived complete.
 *
 * The FAQ answer next to it had already been corrected to "most carriers are
 * rolling within 24–48 hours after completed paperwork" — so the site was
 * making two different promises about the same thing, and the stronger one
 * was the one set in display type. That is the failure mode this file exists
 * to prevent: the same claim, restated in three places, corrected in one.
 *
 * ── WHY A CONSTANT AND NOT JUST BETTER COPY ──────────────────────────────
 *
 * Same reasoning as `response-promise.ts`. A timing claim is an operational
 * commitment wearing marketing clothes. Both surfaces import from here; the
 * FAQ prose in `src/content/faq.ts` carries the same numbers and is held to
 * them by `tests/unit/owner-business-decisions.test.ts`, because a translated
 * sentence cannot import a constant.
 *
 * ── THE WORDS THAT ARE LOAD-BEARING (owner decision A3, 2026-08-12) ───────
 *
 * "Most", "after completed paperwork", and the whole qualifier sentence.
 * "Rolling within 24–48 hours" describes what usually happens once the
 * carrier's side is done. Do not let this drift back toward "in 24 hours",
 * and do not turn it into a guarantee with a longer number.
 */

export const ONBOARDING_TIMING = {
  /** Section heading and page-hero title. Display type — keep it short. */
  headline: "On the road within 24–48 hours.",

  /**
   * The qualifier. It runs directly beneath the headline on every surface
   * that uses it, and it is not optional — the headline alone is the claim
   * decision A3 removed.
   */
  qualifier:
    "Most carriers are rolling within 24–48 hours after completed paperwork. Timing depends on completed onboarding, documentation, equipment, location and market availability.",
} as const;
