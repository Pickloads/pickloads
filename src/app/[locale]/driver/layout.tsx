import { SkipLink } from "@/components/ui/SkipLink";

/**
 * M-76 — the driver surface's own chrome, and the argument for it being its
 * own route group.
 *
 * `/driver/update/[token]` sits beside `(site)` and `portal` rather than
 * inside either, because both would be wrong in a way that matters:
 *
 *   * `(site)`'s layout renders the marketing topbar, the full navigation,
 *     the footer with fourteen links, a call FAB and the analytics consent
 *     banner. On a 320px screen in a truck that is four screens of chrome
 *     above the one control the driver came for, and the consent banner in
 *     particular would be the first thing a gloved thumb had to dismiss.
 *   * `portal`'s layout renders a sidebar for an account the driver does not
 *     have — §13 is explicit that no portal account is required.
 *
 * So: a skip link, and nothing else. `layout.tsx` at `[locale]` still supplies
 * `<html lang>`, the fonts, `globals.css` (which imports `v4.css`, where the
 * `.driver-*` block lives) and the `NextIntlClientProvider`, so the page is
 * fully styled and fully localized (§24) without inheriting a navigation
 * shell it has no use for.
 *
 * NO `<Footer>`: the driver page ends with its own "call dispatch" button,
 * which is the only navigation this audience needs, and a sitewide footer
 * would put "Freight Brokerage" and "Careers" underneath a delivery
 * confirmation.
 */
export default function DriverLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <SkipLink />
      {children}
    </>
  );
}
