/**
 * M-73 — the curated public-phrase library (decision **D-6**).
 *
 * THE PROBLEM. §24 requires every customer-facing tracking string to be
 * localized into five languages, and forbids machine-translating
 * customer-specific free text automatically "without a defined workflow".
 * §17 and §21 simultaneously require dispatchers to publish human sentences —
 * `shipment_events.public_message`, `shipments.delay_reason_public`,
 * `shipment_exceptions.public_description`. A dispatcher in Irvington types
 * English at 06:40; a Haitian-Creole-speaking consignee opens `/track` at
 * 06:41. Those two sentences cannot both be satisfied by wishing.
 *
 * THE DECISION. `docs/FINAL-IMPLEMENTATION-PLAN.md` §6, D-6, resolved per its
 * own recommendation: **(b) a curated phrase library, translated ×5, for
 * statuses, delay reasons and standard exception messages; (a) an honest
 * label — "written by dispatch, English" — as the fallback for genuinely
 * novel free text.** Never machine-translate silently.
 *
 * HOW IT WORKS. A dispatcher picking from the library stores a TOKEN
 * (`phrase:delay.traffic`) rather than prose. `/track` resolves the token to a
 * message key and renders it in the visitor's own language. Anything that is
 * not a token is free text: it renders verbatim, in the language it was
 * written in, under a visible label saying so and with `lang="en"` on the
 * element so a screen reader switches voice instead of reading English with
 * French phonemes.
 *
 * WHY A TOKEN AND NOT AN ENUM COLUMN. The columns are `text` in shipped
 * migrations (0017/0019) and hold either kind of value; a token is a value
 * those columns already accept, so the library needs no schema change and no
 * backfill. It also degrades correctly: a token whose id was retired renders
 * as free text, not as a blank.
 *
 * LEGACY / TYPED-BY-HAND TOLERANCE. A dispatcher who types the library's own
 * English sentence by hand gets the translated version anyway — the resolver
 * falls back to an exact match on canonical English (case- and
 * punctuation-insensitive). That is a convenience, never a guess: only the
 * library's own strings match, and anything else is labelled free text.
 *
 * Pure module by design: `/track` renders this in a client component, M-75's
 * dispatcher picker will render the same list, and a second copy of the
 * vocabulary is exactly the drift M-70 exists to prevent.
 */

import { SHIPMENT_I18N_NAMESPACE } from "@/lib/shipments/types";

/** Prefix that marks a stored value as a library reference rather than prose. */
export const PHRASE_TOKEN_PREFIX = "phrase:";

/**
 * The curated library, id → canonical English.
 *
 * Four groups. Three are D-6's own named categories; the fourth is M-78's
 * extension, and it is an EXTENSION rather than a parallel mechanism by
 * construction — same object, same token prefix, same resolver, same
 * `shipment.phrase.*` key space, so `/track`, the shipper detail page and
 * every dispatcher picker pick it up with no code change at all:
 *
 *   `update.*`     — standard public status notes (§7 `public_message`)
 *   `delay.*`      — standard delay reasons (§10 `delay_reason_public`)
 *   `exception.*`  — standard exception messages (§21 `public_description`)
 *   `resolution.*` — M-78. What the customer is told when an exception is
 *                    CLOSED (§21's open/resolve lifecycle, customer half).
 *
 * §21's lifecycle has two ends and D-6 only furnished one. An exception that
 * opens in the reader's own language and then closes in English — or, worse,
 * closes silently and leaves a stale warning banner on the page — is the
 * failure D-6 exists to prevent, arriving one step later. Every resolution
 * sentence is written to the same standard as the rest: clear, calm, no blame,
 * no legal conclusion, no promise the system cannot keep.
 *
 * M-78 also adds THREE delay reasons (`delay.customs`, `delay.detention`,
 * `delay.reroute`) that dispatchers were reaching for free text to express.
 * Adding a curated phrase is strictly better than free text: free text renders
 * in English under an honest label, a phrase renders in the reader's language.
 *
 * Every sentence is written to §21's standard: clear, calm, no blame, no legal
 * conclusion, no internal detail, and no promise the system cannot keep.
 *
 * `exception.other` DOES NOT EXIST, deliberately. §21's thirteenth exception
 * type is the catch-all, and a canned sentence for "something else happened"
 * would either say nothing ("There is an issue with this shipment") or say
 * something untrue. An `other` exception with no dispatcher text has nothing
 * honest to publish, and M-70's DTO already omits an exception whose
 * `public_description` is null.
 */
export const PUBLIC_PHRASES = {
  /* ---- standard public status notes ---- */
  "update.carrier_assigned": "A carrier has been assigned to this shipment.",
  "update.dispatched": "The truck is on its way to the pickup location.",
  "update.arrived_at_pickup": "The truck has arrived at the pickup location.",
  "update.picked_up": "The freight has been picked up.",
  "update.in_transit": "The shipment is in transit.",
  "update.arrived_at_delivery": "The truck has arrived at the delivery location.",
  "update.delivered": "The shipment has been delivered.",
  "update.pod_requested": "Dispatch has requested proof of delivery.",
  "update.eta_updated": "The estimated delivery time has been updated.",

  /* ---- standard delay reasons ---- */
  "delay.traffic": "Traffic is slowing the truck down.",
  "delay.weather": "Weather is slowing the truck down.",
  "delay.facility": "The truck is waiting at the facility.",
  "delay.mechanical": "The truck needs a repair before it can continue.",
  "delay.appointment": "The truck is waiting for its appointment time.",
  "delay.previous_stop": "The truck is running late from an earlier stop.",
  "delay.paperwork": "Paperwork is being completed at the facility.",
  "delay.driver_hours": "The driver is taking a required rest break.",
  "delay.customs": "The shipment is waiting on a border or customs check.",
  "delay.detention": "The truck is still waiting to be loaded or unloaded.",
  "delay.reroute": "The route has changed and the truck is taking a longer way.",

  /* ---- standard exception messages ---- */
  "exception.pickup_delay":
    "Pickup is running later than scheduled. Dispatch is confirming a new time.",
  "exception.delivery_delay":
    "Delivery is running later than scheduled. Dispatch is confirming a new time.",
  "exception.mechanical_issue":
    "The truck needs a repair. Dispatch is arranging the fix or a replacement truck.",
  "exception.weather":
    "Weather is affecting this route. Dispatch is monitoring conditions.",
  "exception.traffic":
    "Traffic is affecting this route. Dispatch is monitoring the delay.",
  "exception.facility_delay":
    "The facility is taking longer than expected. Dispatch is in contact with them.",
  "exception.rejected_freight":
    "The receiver did not accept part of this shipment. Dispatch is working on next steps.",
  "exception.damaged_freight":
    "Damage was reported on this shipment. Dispatch is documenting it with the carrier.",
  "exception.missing_appointment":
    "An appointment time still needs to be confirmed. Dispatch is arranging it.",
  "exception.driver_unavailable":
    "The assigned driver is unavailable. Dispatch is arranging coverage.",
  "exception.carrier_cancellation":
    "The assigned carrier can no longer run this load. Dispatch is sourcing another truck.",
  "exception.documentation_issue":
    "A document for this shipment needs correcting. Dispatch is handling it.",

  /* ---- M-78: standard RESOLUTION messages (§21's other end) ---- */
  "resolution.moving_again": "The shipment is moving again.",
  "resolution.rescheduled":
    "A new appointment time has been confirmed and is shown above.",
  "resolution.new_carrier":
    "Another truck has been assigned and is on its way.",
  "resolution.repaired": "The repair is done and the truck is back on the road.",
  "resolution.conditions_cleared":
    "Conditions on the route have cleared and the truck is moving.",
  "resolution.delivered_complete":
    "The shipment has been delivered and this issue is closed.",
  "resolution.documents_corrected":
    "The paperwork has been corrected and this issue is closed.",
  "resolution.resolved_with_customer":
    "Dispatch has been in touch and this issue is now closed.",
} as const;

export type PublicPhraseId = keyof typeof PUBLIC_PHRASES;

export const PUBLIC_PHRASE_IDS = Object.keys(
  PUBLIC_PHRASES,
) as PublicPhraseId[];

/**
 * The library's groups, as data.
 *
 * Every picker in the product filters `PUBLIC_PHRASE_IDS` by one of these
 * prefixes, so the list lives here rather than as a union re-typed in each
 * client component — the fourth group arriving in M-78 was a one-line edit
 * because of it, and a fifth will be too.
 * `tests/unit/shipment-phrases.test.ts` asserts every id belongs to exactly
 * one group, so a phrase that no picker can reach is a test failure rather
 * than a dead translation in five catalogues.
 */
export const PHRASE_GROUPS = [
  "update",
  "delay",
  "exception",
  "resolution",
] as const;

export type PhraseGroup = (typeof PHRASE_GROUPS)[number];

/** The ids in one group, in declaration order. */
export function phrasesInGroup(group: PhraseGroup): PublicPhraseId[] {
  return PUBLIC_PHRASE_IDS.filter((id) => id.startsWith(`${group}.`));
}

/** Message key for a library phrase, e.g. `shipment.phrase.delay.traffic`. */
export function phraseKey(id: PublicPhraseId): string {
  return `${SHIPMENT_I18N_NAMESPACE}.phrase.${id}`;
}

/** The token a dispatcher surface stores when the library entry is picked. */
export function phraseToken(id: PublicPhraseId): string {
  return `${PHRASE_TOKEN_PREFIX}${id}`;
}

/**
 * §30's honest label for text that is NOT in the library.
 *
 * This key is the whole reason D-6 option (a) survives as the fallback: the
 * page never pretends the sentence was written in the reader's language.
 */
export const FREE_TEXT_NOTICE_KEY = `${SHIPMENT_I18N_NAMESPACE}.label.dispatch_written`;

/** BCP-47 tag for free text, so assistive technology switches pronunciation. */
export const FREE_TEXT_LANG = "en";

export type ResolvedPublicText =
  /** A library phrase — render `t(key)` in the visitor's own language. */
  | { kind: "phrase"; id: PublicPhraseId; key: string }
  /**
   * Genuinely novel dispatcher prose. Render `text` verbatim with
   * `lang={lang}` and the `noticeKey` label beside it. NEVER translated,
   * never machine-translated (§24).
   */
  | { kind: "free_text"; text: string; noticeKey: string; lang: string };

/** Canonical English → id, for the typed-by-hand tolerance described above. */
const BY_ENGLISH = new Map<string, PublicPhraseId>(
  PUBLIC_PHRASE_IDS.map((id) => [canonicalize(PUBLIC_PHRASES[id]), id]),
);

function canonicalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isPhraseId(value: string): value is PublicPhraseId {
  return Object.prototype.hasOwnProperty.call(PUBLIC_PHRASES, value);
}

/**
 * Resolve a stored public string into something the page can render honestly.
 *
 * Returns null for null, undefined or whitespace — an empty banner is worse
 * than no banner (the same rule M-70's DTO applies to a null
 * `public_description`).
 *
 * Precedence, and why:
 *   1. `phrase:<id>` token → translated. The explicit case.
 *   2. exact canonical-English match → translated. A dispatcher who typed the
 *      library's own sentence meant the library's own sentence.
 *   3. anything else → free text, labelled. Including an UNKNOWN token, which
 *      renders as the literal `phrase:whatever` under the honest label rather
 *      than as a blank — a retired id must degrade visibly, not silently.
 */
export function resolvePublicText(
  raw: string | null | undefined,
): ResolvedPublicText | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  if (trimmed.startsWith(PHRASE_TOKEN_PREFIX)) {
    const id = trimmed.slice(PHRASE_TOKEN_PREFIX.length).trim();
    if (isPhraseId(id)) return { kind: "phrase", id, key: phraseKey(id) };
  }

  const matched = BY_ENGLISH.get(canonicalize(trimmed));
  if (matched !== undefined) {
    return { kind: "phrase", id: matched, key: phraseKey(matched) };
  }

  return {
    kind: "free_text",
    text: trimmed,
    noticeKey: FREE_TEXT_NOTICE_KEY,
    lang: FREE_TEXT_LANG,
  };
}
