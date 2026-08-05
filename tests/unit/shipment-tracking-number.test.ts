import { describe, expect, it } from "vitest";
import {
  formatTrackingNumber,
  generateTrackingNumber,
  isTrackingNumber,
  normalizeTrackingNumber,
  parseTrackingNumber,
  TRACKING_NUMBER_COLUMN,
  TRACKING_NUMBER_IMMUTABLE_TRIGGER,
  TRACKING_NUMBER_LENGTH,
  TRACKING_NUMBER_MAX_SEQUENCE,
  TRACKING_NUMBER_MAX_YEAR,
  TRACKING_NUMBER_MIN_SEQUENCE,
  TRACKING_NUMBER_MIN_YEAR,
  TRACKING_NUMBER_REGEX,
  TRACKING_NUMBER_SEQUENCE_SPACE,
  TRACKING_NUMBER_SQL_PATTERN,
  TRACKING_NUMBER_UNIQUE_INDEX,
} from "@/lib/shipments/tracking-number";

/**
 * M-70 — tracking-number contract (directive §5).
 *
 * The generator is pure and the format is a public lookup key, so this suite
 * is deliberately exhaustive: everything M-71's DDL and M-73's public form
 * will depend on is pinned here, including the SQL pattern the CHECK
 * constraint copies.
 */

describe("format (§5 PL-YYYY-######)", () => {
  it("produces the directive's own example", () => {
    expect(formatTrackingNumber(2026, 458)).toBe("PL-2026-000458");
  });

  it("zero-pads to six digits and is always 14 characters", () => {
    expect(formatTrackingNumber(2026, 0)).toBe("PL-2026-000000");
    expect(formatTrackingNumber(2026, 7)).toBe("PL-2026-000007");
    expect(formatTrackingNumber(2031, 999_999)).toBe("PL-2031-999999");
    for (const value of [0, 5, 4321, 999_999]) {
      expect(formatTrackingNumber(2026, value)).toHaveLength(
        TRACKING_NUMBER_LENGTH,
      );
    }
  });

  it("throws rather than minting a number the CHECK constraint would reject", () => {
    expect(() => formatTrackingNumber(2025, 1)).toThrow(RangeError);
    expect(() => formatTrackingNumber(10_000, 1)).toThrow(RangeError);
    expect(() => formatTrackingNumber(2026, -1)).toThrow(RangeError);
    expect(() => formatTrackingNumber(2026, 1_000_000)).toThrow(RangeError);
    expect(() => formatTrackingNumber(2026, 1.5)).toThrow(RangeError);
    expect(() => formatTrackingNumber(Number.NaN, 1)).toThrow(RangeError);
  });
});

describe("parse round-trip", () => {
  it("recovers exactly what was formatted, for every boundary", () => {
    const cases: Array<[number, number]> = [
      [TRACKING_NUMBER_MIN_YEAR, TRACKING_NUMBER_MIN_SEQUENCE],
      [TRACKING_NUMBER_MIN_YEAR, TRACKING_NUMBER_MAX_SEQUENCE],
      [TRACKING_NUMBER_MAX_YEAR, TRACKING_NUMBER_MIN_SEQUENCE],
      [TRACKING_NUMBER_MAX_YEAR, TRACKING_NUMBER_MAX_SEQUENCE],
      [2026, 458],
    ];
    for (const [year, sequence] of cases) {
      const formatted = formatTrackingNumber(year, sequence);
      expect(parseTrackingNumber(formatted)).toEqual({
        trackingNumber: formatted,
        year,
        sequence,
      });
    }
  });

  it("keeps a leading-zero sequence numeric, not string-shaped", () => {
    const parsed = parseTrackingNumber("PL-2026-000007");
    expect(parsed?.sequence).toBe(7);
    expect(parsed?.year).toBe(2026);
  });
});

describe("normalisation — tolerant on lookup, canonical on store", () => {
  const canonical = "PL-2026-000458";

  it("accepts the shapes a customer can plausibly paste", () => {
    const variants = [
      "PL-2026-000458",
      "pl-2026-000458",
      "Pl-2026-000458",
      "  PL-2026-000458  ",
      "PL - 2026 - 000458",
      "\tPL-2026-000458\n",
      "PL-\u00a02026-000458", // non-breaking space, as email clients insert
      "PL\u20102026\u2010000458", // Unicode hyphen
      "PL\u20112026\u2011000458", // non-breaking hyphen
      "PL\u20132026\u2013000458", // en dash, as pasted from a word processor
      "PL\u22122026\u2212000458", // minus sign
    ];
    for (const variant of variants) {
      expect(normalizeTrackingNumber(variant)).toBe(canonical);
      expect(isTrackingNumber(variant)).toBe(true);
    }
  });

  it("always returns the canonical uppercase form for storage", () => {
    const normalized = normalizeTrackingNumber("pl - 2026 - 000458");
    expect(normalized).toBe(canonical);
    expect(TRACKING_NUMBER_REGEX.test(normalized ?? "")).toBe(true);
  });
});

describe("rejection", () => {
  it("rejects malformed input without throwing", () => {
    const malformed = [
      "",
      "   ",
      "PL",
      "PL-2026",
      "2026-000458",
      "XX-2026-000458",
      "PL_2026_000458",
      "PL-2026-00045",
      "PL-202-000458",
      "PL-2026-00045A",
      "PL-2O26-000458", // letter O for zero
      "PL-2026-000458-1",
      "prefixPL-2026-000458",
      "PL-2026-000458suffix",
      "PL-2026-000458' OR 1=1--",
      "<script>PL-2026-000458</script>",
      "%50L-2026-000458",
    ];
    for (const input of malformed) {
      expect(normalizeTrackingNumber(input)).toBeNull();
      expect(parseTrackingNumber(input)).toBeNull();
      expect(isTrackingNumber(input)).toBe(false);
    }
  });

  it("rejects the year adjacent to the programme's first year", () => {
    expect(parseTrackingNumber("PL-2025-000458")).toBeNull();
    expect(parseTrackingNumber("PL-2026-000458")).not.toBeNull();
  });

  it("rejects sequence overflow rather than truncating it", () => {
    // Seven digits is not "999999 plus a stray character" — it is a
    // different number, and silently trimming it would resolve one
    // customer's lookup to another customer's shipment.
    expect(parseTrackingNumber("PL-2026-1000000")).toBeNull();
    expect(parseTrackingNumber("PL-2026-9999999")).toBeNull();
    expect(parseTrackingNumber("PL-20260-000458")).toBeNull();
  });

  it("rejects a multiline payload that contains a valid number", () => {
    // Whitespace folding must not turn an injected blob into a lookup key
    // beyond the exact canonical shape.
    expect(
      normalizeTrackingNumber("PL-2026-000458\nPL-2026-000459"),
    ).toBeNull();
  });
});

describe("generation", () => {
  it("defaults to the current UTC year", () => {
    const generated = generateTrackingNumber();
    expect(TRACKING_NUMBER_REGEX.test(generated)).toBe(true);
    expect(parseTrackingNumber(generated)?.year).toBe(
      new Date().getUTCFullYear(),
    );
  });

  it("accepts an explicit year and an injected sequence source", () => {
    expect(
      generateTrackingNumber({ year: 2027, randomSequence: () => 458 }),
    ).toBe("PL-2027-000458");
  });

  it("emits only well-formed, in-range numbers over many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5_000; i += 1) {
      const generated = generateTrackingNumber({ year: 2026 });
      expect(TRACKING_NUMBER_REGEX.test(generated)).toBe(true);
      const parsed = parseTrackingNumber(generated);
      expect(parsed).not.toBeNull();
      expect(parsed?.sequence).toBeGreaterThanOrEqual(
        TRACKING_NUMBER_MIN_SEQUENCE,
      );
      expect(parsed?.sequence).toBeLessThanOrEqual(
        TRACKING_NUMBER_MAX_SEQUENCE,
      );
      seen.add(generated);
    }
    // §5's mitigation is that the sequence is drawn, not counted. A counter
    // would produce 5000 consecutive values; the birthday bound says a
    // uniform draw over 10^6 loses only ~12 to collisions.
    expect(seen.size).toBeGreaterThan(4_950);
  });

  it("is non-sequential: consecutive draws are not consecutive numbers", () => {
    const sequences: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      const parsed = parseTrackingNumber(
        generateTrackingNumber({ year: 2026 }),
      );
      if (parsed !== null) sequences.push(parsed.sequence);
    }
    expect(sequences).toHaveLength(50);
    const ascendingByOne = sequences.every(
      (value, index) =>
        index === 0 || value === (sequences[index - 1] ?? -1) + 1,
    );
    expect(ascendingByOne).toBe(false);
  });

  it("covers the whole space, not a biased slice of it", () => {
    // Rejection sampling, not modulo — a plain `% 1e6` would over-weight the
    // low 294k sequences. Coarse but decisive: with 3000 uniform draws every
    // decile should be hit.
    const deciles = new Set<number>();
    for (let i = 0; i < 3_000; i += 1) {
      const parsed = parseTrackingNumber(
        generateTrackingNumber({ year: 2026 }),
      );
      if (parsed !== null) {
        deciles.add(
          Math.floor((parsed.sequence / TRACKING_NUMBER_SEQUENCE_SPACE) * 10),
        );
      }
    }
    expect(deciles.size).toBe(10);
  });
});

describe("constants M-71 must honour", () => {
  it("the SQL pattern and the JS regex accept and reject identically", () => {
    // Postgres POSIX and JS agree on this subset; the corpus is what makes
    // the equivalence a test rather than an assumption.
    const sql = new RegExp(TRACKING_NUMBER_SQL_PATTERN);
    const corpus = [
      "PL-2026-000458",
      "PL-9999-999999",
      "pl-2026-000458",
      "PL-2026-00045",
      "PL-2026-0004581",
      "XPL-2026-000458",
      "PL-2026-000458X",
      "PL-202A-000458",
      "",
    ];
    for (const candidate of corpus) {
      expect(sql.test(candidate)).toBe(TRACKING_NUMBER_REGEX.test(candidate));
    }
  });

  it("exports the identifiers the migration will name", () => {
    expect(TRACKING_NUMBER_COLUMN).toBe("tracking_number");
    expect(TRACKING_NUMBER_UNIQUE_INDEX).toBe("shipments_tracking_number_key");
    expect(TRACKING_NUMBER_IMMUTABLE_TRIGGER).toBe(
      "trg_shipments_tracking_number_immutable",
    );
    for (const identifier of [
      TRACKING_NUMBER_COLUMN,
      TRACKING_NUMBER_UNIQUE_INDEX,
      TRACKING_NUMBER_IMMUTABLE_TRIGGER,
    ]) {
      expect(identifier).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(identifier.length).toBeLessThanOrEqual(63); // Postgres NAMEDATALEN
    }
  });

  it("keeps the sequence space and digit count consistent", () => {
    expect(TRACKING_NUMBER_SEQUENCE_SPACE).toBe(
      TRACKING_NUMBER_MAX_SEQUENCE - TRACKING_NUMBER_MIN_SEQUENCE + 1,
    );
    expect(String(TRACKING_NUMBER_MAX_SEQUENCE)).toHaveLength(6);
  });
});
