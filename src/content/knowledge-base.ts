import { CARRIER_FAQ, SHIPPER_FAQ, type FaqEntry } from "@/content/faq";

/**
 * The Knowledge Base — a CATEGORISATION of the existing answers, not a second
 * copy of them.
 *
 * ── WHY NO NEW ANSWERS ARE WRITTEN HERE ──────────────────────────────────
 *
 * Every question and answer below is a reference into `CARRIER_FAQ` or
 * `SHIPPER_FAQ` — the same tuples the `/faq` page and its FAQPage JSON-LD have
 * always rendered. Not one word of answer text is authored in this file.
 *
 * That is deliberate on two counts. Final answers belong to Cowork, and
 * several of these touch compliance directly ("Are you a licensed freight
 * broker?", "Do you work with new authorities?") — inventing an answer to
 * those is exactly the failure the content-ownership split exists to prevent.
 * And duplicating the text would put the same twelve answers on two URLs,
 * which is a duplicate-content problem, not a resource centre.
 *
 * When Cowork supplies more articles they are added to the source arrays and
 * mapped here. The architecture scales; the content does not get invented.
 *
 * ── HOW ENTRIES ARE CATEGORISED ──────────────────────────────────────────
 *
 * By question text, matched exactly against the source arrays. A question that
 * is reworded upstream stops matching and
 * `tests/unit/knowledge-base.test.ts` fails — rather than the entry silently
 * vanishing from its category, which is how a resource centre quietly loses
 * half its content.
 */

export interface KbCategory {
  /** URL-safe id — used by the `?category=` filter and as an anchor. */
  slug: string;
  /** V4 dictionary key. */
  label: string;
  /** The questions in this category, verbatim from the source arrays. */
  questions: readonly string[];
}

/**
 * The eight categories the directive names.
 *
 * Two of them — Documents and Accounts — currently hold NO entries, because no
 * approved answer exists for them yet. They are declared so the architecture
 * is visible and so a Cowork answer has an obvious home, and they render an
 * honest empty state rather than being hidden: a knowledge base that silently
 * omits the category you were looking for is worse than one that says it has
 * nothing on it yet.
 */
export const KB_CATEGORIES: readonly KbCategory[] = [
  {
    slug: "dispatch",
    label: "Dispatch",
    questions: [
      "How much does dispatch cost?",
      "Is this forced dispatch?",
      "How do I get paid?",
      "Do you verify brokers?",
    ],
  },
  {
    slug: "freight-brokerage",
    label: "Freight / Brokerage",
    questions: [
      "Are you a licensed freight broker?",
      "How fast can you quote a shipment?",
      "How do you vet carriers?",
      "What happens if there's a claim?",
    ],
  },
  {
    slug: "carrier-onboarding",
    label: "Carrier Onboarding",
    questions: ["What do I need to get started?", "Do you work with new authorities?"],
  },
  {
    slug: "new-authority",
    label: "New Authority",
    questions: [
      "I don't have my MC yet — can you help me start my trucking company?",
    ],
  },
  {
    slug: "tracking",
    label: "Tracking",
    questions: ["Can I track my shipment?"],
  },
  { slug: "documents", label: "Documents", questions: [] },
  { slug: "accounts", label: "Accounts", questions: [] },
  { slug: "support", label: "Support", questions: [] },
] as const;

/** Every source entry, in one lookup. */
const ALL_ENTRIES: readonly FaqEntry[] = [...CARRIER_FAQ, ...SHIPPER_FAQ];

/** Resolve a question to its full entry, or `undefined` if it no longer exists. */
export function findEntry(question: string): FaqEntry | undefined {
  return ALL_ENTRIES.find(([q]) => q === question);
}

/** The entries of a category, in declared order, skipping any that vanished. */
export function categoryEntries(category: KbCategory): FaqEntry[] {
  return category.questions
    .map((q) => findEntry(q))
    .filter((e): e is FaqEntry => e !== undefined);
}

/** A category by slug, for the `?category=` filter. `null` for unknown input. */
export function categoryBySlug(slug: string | undefined): KbCategory | null {
  if (!slug) return null;
  return KB_CATEGORIES.find((c) => c.slug === slug) ?? null;
}

/**
 * Questions in no category.
 *
 * Not a curiosity — it is the check that stops the Knowledge Base being a
 * lossy view of the FAQ. A new entry added upstream without a category would
 * otherwise be reachable at `/faq` and invisible here. The unit suite asserts
 * this is empty.
 */
export function uncategorisedQuestions(): string[] {
  const mapped = new Set(KB_CATEGORIES.flatMap((c) => c.questions));
  return ALL_ENTRIES.map(([q]) => q).filter((q) => !mapped.has(q));
}
