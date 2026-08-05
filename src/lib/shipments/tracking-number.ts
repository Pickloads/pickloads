/**
 * M-70 — PickLoads tracking numbers (`docs/DIRECTIVE-tracking.md` §5).
 *
 * Format: `PL-YYYY-######`, e.g. `PL-2026-000458`.
 *
 * §5 asks for six properties. This module owns four of them and hands the
 * other two to M-71 with the constants needed to implement them identically:
 *
 *   1. generated server-side ................. here (`generateTrackingNumber`)
 *   2. unique database constraint ............ M-71, `TRACKING_NUMBER_UNIQUE_INDEX`
 *   3. guessing mitigated .................... here (see "Guessing" below)
 *   4. searchable by admin/dispatcher ........ M-75, on the canonical form
 *   5. visible in emails and portals ......... M-73/M-74/M-79
 *   6. immutable after creation .............. M-71, `TRACKING_NUMBER_IMMUTABLE_TRIGGER`
 *
 * The identifiers M-71 must honour are exported below rather than described
 * in prose, so the migration and the application cannot drift apart: the DDL
 * writes `TRACKING_NUMBER_SQL_PATTERN` into its CHECK, names its unique index
 * and its update-blocking trigger from the constants here, and a unit test
 * proves the SQL pattern and the JavaScript regex accept and reject the same
 * strings.
 *
 * ── Guessing (§5: "non-sequential public guessing should be mitigated") ──
 *
 * The sequence is drawn from a CSPRNG, not a counter. That removes the
 * enumeration attack that matters commercially — a customer or competitor
 * incrementing a number they legitimately hold to read the next shipment —
 * and it removes the volume signal a sequential number leaks (`PL-2026-000458`
 * announces that PickLoads has moved 458 shipments this year).
 *
 * It is NOT presented as a secret, and this is the honest part of the
 * contract: 10^6 values per year is a small space, so a tracking number is an
 * identifier, never a credential. §5 says so itself — the mitigation is
 * "secure secondary verification", and the mandatory second factor (recipient
 * ZIP or access code, §4), the per-IP rate limit and the enumeration logging
 * in `shipment_tracking_access` are what actually protect the data. M-73
 * builds those; nothing here may be read as making the number sufficient on
 * its own.
 *
 * Collision handling belongs to the caller: the unique constraint is the
 * arbiter, and M-71/M-75 retry generation on a 23505. Retrying in this module
 * would require a database round trip and turn a pure function into a
 * stateful one.
 *
 * Plain module (no `server-only`): parsing and normalisation are needed by
 * the public `/track` form in M-73. Generation reaches for the Web Crypto
 * global rather than `node:crypto` for the same reason — importing the Node
 * builtin here would break any client bundle that only wanted the regex.
 * "Server-side generation" is a call-site rule (server actions and route
 * handlers only, per §19's no-anonymous-writes model), enforced by RLS: no
 * browser session can insert a shipment row whatever number it invents.
 */

/* ------------------------------------------------------------------ *
 * Format constants — M-71's DDL is written from these
 * ------------------------------------------------------------------ */

export const TRACKING_NUMBER_PREFIX = "PL";
export const TRACKING_NUMBER_SEPARATOR = "-";
/** Digits in the year segment. */
export const TRACKING_NUMBER_YEAR_DIGITS = 4;
/** Digits in the sequence segment — the `######` of `PL-YYYY-######`. */
export const TRACKING_NUMBER_SEQUENCE_DIGITS = 6;
/** Total length of a canonical tracking number (`PL-2026-000458`). */
export const TRACKING_NUMBER_LENGTH = 14;

/** Inclusive sequence bounds. The full six-digit space is usable. */
export const TRACKING_NUMBER_MIN_SEQUENCE = 0;
export const TRACKING_NUMBER_MAX_SEQUENCE = 999_999;
/** Distinct sequences available per year. */
export const TRACKING_NUMBER_SEQUENCE_SPACE = 1_000_000;

/**
 * First year the brokerage programme can issue a number. Nothing predates
 * `shipments`, so `PL-2025-000001` is malformed data, not a historical
 * record — rejecting it stops a typo or a forged input from being accepted
 * as a lookup key.
 */
export const TRACKING_NUMBER_MIN_YEAR = 2026;
/** Upper bound implied by the four-digit year segment. */
export const TRACKING_NUMBER_MAX_YEAR = 9999;

/** Canonical form. Anchored; case-sensitive; no surrounding slack. */
export const TRACKING_NUMBER_REGEX = /^PL-\d{4}-\d{6}$/;

/**
 * The same shape in POSIX form, for M-71's CHECK constraint. Kept beside the
 * regex and pinned to it by `tests/unit/shipment-tracking-number.test.ts`.
 */
export const TRACKING_NUMBER_SQL_PATTERN = "^PL-[0-9]{4}-[0-9]{6}$";

/** Column, index and trigger names M-71 must use. */
export const TRACKING_NUMBER_COLUMN = "tracking_number";
export const TRACKING_NUMBER_UNIQUE_INDEX = "shipments_tracking_number_key";
export const TRACKING_NUMBER_IMMUTABLE_TRIGGER =
  "trg_shipments_tracking_number_immutable";

/* ------------------------------------------------------------------ *
 * Parsing and normalisation
 * ------------------------------------------------------------------ */

export interface ParsedTrackingNumber {
  /** Canonical, storable form — always uppercase, always 14 characters. */
  trackingNumber: string;
  year: number;
  sequence: number;
}

/**
 * Dash characters a customer can plausibly paste: ASCII hyphen plus the
 * Unicode hyphen/dash block and the minus sign. A number copied out of a
 * word processor or an email client must not fail a lookup over typography.
 */
const DASH_VARIANTS = /[\u2010-\u2015\u2212]/g;
/** All Unicode whitespace, including the non-breaking space email clients add. */
const ANY_WHITESPACE = /\s+/g;

/**
 * Lookup-tolerant normalisation: trims, drops every internal space, folds
 * dash variants to ASCII and uppercases. `"  pl 2026 – 000458 "` and
 * `"PL-2026-000458"` are the same shipment to a customer, so they must be the
 * same string to the query — while the value STORED is always the canonical
 * output of `formatTrackingNumber`.
 *
 * Returns the canonical form, or `null` when the input is not a tracking
 * number at all. Never throws: it is fed raw user input on a public page.
 */
export function normalizeTrackingNumber(input: string): string | null {
  const folded = input
    .replace(DASH_VARIANTS, TRACKING_NUMBER_SEPARATOR)
    .replace(ANY_WHITESPACE, "")
    .toUpperCase();
  if (!TRACKING_NUMBER_REGEX.test(folded)) return null;
  const parts = folded.split(TRACKING_NUMBER_SEPARATOR);
  const year = Number(parts[1]);
  const sequence = Number(parts[2]);
  if (!isValidYear(year) || !isValidSequence(sequence)) return null;
  return folded;
}

/**
 * Full parse. `null` for anything that is not a well-formed, in-range
 * tracking number — malformed shape, a year before the programme existed, a
 * sequence that overflows six digits.
 */
export function parseTrackingNumber(
  input: string,
): ParsedTrackingNumber | null {
  const trackingNumber = normalizeTrackingNumber(input);
  if (trackingNumber === null) return null;
  const parts = trackingNumber.split(TRACKING_NUMBER_SEPARATOR);
  return {
    trackingNumber,
    year: Number(parts[1]),
    sequence: Number(parts[2]),
  };
}

/** Cheap predicate for form validation. */
export function isTrackingNumber(input: string): boolean {
  return normalizeTrackingNumber(input) !== null;
}

function isValidYear(year: number): boolean {
  return (
    Number.isInteger(year) &&
    year >= TRACKING_NUMBER_MIN_YEAR &&
    year <= TRACKING_NUMBER_MAX_YEAR
  );
}

function isValidSequence(sequence: number): boolean {
  return (
    Number.isInteger(sequence) &&
    sequence >= TRACKING_NUMBER_MIN_SEQUENCE &&
    sequence <= TRACKING_NUMBER_MAX_SEQUENCE
  );
}

/**
 * Build the canonical string from its parts.
 *
 * Throws `RangeError` on out-of-range input. This is a programmer error, not
 * user input — a caller that has computed an impossible year or sequence must
 * not be allowed to mint a number that the CHECK constraint will then reject
 * halfway through a shipment creation.
 */
export function formatTrackingNumber(year: number, sequence: number): string {
  if (!isValidYear(year)) {
    throw new RangeError(
      `tracking-number year out of range: ${year} (expected ${TRACKING_NUMBER_MIN_YEAR}–${TRACKING_NUMBER_MAX_YEAR})`,
    );
  }
  if (!isValidSequence(sequence)) {
    throw new RangeError(
      `tracking-number sequence out of range: ${sequence} (expected ${TRACKING_NUMBER_MIN_SEQUENCE}–${TRACKING_NUMBER_MAX_SEQUENCE})`,
    );
  }
  const digits = String(sequence).padStart(
    TRACKING_NUMBER_SEQUENCE_DIGITS,
    "0",
  );
  return [TRACKING_NUMBER_PREFIX, String(year), digits].join(
    TRACKING_NUMBER_SEPARATOR,
  );
}

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

/**
 * One uniformly distributed sequence from the platform CSPRNG.
 *
 * Rejection sampling, not `% 1_000_000`: 2^32 is not a multiple of the
 * sequence space, so a plain modulo would make the low ~294k sequences
 * marginally more likely. The bias is small but free to remove, and a
 * non-uniform "random" identifier is the kind of detail that quietly weakens
 * the §5 guessing mitigation.
 */
function secureSequence(): number {
  const limit =
    Math.floor(2 ** 32 / TRACKING_NUMBER_SEQUENCE_SPACE) *
    TRACKING_NUMBER_SEQUENCE_SPACE;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const draw = buffer[0];
    // `draw` is always defined for a length-1 Uint32Array; the check is what
    // `noUncheckedIndexedAccess` requires, and re-drawing is the correct
    // response either way — no fallback constant is ever substituted.
    if (draw !== undefined && draw < limit) {
      return draw % TRACKING_NUMBER_SEQUENCE_SPACE;
    }
  }
}

export interface GenerateTrackingNumberOptions {
  /** Defaults to the current UTC year — see the note below. */
  year?: number;
  /**
   * Sequence source. Exists so tests can pin the output; production callers
   * must leave it unset and get the CSPRNG.
   */
  randomSequence?: () => number;
}

/**
 * Mint a tracking number.
 *
 * The year comes from `Date.getUTCFullYear()`, not local time: the server's
 * timezone must not decide which year a shipment created at 23:30 on 31
 * December belongs to, and every other timestamp in this system is UTC.
 *
 * The caller inserts the result under the unique constraint and retries on
 * conflict (see the module note on collisions).
 */
export function generateTrackingNumber(
  options: GenerateTrackingNumberOptions = {},
): string {
  const year = options.year ?? new Date().getUTCFullYear();
  const sequence = (options.randomSequence ?? secureSequence)();
  return formatTrackingNumber(year, sequence);
}
