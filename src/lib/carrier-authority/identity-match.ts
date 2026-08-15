import {
  normalizeRegistrationNumber,
  type CarrierDocket,
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

/**
 * Does the submitted MC actually belong to the submitted USDOT?
 *
 * ── WHY THIS IS NOT `matchRegistrationNumber` ────────────────────────────
 *
 * The carrier record carries at most one `mcNumber`, and a carrier may hold
 * several dockets. Comparing against that single field gets it wrong in both
 * directions: it rejects a legitimate carrier whose *other* docket is the one
 * they gave us, and — the dangerous direction — a submitted MC that happens to
 * equal that one field passes without anyone checking the relationship.
 *
 * So the comparison is against the SET from `/carriers/{dot}/docket-numbers`.
 *
 * `unavailable` when the set was never retrieved: not knowing the relationship
 * is not the same as knowing it is wrong, and only one of those is a finding
 * against the carrier.
 */
export function matchDocketRelationship(
  enteredMc: string | null,
  dockets: CarrierDocket[] | null,
): MatchResult {
  const mc = normalizeRegistrationNumber(enteredMc);
  // No MC submitted — nothing to relate. Legitimate for intrastate/exempt.
  if (!mc) return "unavailable";
  // Never retrieved. The docket call failed or was not made.
  if (dockets === null) return "unavailable";
  // Retrieved, and FMCSA associates no docket with this USDOT — so an MC was
  // claimed that this registration does not hold. That IS a finding.
  if (dockets.length === 0) return "mismatch";

  // ── ONLY AN MC DOCKET CAN SATISFY A SUBMITTED MC ───────────────────────
  //
  // FF (freight forwarder) and MX (Mexican carrier) numbers live in separate
  // series and collide with MC numbers freely. Matching on digits alone would
  // let a freight forwarder holding FF-777777 verify as motor carrier
  // MC-777777 — a different registration, and in many cases a different
  // company with different authority to haul.
  if (dockets.some((d) => d.prefix === "MC" && d.number === mc)) {
    return "exact";
  }

  // A number matched but we do not know its series. Refuse to call it
  // verified, and refuse to call it a mismatch either — the ambiguity is in
  // our data, not in their registration. Defensive: the live response always
  // carries `prefix`.
  if (dockets.some((d) => d.prefix === null && d.number === mc)) {
    return "unavailable";
  }

  // Dockets exist and none is an MC bearing this number. Includes the case
  // this function was rewritten for: the digits match an FF or MX entry.
  return "mismatch";
}

export interface IdentityComparison {
  nameMatch: MatchResult;
  dotMatch: MatchResult;
  mcMatch: MatchResult;
  /**
   * The MC↔USDOT relationship as FMCSA records it. Distinct from `mcMatch`,
   * which only compares the entered MC with the single field on the carrier
   * record.
   */
  docketMatch: MatchResult;
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
    docketMatch: matchDocketRelationship(entered.mcNumber, record.dockets),
  };
}
