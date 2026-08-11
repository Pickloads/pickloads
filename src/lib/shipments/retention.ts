/**
 * M-80 — §9's *"Location history retention must be configurable"*, as
 * arithmetic.
 *
 * `docs/FINAL-IMPLEMENTATION-PLAN.md` §4 records the defect this closes:
 * retention *"was a policy with no purger"*. The purger itself is
 * `purge_expired_shipment_locations()` in migration 0027 — it has to be, so a
 * nightly sweep is one statement rather than a paginated read/delete loop over
 * PostgREST. What lives here is the WINDOW COMPUTATION, extracted so it can be
 * proved without a database and so the SQL ladder and the TypeScript ladder
 * can be pinned against each other.
 *
 * Pure. No `server-only`, no client, no `process.env`.
 */

/** Launch default. Argued in 0027 §0 — long enough for a billing dispute,
 *  short enough that a breach does not surrender a year of movements. */
export const DEFAULT_RETENTION_DAYS = 90;

/** The switchboard key. 0027 seeds it; the M-24 settings editor changes it. */
export const RETENTION_SETTING_KEY = "location_retention_days";

/** Ten years. Above this the setting is a typo, not a policy. */
export const MAX_RETENTION_DAYS = 3650;
export const MIN_RETENTION_DAYS = 1;

/**
 * Resolve the configured window, in whole days.
 *
 * FAILS SAFE, NOT OPEN — and the direction matters. Every rejected input
 * resolves to `DEFAULT_RETENTION_DAYS`, never to "keep forever": a retention
 * executor that quietly stops deleting because somebody typed `"ninety"` into
 * a settings box has become the policy-with-no-purger this module exists to
 * replace.
 *
 * Accepts what the switchboard can actually hold:
 *   * the JSON number the seed writes (`90`);
 *   * the string form the M-24 editor stores when an admin types (`"90"`,
 *     `" 90 "`, `"\"90\""` — the editor round-trips through JSON text);
 *   * a fractional value, floored (91.9 days is 91 days).
 *
 * Mirrors `public.location_retention_days()` in 0027 step for step.
 */
export function resolveRetentionDays(
  raw: unknown,
  fallback: number = DEFAULT_RETENTION_DAYS,
): number {
  const parsed = parseRetentionValue(raw);
  if (parsed === null) return fallback;
  if (parsed < MIN_RETENTION_DAYS || parsed > MAX_RETENTION_DAYS) return fallback;
  return Math.floor(parsed);
}

function parseRetentionValue(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === "string") {
    const unquoted = raw.trim().replace(/^"|"$/g, "").trim();
    if (unquoted === "") return null;
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(unquoted)) return null;
    const n = Number(unquoted);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * The `retention_expires_at` stamp a reading is written with.
 *
 * Stored rather than recomputed on read, for the reason 0027 states: a stored
 * stamp means SHORTENING the window still expires old rows (the purger's
 * second predicate sweeps on `recorded_at` against the *current* window),
 * while LENGTHENING it does not retroactively resurrect a row that was
 * already promised a shorter life.
 */
export function retentionExpiresAt(
  recordedAt: Date | string | number,
  retentionDays: number,
): string {
  const base =
    recordedAt instanceof Date
      ? recordedAt.getTime()
      : typeof recordedAt === "number"
        ? recordedAt
        : Date.parse(recordedAt);
  if (!Number.isFinite(base)) {
    throw new RangeError("retentionExpiresAt: recordedAt is not a valid instant");
  }
  const days = resolveRetentionDays(retentionDays);
  return new Date(base + days * 86_400_000).toISOString();
}

/**
 * Is this reading past the window?
 *
 * The same two-predicate rule the purger applies, so a UI that greys out an
 * expiring row and the sweep that deletes it cannot disagree.
 */
export function isRetentionExpired(
  reading: { recorded_at: string; retention_expires_at: string | null },
  retentionDays: number,
  now: number = Date.now(),
): boolean {
  if (reading.retention_expires_at !== null) {
    const stamped = Date.parse(reading.retention_expires_at);
    if (Number.isFinite(stamped) && stamped <= now) return true;
  }
  const recorded = Date.parse(reading.recorded_at);
  if (!Number.isFinite(recorded)) return false;
  return recorded < now - resolveRetentionDays(retentionDays) * 86_400_000;
}
