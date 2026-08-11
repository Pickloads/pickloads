import "server-only";

import type { createClient } from "@/lib/supabase/server";
import {
  normalizeTrackingNumber,
  TRACKING_NUMBER_PREFIX,
  TRACKING_NUMBER_SEQUENCE_DIGITS,
  TRACKING_NUMBER_YEAR_DIGITS,
} from "@/lib/shipments/tracking-number";
import {
  SHIPMENT_BOARD_COLUMNS,
  type ShipmentBoardRow,
} from "@/lib/shipments/board";
import {
  shipmentScopeExpression,
  type StaffScope,
} from "@/lib/staff-scope";

/**
 * M-75 — §5's fourth property: *"searchable by admin and dispatcher"*.
 *
 * M-70 owns the format and the normaliser; M-71 owns the unique index; this
 * file is the search itself, and it exists as a module rather than as an
 * `ilike` in a page for one reason: what a dispatcher types is not what the
 * database stores.
 *
 * ── THE THREE THINGS A DISPATCHER ACTUALLY TYPES ──────────────────────────
 *
 *   1. **A pasted number** — `PL-2026-000458`, or `  pl 2026 – 000458 ` after
 *      a trip through an email client that turned the hyphen into an en dash
 *      and added a non-breaking space. `normalizeTrackingNumber` (M-70) folds
 *      all of that to the canonical form, and the lookup is then an EQUALITY
 *      on `shipments_tracking_number_key` — one index probe, whatever the
 *      table size. This is the case §5 is really about, and it is why M-70
 *      wrote a tolerant normaliser rather than a regex test.
 *   2. **The tail of a number** — `000458`, or `458`. A customer reads the
 *      last digits over the phone. There is no index for a trailing match, so
 *      this path is a BOUNDED scan (`ilike '%…'`, at most `SEARCH_LIMIT`
 *      rows) and it is documented as such rather than presented as free. At
 *      brokerage scale that is the right trade; when it stops being, M-98
 *      (global search) owns the trigram index, not this file.
 *   3. **A year-and-tail** — `2026-000458`. Handled by the same suffix path.
 *
 * Anything that is not plausibly part of a tracking number returns NO QUERY AT
 * ALL. A search box that runs `ilike '%%'` on an empty or hostile input is a
 * full table scan wearing a filter's clothes, and `%`/`_` typed by a user mean
 * the characters, not "match anything".
 *
 * ── §3/§19: THE SEARCH IS SCOPED ──────────────────────────────────────────
 *
 * §5 says admin AND dispatcher may search. It does not say a dispatcher may
 * search OUTSIDE their scope, and §19 says the opposite — *"dispatcher
 * permissions are limited"*. So the same `shipmentScopeExpression` the board
 * applies is applied here. Without it, search would be the hole in the
 * least-privilege model: every scoped board in the world is defeated by a
 * search box that ignores the scope.
 *
 * A dispatcher searching for a real tracking number outside their scope gets
 * ZERO results, exactly as if it did not exist. That is deliberate: the
 * alternative — "this exists but is not yours" — answers the question an
 * enumerating insider is asking.
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/** Hard bound on any search result set. Not a default — a ceiling. */
export const SEARCH_LIMIT = 25;

/** Longest input the parser will look at. */
const MAX_QUERY_LENGTH = 32;

export type TrackingSearchKind = "exact" | "pattern" | "none";

export interface TrackingSearchTerm {
  kind: TrackingSearchKind;
  /** Canonical tracking number (`exact`), or the digits behind the pattern. */
  value: string;
  /** The `ilike` pattern for a `pattern` search; null otherwise. */
  pattern: string | null;
  /** The raw input, trimmed — echoed back into the form. */
  raw: string;
}

const NONE: Omit<TrackingSearchTerm, "raw"> = {
  kind: "none",
  value: "",
  pattern: null,
};

/** Total digits in a whole tracking number (`2026` + `000458`). */
const FULL_DIGITS = TRACKING_NUMBER_YEAR_DIGITS + TRACKING_NUMBER_SEQUENCE_DIGITS;

/**
 * The `ilike` pattern for a tail search.
 *
 * Anchored on the `PL` prefix rather than open at both ends: every tracking
 * number starts with it, so `PL%000458` narrows more than `%000458` and cannot
 * match a value that merely ends in those digits. Exported so the unit suite
 * can assert the built pattern contains no wildcard the USER supplied — the
 * digits it is built from have already had every non-digit stripped, `%` and
 * `_` included.
 */
export function suffixPattern(digits: string): string {
  return `${TRACKING_NUMBER_PREFIX}%${digits}`;
}

/** `PL-2026-%0004` — a year the operator typed plus a partial sequence. */
export function yearPattern(year: string, rest: string): string {
  return `${TRACKING_NUMBER_PREFIX}-${year}-%${rest}`;
}

/**
 * Turn raw operator input into a search term. **Pure**, total, never throws —
 * it is fed whatever is in a URL.
 *
 * Precedence, and why each step exists:
 *
 *   1. **A well-formed number** → `exact`, on the unique index.
 *      `normalizeTrackingNumber` (M-70) folds dash variants, non-breaking
 *      spaces and case first, so a paste out of an email client works.
 *   2. **Ten digits** → RECONSTRUCTED into `PL-YYYY-######` and re-validated,
 *      then `exact`. This is the case M-70's normaliser cannot reach on its
 *      own: it folds separators but does not INSERT them, so `PL 2026 000458`
 *      and `2026-000458` — both of which people genuinely type — normalise to
 *      a string that fails the pattern. Reconstructing costs nothing and it is
 *      re-validated through the same normaliser, so an impossible year or
 *      sequence still falls through rather than becoming a lookup key.
 *   3. **Five to nine digits beginning with a plausible year** → a `PL-YYYY-%`
 *      pattern. Somebody typing along and stopping mid-number.
 *   4. **Two to six digits** → a tail pattern. The digits a customer reads out.
 *   5. Anything else → `none`, and the caller issues NO QUERY. A search box
 *      that runs `ilike '%%'` on an empty input is a full scan wearing a
 *      filter's clothes.
 */
export function parseTrackingSearch(raw: unknown): TrackingSearchTerm {
  if (typeof raw !== "string") return { ...NONE, raw: "" };
  const trimmed = raw.trim().slice(0, MAX_QUERY_LENGTH);
  if (trimmed === "") return { ...NONE, raw: "" };

  const canonical = normalizeTrackingNumber(trimmed);
  if (canonical !== null) {
    return { kind: "exact", value: canonical, pattern: null, raw: trimmed };
  }

  // Digit-only from here down, so no pattern below can contain a wildcard the
  // user supplied — `%` and `_` do not survive this replace.
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length === FULL_DIGITS) {
    const rebuilt = normalizeTrackingNumber(
      `${TRACKING_NUMBER_PREFIX}-${digits.slice(0, TRACKING_NUMBER_YEAR_DIGITS)}-${digits.slice(TRACKING_NUMBER_YEAR_DIGITS)}`,
    );
    if (rebuilt !== null) {
      return { kind: "exact", value: rebuilt, pattern: null, raw: trimmed };
    }
  }

  // THE TAIL CASE COMES FIRST, and the order is load-bearing. Six digits IS a
  // whole sequence (`000458`), so reading them as "year 0004 plus 58" would
  // send the commonest search — the digits a customer reads off an email — to
  // a pattern that matches nothing. Only 7–9 digits are ambiguous enough to be
  // a year plus a partial sequence.
  if (digits.length >= 2 && digits.length <= TRACKING_NUMBER_SEQUENCE_DIGITS) {
    return {
      kind: "pattern",
      value: digits,
      pattern: suffixPattern(digits),
      raw: trimmed,
    };
  }

  if (digits.length > TRACKING_NUMBER_SEQUENCE_DIGITS && digits.length < FULL_DIGITS) {
    const year = digits.slice(0, TRACKING_NUMBER_YEAR_DIGITS);
    const rest = digits.slice(TRACKING_NUMBER_YEAR_DIGITS);
    // Re-validated through the normaliser with a filled sequence, so "1999" or
    // "0000" is not treated as a year.
    const plausibleYear =
      normalizeTrackingNumber(`${TRACKING_NUMBER_PREFIX}-${year}-000000`) !== null;
    if (plausibleYear) {
      return {
        kind: "pattern",
        value: digits,
        pattern: yearPattern(year, rest),
        raw: trimmed,
      };
    }
  }

  return { ...NONE, raw: trimmed };
}

export interface TrackingSearchResult {
  term: TrackingSearchTerm;
  rows: ShipmentBoardRow[];
  /** True when the search ran and matched nothing. */
  searched: boolean;
  /** True when the read failed — the UI says so instead of "no results". */
  failed: boolean;
  /** True when the bound was hit and there may be more. */
  truncated: boolean;
}

export const EMPTY_SEARCH: TrackingSearchResult = {
  term: { kind: "none", value: "", pattern: null, raw: "" },
  rows: [],
  searched: false,
  failed: false,
  truncated: false,
};

/**
 * §5 search, scoped to the caller's staff scope.
 *
 * Reads through the CALLER'S cookie-bound client, so 0018's `"staff manage
 * shipments"` policy applies underneath the query-level scope — two bounds,
 * the same doctrine M-74 used for the shipper list.
 */
export async function searchShipmentsByTrackingNumber(
  supabase: ServerSupabase,
  raw: unknown,
  scope: StaffScope,
  userId: string,
): Promise<TrackingSearchResult> {
  const term = parseTrackingSearch(raw);
  if (term.kind === "none" || (term.kind === "pattern" && term.pattern === null)) {
    return { ...EMPTY_SEARCH, term };
  }

  let query = supabase.from("shipments").select(SHIPMENT_BOARD_COLUMNS);

  const scopeExpression = shipmentScopeExpression(scope, userId);
  if (scopeExpression !== null) query = query.or(scopeExpression);

  query =
    term.kind === "exact"
      ? query.eq("tracking_number", term.value)
      : query.ilike("tracking_number", term.pattern!);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(SEARCH_LIMIT);

  if (error) {
    console.error("[shipment-search] read failed", error.message);
    return { term, rows: [], searched: true, failed: true, truncated: false };
  }

  const rows = (data ?? []) as ShipmentBoardRow[];
  return {
    term,
    rows,
    searched: true,
    failed: false,
    truncated: rows.length === SEARCH_LIMIT,
  };
}
