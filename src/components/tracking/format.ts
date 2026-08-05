/**
 * M-73 — §23/§24 "accessible date and time formatting", in one place.
 *
 * `Intl` with the ACTIVE LOCALE, not the hard-coded `"en-US"` the portal
 * surfaces use. Those are English-only staff screens; `/track` is a public
 * page in five languages, and §24 lists "date and time formatting" among the
 * things that must be localized.
 *
 * TIME ZONE is deliberately the VISITOR'S. A consignee asking "when does it
 * get here" means their own clock, and forcing Eastern Time onto a Californian
 * warehouse produces a number that is correct and useless. The raw ISO value
 * always ships alongside in `<time datetime>`, so nothing is lost.
 *
 * NO HYDRATION RISK: every caller is a client component that renders only
 * after a POST, so there is no server-rendered string for a differently-zoned
 * client to disagree with. That is a property of where this is used, so it is
 * written down here rather than assumed.
 *
 * An unparseable or absent value returns null and the caller renders nothing —
 * "Invalid Date" on a tracking page is worse than a missing row.
 */
export function formatTrackingDateTime(
  iso: string | null,
  locale: string,
): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    // A locale tag Intl does not know falls back rather than throwing into a
    // render. `ht` is the realistic case on older ICU builds.
    return date.toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }
}

/** Date only — appointments, where a time-of-day may not be agreed yet. */
export function formatTrackingDate(
  iso: string | null,
  locale: string,
): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleDateString(locale, { dateStyle: "medium" });
  } catch {
    return date.toLocaleDateString("en-US", { dateStyle: "medium" });
  }
}
