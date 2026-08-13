import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";

/** V4 shield logo + wordmark (SVG copied verbatim from the prototype). */
export function Logo({ small = false }: { small?: boolean }) {
  const tv = useV4();
  const size = small ? { width: 34, height: 38 } : { width: 38, height: 42 };
  return (
    // M-90: the accessible name is the ONLY text a screen-reader user gets
    // from this control — the wordmark is a brand image and "PL" is decorative.
    // It was the one string on the page that stayed English in all five
    // locales, which is the class of miss an eyes-on review never catches.
    <Link href="/" className="logo" aria-label={tv("PickLoads — home")}>
      <svg {...size} viewBox="0 0 38 42" fill="none" aria-hidden="true">
        <path
          d="M19 1 L36 8 V24 C36 33 28 39.5 19 41 C10 39.5 2 33 2 24 V8 Z"
          fill="#0E5A3C"
          stroke="#FFB020"
          strokeWidth="2"
        />
        <text
          x="19"
          y="27"
          textAnchor="middle"
          fontFamily="Overpass,sans-serif"
          fontWeight="900"
          fontSize="15"
          fill="#F4F6F5"
        >
          PL
        </text>
      </svg>
      <div>
        <b>
          PICK<span>LOADS</span>
        </b>
        <small>Logistics Group LLC</small>
      </div>
    </Link>
  );
}
