/**
 * Email palette = V4 design-token hexes from src/app/globals.css.
 * Raw hex is unavoidable in email HTML (no CSS-variable support in clients);
 * values are copied 1:1 from the tokens — no new colors (CLAUDE.md rule).
 */
export const emailColors = {
  night: "#0b0e11",
  asphalt: "#12161a",
  ink: "#1b2126",
  paper: "#f4f6f5",
  amber: "#ffb020",
  amberDeep: "#e29500",
  green: "#0e5a3c",
  mint: "#4cc492",
  steel: "#97a1a8",
  slateBody: "#4a545b",
  slateMid: "#6a747b",
  lineDark: "rgba(18,22,26,0.14)",
} as const;

export const emailFonts = {
  sans: "'Barlow', 'Helvetica Neue', Arial, sans-serif",
  mono: "'IBM Plex Mono', 'Courier New', monospace",
} as const;
