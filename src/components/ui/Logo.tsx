import Link from "next/link";

/** V4 shield logo + wordmark (SVG copied verbatim from the prototype). */
export function Logo({ small = false }: { small?: boolean }) {
  const size = small ? { width: 34, height: 38 } : { width: 38, height: 42 };
  return (
    <Link href="/" className="logo" aria-label="PickLoads — home">
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
