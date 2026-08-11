/**
 * M-79 — resolving operator-written public text for an EMAIL.
 *
 * ── THE BUG THIS EXISTS TO PREVENT ────────────────────────────────────────
 *
 * M-73's decision D-6 stores a curated phrase as a TOKEN, not as prose:
 * `ShipmentOpsForms.tsx` writes `phrase:delay.traffic` into
 * `shipment_events.public_message` / `shipments.delay_reason_public` when a
 * dispatcher picks from the library. Every RENDERING surface already resolves
 * it — `/track` (`TrackingResult.tsx`), the shipper detail page and the
 * carrier detail page all call `resolvePublicText`.
 *
 * An email that printed the stored value verbatim would mail a customer the
 * literal string `phrase:delay.traffic`. Worse, it would do so in the one
 * channel that is archived, forwarded and read outside the product.
 *
 * ── WHY IT READS THE MESSAGE CATALOGUES ───────────────────────────────────
 *
 * Because §24 and the M-79 brief both say the same thing: reuse M-73's phrase
 * library *"rather than authoring parallel copy"*. The library is already
 * translated into all five locales under `shipment.phrase.*` — and unlike the
 * `EmailDict` copy in this folder (where ru/ht mirror en pending native
 * review), those five are the site's own reviewed strings. Re-typing them into
 * an `EmailDict` would create a second vocabulary that drifts from the page
 * the email links to, which is exactly the failure M-70's one-definition rule
 * exists to prevent.
 *
 * The catalogues are imported STATICALLY rather than through next-intl's
 * request config: an email is rendered by the M-79 worker, from a cron
 * invocation, where there is no request, no locale segment and no
 * `NextIntlClientProvider`. A static import is also what lets the unit lane
 * render all eleven templates in all five locales with no test harness.
 *
 * ── FREE TEXT IS NOT TRANSLATED, AND SAYS SO ──────────────────────────────
 *
 * D-6 option (a) is the fallback for genuinely novel dispatcher prose: show it
 * verbatim, in English, under an honest label. §24 forbids silently
 * machine-translating customer-facing text and §30 forbids implying a
 * capability the product does not have. So free text arrives at the customer
 * labelled `Written by dispatch, in English` — the site's own
 * `shipment.label.dispatch_written` string, in the reader's language.
 */

import {
  FREE_TEXT_NOTICE_KEY,
  phraseKey,
  resolvePublicText,
} from "@/lib/shipments/phrases";
import type { EmailLocale } from "./i18n";

import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import ru from "../../messages/ru.json";
import ht from "../../messages/ht.json";

const CATALOGS: Record<EmailLocale, unknown> = { en, es, fr, ru, ht };

/**
 * Walk a dotted message key. Returns null rather than throwing: a retired
 * phrase id must degrade to the honest free-text path, not blow up a send
 * that is already three retries deep.
 */
function lookup(locale: EmailLocale, key: string): string | null {
  let node: unknown = CATALOGS[locale];
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return null;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" && node.trim() !== "" ? node : null;
}

export interface EmailPublicText {
  /** The sentence to print. */
  text: string;
  /**
   * §24/§30's honest label, present ONLY for free text. A phrase is genuinely
   * in the reader's language and labelling it would be false in the other
   * direction.
   */
  notice: string | null;
}

/**
 * Resolve a stored public string for one email locale.
 *
 * Three outcomes, mirroring `resolvePublicText` exactly so the email and the
 * tracking page it links to never disagree about the same fact:
 *
 *   1. a known phrase token (or the library's own English typed by hand)
 *      → the translated sentence, no label;
 *   2. anything else → verbatim, with the honest label;
 *   3. null/blank → null. An empty "From dispatch" row is worse than none.
 *
 * A phrase whose translation is MISSING from the catalogue falls through to
 * the labelled free-text path carrying its canonical English, because a
 * customer reading English under an honest label is strictly better served
 * than one reading `phrase:delay.traffic`.
 */
export function resolveEmailPublicText(
  locale: EmailLocale,
  raw: string | null | undefined,
): EmailPublicText | null {
  const resolved = resolvePublicText(raw);
  if (resolved === null) return null;

  if (resolved.kind === "phrase") {
    const translated = lookup(locale, phraseKey(resolved.id));
    if (translated !== null) return { text: translated, notice: null };
    const english = lookup("en", phraseKey(resolved.id));
    return {
      text: english ?? resolved.id,
      notice: lookup(locale, FREE_TEXT_NOTICE_KEY),
    };
  }

  return {
    text: resolved.text,
    notice: lookup(locale, FREE_TEXT_NOTICE_KEY),
  };
}
