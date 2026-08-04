import type { Metadata } from "next";
import { barlow, overpass, plexMono } from "./fonts";
import "./globals.css";

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
