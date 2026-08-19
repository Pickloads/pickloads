/**
 * M-102 — how a lead reads on the pipeline board.
 *
 * `carrier_leads.source` is free text with a default of `'website'`, not an
 * enum — so this maps the values the application actually writes and
 * humanises anything else rather than pretending the set is closed. Nothing
 * here changes what is stored.
 */

const SOURCE_LABEL: Readonly<Record<string, string>> = {
  website: "Website",
  become_a_carrier: "Carrier page",
  create_account: "Signup",
  freight_quotes: "Quote request",
  manual: "Added by staff",
  referral: "Referral",
  phone: "Phone",
  driver: "Driver",
  carrier: "Carrier",
};

export function leadSourceLabel(source: string): string {
  const known = SOURCE_LABEL[source];
  if (known) return known;
  const words = source.replace(/[._-]+/g, " ").trim();
  return words === "" ? "Unknown" : words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Compact age. Deliberately short — on a board this is the least important
 * thing on the card and must not compete with the carrier's name.
 */
export function leadAge(createdAt: string, now: number = Date.now()): string {
  const ms = now - new Date(createdAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${Math.max(minutes, 0)}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

/** The equipment line, or the source when no equipment is on record. */
export function leadEquipment(
  truckType: string | null,
  trailerType: string | null,
): string {
  return [truckType, trailerType].filter(Boolean).join(" · ");
}
