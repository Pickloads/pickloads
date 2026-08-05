import "server-only";

/**
 * M-69 / P-6 — the testimonials data source.
 *
 * `company_settings.testimonials_visible` has existed since the M-01 seed
 * and was read NOWHERE in src/ (plan §2, C-4): the V4 testimonials section
 * was removed at M-11 because the prototype's three quotes are explicitly
 * marked "Sample content for prototype. Replace with verified reviews before
 * launch" (audit F-13), and nothing replaced either the section or the flag.
 *
 * M-69 restores the section and makes the flag real. It does NOT invent
 * data. The honest position today:
 *
 *   * There is no `testimonials` table. **M-87** builds it, with the
 *     approval workflow, ratings and "featured" flag the website directive
 *     §32 B calls for. Until it lands this accessor returns an empty list.
 *   * Empty list ⇒ the section renders NOTHING, flag on or off. Flipping
 *     `testimonials_visible` to true with no approved reviews on file shows
 *     an empty band, never the prototype's sample quotes and never
 *     placeholder people. That is the whole point of the flag: it is a
 *     second lock, not a content source.
 *
 * When M-87 ships, this function is the only thing that changes — it queries
 * approved rows and the section starts rendering. The gate, markup, i18n
 * strings and tests are already in place.
 */

export interface Testimonial {
  id: string;
  /** The review text, as written by the customer. Never edited for tone. */
  quote: string;
  /** Display name, e.g. "J. Baptiste". */
  author: string;
  /** One-line context, e.g. "Owner-Operator · Dry Van · NJ". */
  context: string | null;
}

/**
 * Approved, publishable testimonials. Returns `[]` until M-87 supplies the
 * table — deliberately not a stub with fake rows.
 */
export async function getApprovedTestimonials(): Promise<Testimonial[]> {
  // TODO(M-87): select approved + featured rows from the `testimonials`
  // table, ordered by sort_order, and map them onto Testimonial.
  return [];
}
