"use client";

import { Link } from "@/i18n/navigation";
import { showToast } from "@/components/ui/PortalToast";
import { useV4 } from "@/i18n/v4";

/*
 * M-21: the upload card routes to the live secure-upload wizard.
 *
 * M-69 / P-6 — `company_settings.packet_downloads_live` is now REAL.
 * Before this module the flag appeared only in the comment below while all
 * four links were hard-coded `href="#"` with a toast, so the runbook told an
 * operator to flip a switch that controlled nothing (plan §2, C-3), and the
 * Downloads Center planned for M-92 would have inherited a fake gate.
 *
 * The flag now decides the behaviour:
 *   false → the honest "in legal review, email us" toast (unchanged wording)
 *   true  → real download links to PACKET_DOC_PATH
 *
 * Flipping it is therefore a two-part operation, documented in
 * docs/modules/M-69-production-integrity.md and the launch runbook: upload
 * the four counsel-approved PDFs to `public/packet/` FIRST, then flip. The
 * paths are a fixed convention rather than free text so a typo in the
 * settings editor cannot produce four broken links.
 */
export const PACKET_DOC_PATH = {
  "Dispatch Agreement": "/packet/dispatch-agreement.pdf",
  "W-9 Form": "/packet/w-9.pdf",
  "Insurance Requirements": "/packet/insurance-requirements.pdf",
  "Factoring Guide": "/packet/factoring-guide.pdf",
} as const;

export type PacketDocTitle = keyof typeof PACKET_DOC_PATH;

const PACKET_DOCS = [
  ["Dispatch Agreement", "Month-to-month service terms — plain English"],
  ["W-9 Form", "Current IRS revision, ready to fill"],
  ["Insurance Requirements", "$1M auto liability · $100K cargo minimums"],
  ["Factoring Guide", "How factoring works with our invoicing"],
] as const satisfies readonly (readonly [PacketDocTitle, string])[];

export function Packet({
  downloadsLive = false,
}: {
  downloadsLive?: boolean;
}) {
  const tv = useV4();
  return (
    <section id="packet">
      <div className="wrap">
        <span className="eyebrow">{tv("Carrier packet")}</span>
        <h2 className="sec">
          {tv("Everything you need to sign on — in one place.")}
        </h2>
        <p className="sub">
          {tv(
            "Download the documents, or upload yours and let us build the packet for you.",
          )}
        </p>
        <div className="packet-grid">
          <div className="packet-list">
            {PACKET_DOCS.map(([title, blurb]) => (
              <div className="packet-item" key={title}>
                <div className="doc">
                  <i>PDF</i>
                  <div>
                    <b>{tv(title)}</b>
                    <span>{tv(blurb)}</span>
                  </div>
                </div>
                {downloadsLive ? (
                  <a
                    className="dl"
                    href={PACKET_DOC_PATH[title]}
                    download
                    aria-label={`${tv(title)} — ${tv("DOWNLOAD ↓")}`}
                  >
                    {tv("DOWNLOAD ↓")}
                  </a>
                ) : (
                  <a
                    className="dl"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      showToast({
                        title: tv("Packet downloads — available at launch."),
                        body: tv(
                          "Final documents are in legal review. Email support@pickloads.com and we'll send them directly.",
                        ),
                      });
                    }}
                  >
                    {tv("DOWNLOAD ↓")}
                  </a>
                )}
              </div>
            ))}
          </div>
          <Link
            className="upload"
            href="/become-a-carrier"
            style={{ color: "inherit" }}
          >
            <span className="big" aria-hidden="true">⇪</span>
            <b>{tv("Upload your documents")}</b>
            <span>
              {tv(
                "MC/DOT letter, certificate of insurance, W-9, voided check — drag & drop or tap to browse.",
              )}
            </span>
            <span className="mono">
              {"// "}
              {tv("Secure upload — part of carrier onboarding")}
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
}
