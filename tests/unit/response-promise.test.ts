import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CONTACT_NOW,
  RESPONSE_PROMISE,
  RESPONSE_PROMISE_RECEIVED,
} from "@/lib/copy/response-promise";

/**
 * The response-time promise, pinned.
 *
 * A stated turnaround is an operational commitment, not marketing copy: it is
 * only honest with a real SLA behind it — staffed hours, an owned queue, and a
 * way to know when it was missed. None of that is established, so the site
 * states none.
 *
 * The risk this file exists for is not the copy that was just fixed. It is the
 * NEXT page: someone writes "we reply within an hour" on a new surface,
 * nothing stops them, and the platform quietly makes a promise nobody agreed
 * to. Same shape as the `@staffOnly` scan in M-70 and the membership-doctrine
 * scan in M-57 — a rule the codebase enforces on itself.
 */

/**
 * SCOPE: THE QUOTE SURFACES ONLY — and that boundary is deliberate.
 *
 * Run repo-wide, this scan finds **40 distinct timing and availability claims
 * across 25 files** — "a dispatcher calls back within one business hour" on
 * the account chooser, "within 15 minutes" on the New Authority form, "24/7"
 * in the topbar, the 404 page and several email templates.
 *
 * Every one of those predates this work and is approved business copy. Which
 * of them the business can stand behind is a CONTENT decision and belongs to
 * Cowork, not to a test written by engineering. Failing the build on 25 files
 * of somebody else's approved copy would be engineering quietly overruling
 * content ownership.
 *
 * So the guard covers exactly what was approved for change — the quote
 * surfaces — and the other 40 are recorded, verbatim and per file, in
 * `docs/COWORK-CONTENT-REVIEW.md`. Widen this list as Cowork rules on them.
 */
const GUARDED = [
  "src/components/forms/FreightQuoteForm.tsx",
  "src/components/portal/PortalQuoteForm.tsx",
  "src/app/[locale]/(site)/request-a-quote/page.tsx",
  "src/lib/copy/response-promise.ts",
];

const FILES = GUARDED.map((rel) => path.join(process.cwd(), rel));

/**
 * Turnaround claims, as they actually get written. Deliberately shape-based:
 * we cannot enumerate every phrasing, only the pattern of committing to a
 * duration.
 */
const TIMING_CLAIMS: Array<[label: string, pattern: RegExp]> = [
  ["within N business hour(s)/day(s)", /within\s+(one|two|a|\d+)\s+business\s+(hour|day)/i],
  ["within N minutes/hours", /within\s+(\d+|one|two|a|an)\s+(minute|hour)s?\b/i],
  ["reply/respond in N", /(repl(y|ies)|respond|call back|callback)\s+(in|within)\s+\S+\s*(minute|hour|day)/i],
  ["same-day / 24-hour promise", /(same[- ]day (reply|response|call)|24[- ]hour (reply|response|turnaround))/i],
];

describe("no unapproved response-time promise anywhere in the source", () => {
  for (const [label, pattern] of TIMING_CLAIMS) {
    it(`no quote surface claims "${label}"`, () => {
      const offenders: string[] = [];
      for (const file of FILES) {
        const text = readFileSync(file, "utf8");
        // Strip comments: this very rule is explained in prose in several
        // files, and a doctrine that fails on its own documentation teaches
        // people to delete the documentation.
        const code = text
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        if (pattern.test(code)) {
          offenders.push(path.relative(process.cwd(), file));
        }
      }
      expect(offenders, `unapproved timing promise in: ${offenders.join(", ")}`).toEqual([]);
    });
  }

  it("NON-VACUITY: the patterns DO match the wording that was removed", () => {
    const removed = [
      "we respond within one business hour (Mon–Sat)",
      "usually within one business hour (8am–6pm ET)",
      "a launch specialist calls you back within 15 minutes",
    ];
    for (const sentence of removed) {
      const hit = TIMING_CLAIMS.some(([, pattern]) => pattern.test(sentence));
      expect(hit, `pattern set failed to catch: ${sentence}`).toBe(true);
    }
  });

  it("does NOT flag the approved wording", () => {
    for (const [, pattern] of TIMING_CLAIMS) {
      expect(pattern.test(RESPONSE_PROMISE)).toBe(false);
      expect(pattern.test(RESPONSE_PROMISE_RECEIVED)).toBe(false);
    }
  });
});

describe("the promise is defined once", () => {
  it("is the business-approved sentence, verbatim", () => {
    // Owner decision A2, 2026-08-12. The previous sentence deliberately stated
    // no time at all; the owner has since approved one, hedged.
    expect(RESPONSE_PROMISE).toBe(
      "We respond fast — typically within the hour during business hours.",
    );
  });

  it("is hedged — 'typically', never a guarantee", () => {
    // The whole decision rests on one word. "Typically within the hour"
    // describes what usually happens; "within one hour" is an SLA, and an SLA
    // is what was just removed. This is the assertion that stops the sentence
    // drifting back by a single edit.
    expect(RESPONSE_PROMISE).toMatch(/typically/i);
    expect(RESPONSE_PROMISE).not.toMatch(/guarantee|guaranteed|promise/i);
    expect(RESPONSE_PROMISE_RECEIVED).toMatch(/typically/i);
  });

  it("any 'within the hour' wording on a guarded surface is hedged", () => {
    // None of the TIMING_CLAIMS patterns match "within the hour" — "the" is
    // not a number — so the approved sentence passes them, and so would an
    // UNHEDGED "we reply within the hour". That is the gap the new wording
    // opened, and this closes it: on these surfaces the phrase may appear
    // only with "typically" attached.
    for (const file of FILES) {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const m of code.matchAll(/.{0,40}within the hour/gi)) {
        expect(
          m[0],
          `${path.relative(process.cwd(), file)}: "within the hour" without "typically"`,
        ).toMatch(/typically/i);
      }
    }
  });

  it("NON-VACUITY: an unhedged 'within the hour' would be caught", () => {
    const bad = "We reply within the hour.";
    expect(/within the hour/i.test(bad) && !/typically/i.test(bad)).toBe(true);
  });

  it("the confirmation state carries the same sentence, not a variant", () => {
    expect(RESPONSE_PROMISE_RECEIVED).toContain(RESPONSE_PROMISE);
  });

  it("every quote surface imports it rather than restating it", () => {
    const surfaces = [
      "src/components/forms/FreightQuoteForm.tsx",
      "src/components/portal/PortalQuoteForm.tsx",
    ];
    for (const rel of surfaces) {
      const text = readFileSync(path.join(process.cwd(), rel), "utf8");
      expect(text, `${rel} must import the shared promise`).toContain(
        "@/lib/copy/response-promise",
      );
    }
  });

  it("offers an immediate alternative — a promise with no escape hatch is a wait", () => {
    expect(CONTACT_NOW).toMatch(/call|email/i);
  });
});
