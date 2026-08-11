import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  RETENTION_SETTING_KEY,
  isRetentionExpired,
  resolveRetentionDays,
  retentionExpiresAt,
} from "@/lib/shipments/retention";

/**
 * M-80 — §9's *"Location history retention must be configurable"*.
 *
 * `docs/FINAL-IMPLEMENTATION-PLAN.md` §4 records the defect: retention was
 * *"a policy with no purger"*. The purger is SQL (0027's
 * `purge_expired_shipment_locations()`), and the integration lane proves it
 * actually deletes. This suite proves the WINDOW COMPUTATION — the part that
 * decides what "expired" means — and pins it against the SQL ladder so the
 * two cannot disagree.
 *
 * THE DIRECTION OF FAILURE IS THE POINT. Every rejected setting resolves to
 * 90 days, never to "keep forever": a retention executor that silently stops
 * deleting because somebody typed `"ninety"` into a settings box has become
 * the policy-with-no-purger again, and it would look healthy while doing it.
 */

describe("the retention window (§9)", () => {
  it("has a launch default of 90 days and sane bounds", () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(90);
    expect(MIN_RETENTION_DAYS).toBe(1);
    expect(MAX_RETENTION_DAYS).toBe(3650);
    expect(RETENTION_SETTING_KEY).toBe("location_retention_days");
  });

  it("accepts the JSON number the seed writes", () => {
    expect(resolveRetentionDays(90)).toBe(90);
    expect(resolveRetentionDays(30)).toBe(30);
    expect(resolveRetentionDays(1)).toBe(1);
    expect(resolveRetentionDays(3650)).toBe(3650);
  });

  it("accepts the string forms the M-24 settings editor stores", () => {
    // The editor round-trips free text through JSON, so all three of these
    // are values an admin can actually produce.
    expect(resolveRetentionDays("30")).toBe(30);
    expect(resolveRetentionDays("  30  ")).toBe(30);
    expect(resolveRetentionDays('"30"')).toBe(30);
  });

  it("FAILS SAFE to the default on every unusable value — never to forever", () => {
    for (const bad of [
      undefined,
      null,
      "",
      "   ",
      "ninety",
      "30 days",
      "0x1e",
      true,
      false,
      {},
      [],
      NaN,
      Infinity,
      -Infinity,
    ]) {
      expect(
        resolveRetentionDays(bad),
        `"${String(bad)}" must fall back to the default`,
      ).toBe(DEFAULT_RETENTION_DAYS);
    }
  });

  it("FAILS SAFE on out-of-range values in BOTH directions", () => {
    expect(resolveRetentionDays(0)).toBe(DEFAULT_RETENTION_DAYS);
    expect(resolveRetentionDays(-1)).toBe(DEFAULT_RETENTION_DAYS);
    expect(resolveRetentionDays(0.5)).toBe(DEFAULT_RETENTION_DAYS);
    expect(resolveRetentionDays(3651)).toBe(DEFAULT_RETENTION_DAYS);
    expect(resolveRetentionDays(1_000_000)).toBe(DEFAULT_RETENTION_DAYS);
  });

  it("floors a fractional in-range value rather than rounding up", () => {
    // 91.9 days is 91 days: a retention window must never be longer than the
    // number an operator believes they typed.
    expect(resolveRetentionDays(91.9)).toBe(91);
    expect(resolveRetentionDays("45.5")).toBe(45);
  });

  it("honours an explicit fallback, so a caller can be stricter than 90", () => {
    expect(resolveRetentionDays("garbage", 7)).toBe(7);
  });

  it("ANTI-VACUITY: a valid value is NOT replaced by the fallback", () => {
    // Without this, every assertion above would pass on a function that
    // always returned the fallback.
    expect(resolveRetentionDays(45, 7)).toBe(45);
    expect(resolveRetentionDays(45)).not.toBe(DEFAULT_RETENTION_DAYS);
  });
});

describe("retentionExpiresAt", () => {
  const recorded = "2026-08-04T13:00:00.000Z";

  it("stamps exactly N days after the reading", () => {
    expect(retentionExpiresAt(recorded, 90)).toBe("2026-11-02T13:00:00.000Z");
    expect(retentionExpiresAt(recorded, 1)).toBe("2026-08-05T13:00:00.000Z");
  });

  it("accepts a Date, an ISO string and an epoch millisecond value alike", () => {
    const ms = Date.parse(recorded);
    expect(retentionExpiresAt(new Date(ms), 30)).toBe(
      retentionExpiresAt(recorded, 30),
    );
    expect(retentionExpiresAt(ms, 30)).toBe(retentionExpiresAt(recorded, 30));
  });

  it("uses the safe default when handed an unusable window", () => {
    expect(retentionExpiresAt(recorded, 0)).toBe(
      retentionExpiresAt(recorded, DEFAULT_RETENTION_DAYS),
    );
  });

  it("throws on an unparseable instant rather than stamping the epoch", () => {
    expect(() => retentionExpiresAt("not-a-date", 90)).toThrow(RangeError);
  });
});

describe("isRetentionExpired — the purger's two predicates", () => {
  const now = Date.parse("2026-11-01T00:00:00.000Z");

  it("expires on the STAMP when the stamp has passed", () => {
    expect(
      isRetentionExpired(
        {
          recorded_at: "2026-10-31T00:00:00.000Z",
          retention_expires_at: "2026-10-31T12:00:00.000Z",
        },
        3650,
        now,
      ),
    ).toBe(true);
  });

  it("expires on the CURRENT WINDOW even when the stamp is later", () => {
    // Shortening the window takes effect immediately — the direction that
    // matters for a privacy control.
    expect(
      isRetentionExpired(
        {
          recorded_at: "2026-01-01T00:00:00.000Z",
          retention_expires_at: "2027-01-01T00:00:00.000Z",
        },
        30,
        now,
      ),
    ).toBe(true);
  });

  it("does NOT resurrect a row whose stamp already passed when the window is lengthened", () => {
    expect(
      isRetentionExpired(
        {
          recorded_at: "2026-10-30T00:00:00.000Z",
          retention_expires_at: "2026-10-31T00:00:00.000Z",
        },
        3650,
        now,
      ),
    ).toBe(true);
  });

  it("keeps a fresh reading", () => {
    expect(
      isRetentionExpired(
        {
          recorded_at: "2026-10-31T00:00:00.000Z",
          retention_expires_at: "2027-01-29T00:00:00.000Z",
        },
        90,
        now,
      ),
    ).toBe(false);
  });

  it("still expires a reading that was never stamped", () => {
    // 0027 stamps every row it writes, but a row inserted by a future path
    // that forgot to must not become immortal.
    expect(
      isRetentionExpired(
        { recorded_at: "2020-01-01T00:00:00.000Z", retention_expires_at: null },
        90,
        now,
      ),
    ).toBe(true);
  });

  it("treats an unparseable recorded_at as not-expired rather than deleting it", () => {
    expect(
      isRetentionExpired(
        { recorded_at: "garbage", retention_expires_at: null },
        90,
        now,
      ),
    ).toBe(false);
  });
});

/* ================================================================== *
 * Anti-drift: the SQL ladder and the TypeScript ladder must agree
 * ================================================================== */

describe("SQL ↔ TypeScript parity (migration 0027)", () => {
  const sql = readFileSync(
    "supabase/migrations/0027_shipment_locations_providers.sql",
    "utf8",
  );

  it("the SQL fallback is the SAME 90 days", () => {
    // `location_retention_days()` has four `return 90` branches — missing key,
    // wrong jsonb type, parse failure, out of range. If any is changed to a
    // different constant the two ladders disagree silently.
    const returns = sql.match(/return 90;/g) ?? [];
    expect(returns.length).toBeGreaterThanOrEqual(4);
    expect(sql).not.toMatch(/return 0;\s*end;/);
  });

  it("the SQL bounds are the SAME 1..3650", () => {
    expect(sql).toContain("parsed < 1 or parsed > 3650");
    expect(sql).toContain("p_retention_days between 1 and 3650");
  });

  it("the purger deletes on BOTH predicates, and is bounded", () => {
    expect(sql).toContain("retention_expires_at <= now()");
    expect(sql).toContain("recorded_at < v_cutoff");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("more_remaining");
  });

  it("the seeded key matches the constant this module exports", () => {
    expect(sql).toContain(`'${RETENTION_SETTING_KEY}'`);
    const seed = readFileSync("supabase/seed.sql", "utf8");
    expect(seed).toContain(`'${RETENTION_SETTING_KEY}'`);
  });

  it("the purge function is granted to service_role ALONE", () => {
    expect(sql).toContain(
      "revoke all on function public.purge_expired_shipment_locations(integer, integer) from public",
    );
    expect(sql).toContain(
      "grant execute on function public.purge_expired_shipment_locations(integer, integer) to service_role",
    );
  });
});
