import { describe, expect, it } from "vitest";

import { CARRIER_FAQ, SHIPPER_FAQ } from "@/content/faq";
import {
  categoryBySlug,
  categoryEntries,
  findEntry,
  KB_CATEGORIES,
  uncategorisedQuestions,
} from "@/content/knowledge-base";

/**
 * The Knowledge Base is a VIEW of the FAQ, and these tests are what keep it
 * from becoming a lossy one.
 *
 * The realistic failure is not a crash. It is somebody rewording a question in
 * `faq.ts`, the category mapping silently no longer matching, and an answer
 * quietly disappearing from the resource centre while still rendering at
 * `/faq`. Nothing would look broken.
 */

describe("the Knowledge Base loses nothing", () => {
  it("categorises EVERY question in the source arrays", () => {
    expect(uncategorisedQuestions()).toEqual([]);
  });

  it("every mapped question still resolves to a real entry", () => {
    const missing: string[] = [];
    for (const category of KB_CATEGORIES) {
      for (const question of category.questions) {
        if (!findEntry(question)) missing.push(`${category.slug}: ${question}`);
      }
    }
    expect(
      missing,
      `mapped questions no longer in faq.ts — reword the mapping too: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("surfaces the same total the FAQ page does", () => {
    const total = KB_CATEGORIES.reduce(
      (n, c) => n + categoryEntries(c).length,
      0,
    );
    expect(total).toBe(CARRIER_FAQ.length + SHIPPER_FAQ.length);
  });

  it("NON-VACUITY: an unmapped question WOULD be reported", () => {
    // Proves `uncategorisedQuestions` can fail: a question that exists in
    // neither array is, correctly, not found at all.
    expect(findEntry("A question nobody ever asked")).toBeUndefined();
  });
});

describe("category structure", () => {
  it("declares the eight categories the directive names", () => {
    expect(KB_CATEGORIES.map((c) => c.slug)).toEqual([
      "dispatch",
      "freight-brokerage",
      "carrier-onboarding",
      "new-authority",
      "tracking",
      "documents",
      "accounts",
      "support",
    ]);
  });

  it("has unique slugs — two categories sharing one is an unreachable filter", () => {
    const slugs = KB_CATEGORIES.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("assigns each question to exactly one category", () => {
    const all = KB_CATEGORIES.flatMap((c) => c.questions);
    expect(new Set(all).size).toBe(all.length);
  });

  it("resolves a known slug and refuses an unknown one", () => {
    expect(categoryBySlug("dispatch")?.label).toBe("Dispatch");
    expect(categoryBySlug("../../etc/passwd")).toBeNull();
    expect(categoryBySlug("nonsense")).toBeNull();
    expect(categoryBySlug(undefined)).toBeNull();
  });

  it("keeps empty categories declared rather than hidden", () => {
    // Documents / Accounts / Support have no approved answer yet. They render
    // an honest empty state: a knowledge base that silently omits the topic
    // you came for is worse than one that says it has nothing on it.
    const empty = KB_CATEGORIES.filter((c) => categoryEntries(c).length === 0);
    expect(empty.map((c) => c.slug)).toEqual([
      "documents",
      "accounts",
      "support",
    ]);
  });
});

describe("no answer text is authored in the Knowledge Base", () => {
  it("every rendered answer is byte-identical to its FAQ source", () => {
    const source = new Map<string, string>(
      [...CARRIER_FAQ, ...SHIPPER_FAQ].map(([q, a]) => [q, a]),
    );
    for (const category of KB_CATEGORIES) {
      for (const [question, answer] of categoryEntries(category)) {
        expect(answer, `${question} diverged from faq.ts`).toBe(
          source.get(question),
        );
      }
    }
  });
});
