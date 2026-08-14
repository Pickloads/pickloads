import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * SEC-P3-02 — every script-context sink goes through an escaping helper.
 *
 * ── THE FINDING ──────────────────────────────────────────────────────────
 *
 * `JSON.stringify` escapes quotes and backslashes but NOT `<`. A value
 * containing `</script>` therefore closes the block early and everything
 * after it parses as HTML. `src/components/seo/JsonLd.tsx` has always
 * escaped `<`; two pages bypassed it and hand-rolled the tag, carrying a
 * comment — "Structured data only — no user input reaches this string" — as
 * the entire control.
 *
 * The comment was accurate. That is not the point. The pages interpolate
 * `absoluteUrl()` output and message-catalogue strings, so the property it
 * asserts is one refactor away from being false, and nothing would fail when
 * it stopped being true. A comment is not a mechanism.
 *
 * ── WHAT THIS ENFORCES ───────────────────────────────────────────────────
 *
 * `dangerouslySetInnerHTML` is allowed in exactly three places, each with a
 * real sanitiser behind it. Anywhere else — and any `JSON.stringify` fed
 * straight into one — fails here.
 */

const ALLOWED = new Set([
  // Escapes `<`; the only sanctioned JSON-LD writer.
  "src/components/seo/JsonLd.tsx",
  // renderMarkdown() escapes ALL input first, then rebuilds a fixed
  // allow-list on top of the escaped text (src/lib/markdown.ts).
  "src/app/[locale]/(site)/blog/[slug]/page.tsx",
  "src/app/[locale]/portal/admin/posts/[id]/page.tsx",
]);

function sourceFiles(): string[] {
  return execSync('git ls-files "src/**/*.tsx" "src/**/*.ts"', {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
}

/**
 * Source with comments removed.
 *
 * Not incidental: `JsonLd.tsx` documents the exact bad pattern it exists to
 * replace, and a scanner that reads comments flags the fix as the defect.
 * A security lint that cannot tell code from prose gets silenced, and a
 * silenced lint protects nothing.
 */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

describe("SEC-P3-02 · script-context injection sinks", () => {
  it("dangerouslySetInnerHTML appears only where a sanitiser backs it", () => {
    const offenders = sourceFiles().filter(
      (f) => !ALLOWED.has(f) && code(f).includes("dangerouslySetInnerHTML"),
    );
    expect(
      offenders,
      "Add a sanitiser and register the file in this test's ALLOWED set, or " +
        "render through <JsonLd/>. Do not add a comment instead.",
    ).toEqual([]);
  });

  it("no file pipes JSON.stringify straight into innerHTML", () => {
    // The exact shape of the bypass this finding removed.
    const offenders = sourceFiles().filter((f) =>
      /dangerouslySetInnerHTML=\{\{ __html: JSON\.stringify\([^)]*\) \}\}/.test(
        code(f),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("JsonLd escapes the `<` that JSON.stringify leaves alone", () => {
    const src = readFileSync("src/components/seo/JsonLd.tsx", "utf8");
    expect(src).toMatch(/replace\(\/<\/g, *"\\\\u003c"\)/);
  });

  it("NON-VACUITY — a `</script>` payload really does survive JSON.stringify", () => {
    // Proves the escape is load-bearing rather than decorative: without it,
    // the serialized string contains a literal closing tag.
    const hostile = { name: "</script><img src=x onerror=alert(1)>" };
    const raw = JSON.stringify(hostile);
    expect(raw).toContain("</script>");
    const escaped = raw.replace(/</g, "\\u003c");
    expect(escaped).not.toContain("</script>");
    expect(escaped).not.toContain("<");
    // Still valid JSON carrying the identical value.
    expect(JSON.parse(escaped)).toEqual(hostile);
  });
});
