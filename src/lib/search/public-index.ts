import { EQUIPMENT_SLUGS, EQUIPMENT_CONTENT } from "@/content/equipment";
import { CARRIER_FAQ, SHIPPER_FAQ } from "@/content/faq";
import { KB_CATEGORIES } from "@/content/knowledge-base";
import { STATE_SLUGS, STATE_CONTENT } from "@/content/states";
import { PUBLIC_ROUTES } from "@/lib/public-routes";

/**
 * The public search index.
 *
 * ── THE SECURITY PROPERTY, AND WHY IT IS STRUCTURAL ──────────────────────
 *
 * Search is the classic authorization bypass: an index built by crawling, or
 * by querying tables directly, eventually returns a row somebody was not
 * supposed to see, and it does so quietly.
 *
 * So this index is not crawled and it queries nothing. It is DERIVED FROM THE
 * SAME SOURCES THE SITEMAP USES — `PUBLIC_ROUTES`, `EQUIPMENT_SLUGS`,
 * `STATE_SLUGS` and the FAQ arrays. The invariant that falls out of that is
 * worth stating plainly:
 *
 *   **if a page is not public enough to be in the sitemap, it cannot be in
 *   the search index** — not because a filter excludes it, but because no
 *   code path can put it there.
 *
 * There is no portal route to exclude, no RLS to respect, no signed URL to
 * leak and no shipment to find, because none of those things are reachable
 * from these four imports.
 *
 * ── WHY NOT A SEARCH ENGINE ──────────────────────────────────────────────
 *
 * The corpus is roughly forty documents. Elasticsearch or Algolia would add a
 * service, a sync job, an API key and a second copy of the content — and a
 * second copy is the thing most likely to drift out of sync with the
 * permission model. A scored substring match over an in-memory array is the
 * simplest thing that works at this scale, and it stays correct by having
 * nowhere to drift to.
 *
 * ── BLOG POSTS ARE DELIBERATELY ABSENT ───────────────────────────────────
 *
 * They are public and would belong here, but they live in the database and
 * fetching them makes this module async and stateful. The sitemap already
 * handles them. Adding them is a later, contained change: one more source,
 * same shape. Recorded rather than half-done.
 */

export type SearchResultType =
  | "Service"
  | "Resource"
  | "Answer"
  | "Equipment"
  | "Location"
  | "Company";

export interface SearchDoc {
  /** V4 dictionary key. */
  title: string;
  /** V4 dictionary key — one line of context. */
  summary: string;
  /** Locale-relative canonical destination. */
  href: string;
  type: SearchResultType;
  /** Extra words that should match but need not be shown. */
  keywords?: string;
}

/** Titles and summaries for the fixed public routes. */
const ROUTE_DOCS: Record<string, Omit<SearchDoc, "href">> = {
  "/": {
    title: "PickLoads Logistics Group",
    summary: "Truck dispatching & freight brokerage.",
    type: "Company",
  },
  "/dispatch-services": {
    title: "Dispatch Services",
    summary:
      "We act as your back office: finding freight, negotiating rates and handling the paperwork under your operating authority.",
    type: "Service",
    keywords: "dispatch dispatcher load booking rate negotiation broker",
  },
  "/shippers": {
    title: "For Shippers",
    summary:
      "Full truckload and partial solutions with vetted carriers, milestone tracking and one point of contact from pickup to proof of delivery.",
    type: "Service",
    keywords: "freight brokerage shipper ftl partial",
  },
  "/start-your-trucking-company": {
    title: "Start Your Trucking Company",
    summary:
      "Document filing assistance only — we are not a law firm and do not provide legal advice.",
    type: "Service",
    keywords: "new authority mc usdot boc-3 ucr llc ein",
  },
  "/become-a-carrier": {
    title: "Become a Carrier",
    summary:
      "MC/DOT, W-9, certificate of insurance and a voided check — uploaded in one secure form.",
    type: "Service",
    keywords: "carrier onboarding signup apply",
  },
  "/request-a-quote": {
    title: "Request a Quote",
    summary: "Tell us about your shipment.",
    type: "Service",
    keywords: "quote freight rate shipment",
  },
  "/track": {
    title: "Track Shipment",
    summary:
      "Track a shipment with your tracking number, or sign in to see everything in one place.",
    type: "Resource",
    keywords: "tracking status milestone delivery",
  },
  "/truck-dispatch": {
    title: "Dispatch by State",
    summary: "Dispatch for owner-operators and small fleets",
    type: "Service",
  },
  "/knowledge-base": {
    title: "Knowledge Base",
    summary:
      "The questions carriers and shippers actually ask us — answered the way we'd want them answered.",
    type: "Resource",
  },
  "/downloads": {
    title: "Downloads",
    summary:
      "What you need to get started, and where to find your account documents.",
    type: "Resource",
  },
  "/carrier-resources": {
    title: "Carrier Resources",
    summary: "Dispatch for owner-operators and small fleets",
    type: "Resource",
  },
  "/faq": {
    title: "FAQ",
    summary: "Straight answers. No fine print.",
    type: "Resource",
  },
  "/blog": {
    title: "Blog",
    summary: "Freight Insights",
    type: "Resource",
  },
  "/about": {
    title: "About Us",
    summary: "A logistics company built the way carriers wish they all were.",
    type: "Company",
  },
  "/contact": {
    title: "Contact",
    summary: "Carrier or shipper — start the conversation today.",
    type: "Company",
  },
  "/careers": {
    title: "Careers",
    summary: "Work with PickLoads",
    type: "Company",
  },
  "/partners": {
    title: "Partners",
    summary: "Partner with PickLoads",
    type: "Company",
  },
  "/login-center": {
    title: "Sign in",
    summary:
      "Carriers and shippers each have their own workspace — pick yours to sign in or create an account.",
    type: "Company",
  },
};

/**
 * Build the index.
 *
 * Pure and synchronous. Every entry traces back to `PUBLIC_ROUTES` or to a
 * content array that is already rendered on a public page.
 */
export function buildPublicIndex(): SearchDoc[] {
  const docs: SearchDoc[] = [];

  // 1 · The fixed public routes — the SAME list the sitemap emits.
  for (const href of PUBLIC_ROUTES) {
    const meta = ROUTE_DOCS[href];
    if (meta) docs.push({ ...meta, href });
  }

  // 2 · Equipment and state pages, from their own content modules.
  for (const slug of EQUIPMENT_SLUGS) {
    const content = EQUIPMENT_CONTENT[slug];
    docs.push({
      title: content.name,
      summary: content.heroLead,
      href: `/dispatch/${slug}`,
      type: "Equipment",
      keywords: slug.replace(/-/g, " "),
    });
  }
  for (const slug of STATE_SLUGS) {
    const content = STATE_CONTENT[slug];
    docs.push({
      title: content.name,
      summary: content.heroLead,
      href: `/truck-dispatch/${slug}`,
      type: "Location",
      keywords: slug.replace(/-/g, " "),
    });
  }

  // 3 · Every FAQ answer, deep-linked to its Knowledge Base category.
  const categoryOf = new Map<string, string>();
  for (const category of KB_CATEGORIES) {
    for (const question of category.questions) {
      categoryOf.set(question, category.slug);
    }
  }
  for (const [question, answer] of [...CARRIER_FAQ, ...SHIPPER_FAQ]) {
    const slug = categoryOf.get(question);
    docs.push({
      title: question,
      summary: answer,
      href: slug ? `/knowledge-base?category=${slug}` : "/faq",
      type: "Answer",
    });
  }

  return docs;
}

/** Fold accents and case so "reefer" matches "Reefer" and "déjà" matches. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export interface ScoredResult extends SearchDoc {
  score: number;
}

/**
 * Score a query against the index.
 *
 * Title matches outrank keyword matches, which outrank body matches — the
 * ordering a person expects. Every term must appear somewhere, so a two-word
 * query narrows rather than widens.
 */
export function searchPublic(query: string, limit = 20): ScoredResult[] {
  const terms = normalise(query).split(/\s+/).filter((t) => t.length > 1);
  if (terms.length === 0) return [];

  const results: ScoredResult[] = [];
  for (const doc of buildPublicIndex()) {
    const title = normalise(doc.title);
    const summary = normalise(doc.summary);
    const keywords = normalise(doc.keywords ?? "");

    let score = 0;
    let missing = false;
    for (const term of terms) {
      if (title.includes(term)) score += 10;
      else if (keywords.includes(term)) score += 5;
      else if (summary.includes(term)) score += 2;
      else missing = true;
    }
    if (missing || score === 0) continue;
    if (title === normalise(query)) score += 25;
    results.push({ ...doc, score });
  }

  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
