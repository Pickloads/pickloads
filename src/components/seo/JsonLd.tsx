/**
 * JSON-LD injector (M-15). `data` is fully authored server-side from typed
 * builders — never from user input. JSON.stringify escaping plus the
 * `<`-escape below prevents script-context breakout.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
