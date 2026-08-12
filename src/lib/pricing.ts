/**
 * Public dispatch pricing — the single source of truth.
 *
 * WHY THIS FILE EXISTS. The three percentages were correct everywhere when
 * this was written, but they were correct by coincidence: each was typed
 * separately into `Pricing.tsx`, `WhyStats.tsx`, `content/equipment.ts`,
 * `content/faq.ts`, `content/states.ts` and five locale catalogs. Nothing
 * connected them, so nothing would have noticed a tier changing in one place
 * and not the other seventeen — and a fee percentage that disagrees with
 * itself across a public site is a billing dispute waiting to be quoted back.
 *
 * The owner set these on 2026-08-12. They are the business source of truth;
 * a rendered percentage that disagrees with this file is a defect in the
 * page, not a variant worth preserving.
 *
 * ── WHAT THIS FILE CAN AND CANNOT ENFORCE ────────────────────────────────
 *
 * Components that render a bare number import from here, so they cannot
 * drift. Prose cannot: "one flat 5% fee, no forced dispatch" is a translated
 * sentence living in five catalogs, and interpolating a constant into it
 * would either break the translations or invent an English-only string.
 *
 * So prose is covered the other way round — the "dispatch pricing is
 * single-sourced and consistent" block in
 * `tests/unit/owner-business-decisions.test.ts` scans the content modules for
 * anything shaped like a dispatch-fee claim and fails if it names a percentage
 * that is not in `DISPATCH_FEE_RATES`. The constant governs the components;
 * the test governs the sentences. Neither alone would have caught a stale
 * tier.
 */

export interface DispatchTier {
  /** Stable id — safe for tests and analytics, never rendered. */
  readonly id: "owner_operator" | "small_fleet" | "box_truck_hot_shot";
  /** Percentage of load gross. The number, not a formatted string. */
  readonly rate: number;
  /** English label, as approved. Locale rendering still goes through i18n. */
  readonly label: string;
  /** Who the tier is for, in the owner's words. */
  readonly appliesTo: string;
}

export const DISPATCH_TIERS = [
  {
    id: "owner_operator",
    rate: 5,
    label: "Owner-Operator",
    appliesTo: "1 truck · your authority",
  },
  {
    id: "small_fleet",
    rate: 4.5,
    label: "Small Fleet",
    appliesTo: "2–10 trucks",
  },
  {
    id: "box_truck_hot_shot",
    rate: 8,
    label: "Box Truck & Hot Shot",
    appliesTo: "Non-CDL & expedited",
  },
] as const satisfies readonly DispatchTier[];

/** Every approved percentage. Any other fee figure in public copy is wrong. */
export const DISPATCH_FEE_RATES: readonly number[] = DISPATCH_TIERS.map(
  (t) => t.rate,
);

export function tierRate(id: DispatchTier["id"]): number {
  const tier = DISPATCH_TIERS.find((t) => t.id === id);
  // Unreachable through the typed id union; throwing beats rendering NaN into
  // a price if someone widens the type later.
  if (!tier) throw new Error(`unknown dispatch tier: ${id}`);
  return tier.rate;
}

/**
 * The owner-operator rate, which is the ONLY one that may be presented alone.
 *
 * The homepage stat tile shows a single headline percentage. Labelling that
 * "flat dispatch fee" described the whole model as 5% when two of the three
 * tiers are not 5% — so the tile now names the tier it belongs to. This
 * export exists to make that the obvious thing to reach for.
 */
export const HEADLINE_TIER = DISPATCH_TIERS[0];
