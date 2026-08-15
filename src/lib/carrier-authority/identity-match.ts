import {
  normalizeRegistrationNumber,
  type NormalizedAuthorityRecord,
} from "./provider";

/**
 * M-93 Phase 3 — comparing what the applicant typed with what the authority
 * returned.
 *
 * ── THE LINE THIS FILE WALKS ─────────────────────────────────────────────
 *
 * Too strict and every legitimate carrier lands in manual review because they
 * wrote "Acme Trucking LLC" where FMCSA has "ACME TRUCKING, L.L.C.". Too loose
 * and "Acme Trucking LLC" matches "Acme Transport LLC", which is a different
 * company — and approving a different company is how an applicant inherits
 * someone else's operating authority.
 *
 * So normalisation is limited to things that carry NO meaning: case,
 * whitespace, punctuation, and the entity suffix. What it must never do is
 * edit-distance or token-subset matching, both of which can quietly equate
 * materially different businesses. Anything that is not an exact or a
 * normalized match is `mismatch`, and the risk engine sends mismatches to a
 * human.
 */

export type MatchResult = "exact" | "normalized" | "mismatch" | "unavailable";

/** Entity suffixes that carry no distinguishing meaning. */
const ENTITY_SUFFIXES = [
  "llc",
  "l l c",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "ltd",
  "limited",
  "lp",
  "llp",
  "pllc",
  "dba",
];

/**
 * Case, punctuation, whitespace and entity suffix removed.
 *
 * Deliberately NOT removed: any other word. Dropping "Transport" to match
 * "Trucking" would be the failure this whole file exists to prevent.
 */
export function normalizeBusinessName(raw: string | null): string {
  if (!raw) return "";
  let s = raw
    .toLowerCase()
    .normalize("NFKD")
    // Strip accents so "Société" and "Societe" agree.
    .replace(/[̀-ͯ]/g, "")
    // Punctuation → space. "L.L.C." becomes "l l c" and is caught below.
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Strip trailing entity suffixes, repeatedly: "acme trucking llc inc".
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of ENTITY_SUFFIXES) {
      if (s === suffix) continue; // never reduce a name to nothing
      if (s.endsWith(` ${suffix}`)) {
        s = s.slice(0, -(suffix.length + 1)).trim();
        changed = true;
      }
    }
  }
  return s;
}

export function matchBusinessName(
  entered: string | null,
  authoritative: string | null,
): MatchResult {
  if (!entered || !authoritative) return "unavailable";
  if (entered.trim() === authoritative.trim()) return "exact";
  const a = normalizeBusinessName(entered);
  const b = normalizeBusinessName(authoritative);
  if (a === "" || b === "") return "unavailable";
  return a === b ? "normalized" : "mismatch";
}

/**
 * Registration numbers.
 *
 * "MC-123456", "mc 123456" and "0123456" are the same number, so the digits
 * are compared. Anything else is a mismatch — there is no near-miss for a
 * registration number, and a transposed digit is a different carrier.
 */
export function matchRegistrationNumber(
  entered: string | null,
  authoritative: string | null,
): MatchResult {
  const a = normalizeRegistrationNumber(entered);
  const b = normalizeRegistrationNumber(authoritative);
  if (!a || !b) return "unavailable";
  if (entered?.trim() === authoritative?.trim()) return "exact";
  return a === b ? "normalized" : "mismatch";
}

export interface IdentityComparison {
  nameMatch: MatchResult;
  dotMatch: MatchResult;
  mcMatch: MatchResult;
}

export interface EnteredIdentity {
  legalName: string;
  usdotNumber: string;
  mcNumber: string | null;
}

export function compareIdentity(
  entered: EnteredIdentity,
  record: NormalizedAuthorityRecord,
): IdentityComparison {
  return {
    nameMatch: matchBusinessName(entered.legalName, record.legalName),
    dotMatch: matchRegistrationNumber(entered.usdotNumber, record.usdotNumber),
    // An applicant with no MC is common (intrastate, or exempt). That is
    // `unavailable` — nothing to disagree about — never a mismatch.
    mcMatch: matchRegistrationNumber(entered.mcNumber, record.mcNumber),
  };
}
