/**
 * The Downloads Center's resource model.
 *
 * ── THE HONEST STARTING POSITION ─────────────────────────────────────────
 *
 * **No approved public downloadable asset exists today.** `public/` contains
 * no PDF, and `company_settings.packet_downloads_live` is false precisely
 * because the four packet documents have never been uploaded. So this page
 * ships with ZERO download buttons — not one — and says why.
 *
 * That is the whole design constraint. A downloads page whose buttons do
 * nothing is worse than no downloads page: it tells a carrier the paperwork is
 * ready when it is not, and it trains people to ignore a broken control.
 *
 * ── THE THREE TIERS ──────────────────────────────────────────────────────
 *
 * PUBLIC        general, approved, non-sensitive. Nothing qualifies yet.
 * AUTHENTICATED role-gated; the user is sent to the portal, which already
 *               enforces the role. This page never mints a URL.
 * PRIVATE       customer-, carrier-, shipment- or billing-specific. These are
 *               NEVER listed as downloads anywhere public. The page explains
 *               where they live and stops there.
 *
 * ── WHY THIS PAGE MINTS NOTHING ──────────────────────────────────────────
 *
 * The certified document architecture already issues short-lived signed URLs
 * (`SIGNED_URL_TTL_SECONDS`, 300s) from authenticated server components, under
 * RLS, with an audit trail. A public marketing page has no business holding a
 * second key to that. So the only thing a PRIVATE or AUTHENTICATED entry
 * carries here is a ROUTE — `/portal/carrier/documents` — and the portal does
 * what it has always done.
 *
 * ── THE LEGAL BOUNDARY ───────────────────────────────────────────────────
 *
 * `PACKET_DOC_PATH` (M-69) maps "Dispatch Agreement" to
 * `/packet/dispatch-agreement.pdf`. `docs/LEGAL-DOCUMENTS-REQUIRED.md` marks
 * that document **COUNSEL REVIEW REQUIRED, no approved content**. Flipping
 * `packet_downloads_live` before counsel delivers would publish a legally
 * operative agreement as a finished download.
 *
 * Nothing in this file lists a legal agreement as a public resource, and a
 * test asserts none can appear. The gate stays where M-69 put it.
 */

/** Who may obtain the resource. */
export type DownloadTier = "public" | "authenticated" | "private";

export interface DownloadResource {
  /** V4 dictionary key. */
  label: string;
  /** V4 dictionary key — what it is, in one line. */
  description: string;
  tier: DownloadTier;
  /**
   * Where the user goes. ALWAYS a route, never a storage path and never a
   * signed URL. `null` means the resource is described but not obtainable
   * yet — rendered as an honest state, never as a disabled-looking button.
   */
  href: string | null;
  /**
   * Why `href` is null. Rendered to the user, so it must be a real reason.
   */
  unavailable?: "not_yet_approved" | "login_required" | "after_onboarding";
}

export interface DownloadSection {
  slug: string;
  label: string;
  tier: DownloadTier;
  /** V4 dictionary key — what this whole tier means. */
  note: string;
  resources: readonly DownloadResource[];
}

export const DOWNLOAD_SECTIONS: readonly DownloadSection[] = [
  {
    slug: "public-resources",
    label: "Public Resources",
    tier: "public",
    note: "General information anyone can read. No account needed.",
    resources: [
      {
        // Described because a carrier genuinely needs to know what to bring.
        // NOT downloadable: the counsel-approved PDFs do not exist, and
        // publishing a Dispatch Agreement before counsel delivers would make a
        // placeholder look like a finished contract.
        label: "Carrier Packet",
        description:
          "MC/DOT, W-9, certificate of insurance and a voided check — uploaded in one secure form.",
        tier: "public",
        href: null,
        unavailable: "not_yet_approved",
      },
    ],
  },
  {
    slug: "carrier-resources",
    label: "Carrier Resources",
    tier: "authenticated",
    note: "Sign in to your carrier portal — your documents live with your account.",
    resources: [
      {
        label: "Documents",
        description:
          "Documents, agreements, loads and invoices in one place — yours, not a shared inbox.",
        tier: "authenticated",
        href: "/portal/carrier/documents",
      },
      {
        label: "Agreements",
        description: "Review the dispatch agreement and sign from your phone. No printer, no fax.",
        tier: "authenticated",
        href: "/portal/carrier/agreements",
      },
      {
        label: "Invoices & Payments",
        description: "We handle rate cons, BOLs and invoicing. You focus on miles.",
        tier: "authenticated",
        href: "/portal/carrier/invoices",
      },
    ],
  },
  {
    slug: "shipper-resources",
    label: "Shipper Resources",
    tier: "authenticated",
    note: "Sign in to your shipper portal — your documents live with your account.",
    resources: [
      {
        label: "Documents",
        description: "Proof of delivery is uploaded and made available to you.",
        tier: "authenticated",
        href: "/portal/shipper/documents",
      },
      {
        label: "Billing",
        description: "Invoices and billing for your shipments.",
        tier: "authenticated",
        href: "/portal/shipper/billing",
      },
    ],
  },
  {
    slug: "private-documents",
    label: "Account & Private Documents",
    tier: "private",
    note:
      "Shipment and account documents are private to your company and are never published on this site.",
    resources: [
      {
        // Deliberately has NO href. Naming a route here would start the habit
        // of listing private artefacts on a public page.
        label: "Shipment documents",
        description:
          "Proof of delivery is uploaded and made available to you.",
        tier: "private",
        href: null,
        unavailable: "login_required",
      },
    ],
  },
] as const;

/** Everything that is actually obtainable from this page. */
export function obtainableResources(): DownloadResource[] {
  return DOWNLOAD_SECTIONS.flatMap((s) => s.resources).filter(
    (r) => r.href !== null,
  );
}

/**
 * Terms that must never appear as a public, obtainable resource.
 *
 * Checked by `tests/unit/downloads.test.ts` against every entry whose tier is
 * `public`. This is a denial list rather than an allow-list because the risk
 * is somebody ADDING a resource later, and an allow-list of approved public
 * documents is empty today — it would pass vacuously.
 */
export const NEVER_PUBLIC = [
  "w-9",
  "w9",
  "ein",
  "insurance certificate",
  "certificate of insurance",
  "bol",
  "bill of lading",
  "pod",
  "proof of delivery",
  "rate confirmation",
  "rate con",
  "invoice",
  "factoring",
  "noa",
  "dispatch agreement",
  "carrier agreement",
  "broker-carrier",
  "shipper-broker",
  "terms of service",
  "privacy policy",
] as const;
