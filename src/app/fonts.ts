import localFont from "next/font/local";

/*
 * V4 font families, vendored as woff2 (SIL OFL) and self-hosted via
 * next/font/local — identical rendering to the prototype's Google Fonts link,
 * zero runtime/build-time network dependency (M-00 doc §Fonts).
 */
export const overpass = localFont({
  src: [
    { path: "../fonts/overpass-latin-600-normal.woff2", weight: "600" },
    { path: "../fonts/overpass-latin-700-normal.woff2", weight: "700" },
    { path: "../fonts/overpass-latin-800-normal.woff2", weight: "800" },
    { path: "../fonts/overpass-latin-900-normal.woff2", weight: "900" },
  ],
  variable: "--font-display",
  display: "swap",
});

export const barlow = localFont({
  src: [
    { path: "../fonts/barlow-latin-400-normal.woff2", weight: "400" },
    { path: "../fonts/barlow-latin-500-normal.woff2", weight: "500" },
    { path: "../fonts/barlow-latin-600-normal.woff2", weight: "600" },
  ],
  variable: "--font-sans",
  display: "swap",
});

export const plexMono = localFont({
  src: [
    { path: "../fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400" },
    { path: "../fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500" },
    { path: "../fonts/ibm-plex-mono-latin-600-normal.woff2", weight: "600" },
    { path: "../fonts/ibm-plex-mono-cyrillic-400-normal.woff2", weight: "400" },
    { path: "../fonts/ibm-plex-mono-cyrillic-500-normal.woff2", weight: "500" },
    { path: "../fonts/ibm-plex-mono-cyrillic-600-normal.woff2", weight: "600" },
  ],
  variable: "--font-mono",
  display: "swap",
});
