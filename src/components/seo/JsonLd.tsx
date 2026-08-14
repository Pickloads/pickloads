/**
 * JSON-LD injector (M-15). `data` is authored server-side from typed builders.
 *
 * ── WHY THE `<` ESCAPE, AND WHY IT MUST BE THE ONLY WAY IN ───────────────
 *
 * `JSON.stringify` escapes quotes and backslashes. It does NOT escape `<`,
 * so a value containing `</script>` closes the block early and everything
 * after it is parsed as HTML — the classic JSON-in-script-tag breakout.
 * Replacing `<` with its `<` escape is valid JSON, renders identically,
 * and makes that impossible.
 *
 * SEC-P3-02: two pages built the same tag by hand
 * (`dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}`) with a
 * comment asserting "no user input reaches this string". The assertion was
 * true. It was also the entire control — a comment, holding a script-context
 * sink open, on pages whose structured data already interpolates values from
 * `absoluteUrl()` and the message catalogues. This component now accepts an
 * ARRAY as well as an object so there is no reason left to hand-roll it, and
 * `tests/unit/security-jsonld.test.ts` fails if a new one appears.
 */
export function JsonLd({
  data,
}: {
  data: Record<string, unknown> | Record<string, unknown>[];
}) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
