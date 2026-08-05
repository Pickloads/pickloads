import { useV4 } from "@/i18n/v4";
import type { Testimonial } from "@/lib/testimonials";

/**
 * M-69 / P-6 — the V4 testimonials section, restored behind a real gate.
 *
 * Markup and class vocabulary are the prototype's verbatim (`section.light`
 * → `.testis` → `.testi` → `p` + `.who > b`); the CSS has been sitting
 * unused in src/app/v4.css since M-00. No new colours, no new classes.
 *
 * Presentational and honest by construction: given an empty list it renders
 * NOTHING at all. The prototype's three sample quotes are deliberately not
 * carried over — they are marked "Sample content for prototype" in the V4
 * source, and shipping them would be exactly the fake social proof audit
 * finding F-13 removed.
 */
export function Testimonials({ items }: { items: readonly Testimonial[] }) {
  const tv = useV4();
  if (items.length === 0) return null;
  return (
    <section className="light">
      <div className="wrap">
        <span className="eyebrow">{tv("What carriers say")}</span>
        <h2 className="sec">{tv("Word of mouth is our load board.")}</h2>
        <div className="testis">
          {items.map((item) => (
            <figure className="testi" key={item.id}>
              <p>{item.quote}</p>
              <figcaption className="who">
                <b>{item.author}</b>
                {item.context}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
