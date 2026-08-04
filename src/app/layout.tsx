import type { Metadata } from "next";
import { Barlow, IBM_Plex_Mono, Overpass } from "next/font/google";
import "./globals.css";

/*
 * Fonts are self-hosted via next/font (performance + privacy) using the exact
 * families and weights loaded by the V4 prototype from Google Fonts.
 */
const overpass = Overpass({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  variable: "--font-display",
  display: "swap",
});

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PickLoads Logistics Group — Truck Dispatching & Freight Brokerage",
  description:
    "Nationwide truck dispatching for owner-operators and small fleets. Dry van, reefer, flatbed, power only and more. Carrier setup in 5 minutes. Call (908) 404-5373.",
};

/*
 * NOTE (M-13): once next-intl locale routing lands, the html lang attribute and
 * page shell move to src/app/[locale]/layout.tsx. This root layout stays as the
 * top-level pass-through required by the App Router.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${overpass.variable} ${barlow.variable} ${plexMono.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
