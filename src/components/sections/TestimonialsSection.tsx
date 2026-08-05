import { Testimonials } from "@/components/sections/Testimonials";
import { getBooleanSetting } from "@/lib/company-settings";
import { getApprovedTestimonials } from "@/lib/testimonials";

/**
 * M-69 / P-6 — server gate for the testimonials band.
 *
 * TWO locks, both of which must open:
 *   1. `company_settings.testimonials_visible` (default false, M-01 seed) —
 *      the operator switch the runbook already documents and which, until
 *      M-69, was read nowhere in src/.
 *   2. At least one approved review from src/lib/testimonials.ts — which
 *      returns `[]` until M-87 builds the table.
 *
 * Either lock closed ⇒ renders nothing. Never sample content, never a
 * placeholder band.
 */
export async function TestimonialsSection() {
  const visible = await getBooleanSetting("testimonials_visible");
  if (!visible) return null;
  const items = await getApprovedTestimonials();
  return <Testimonials items={items} />;
}
