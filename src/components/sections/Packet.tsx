"use client";

import { showToast } from "@/components/ui/PortalToast";

/*
 * Download links stay inert until lawyer-approved PDFs exist
 * (company_settings.packet_downloads_live, audit U-09). Upload card shows the
 * V4 "coming soon" toast until the M-21 secure-upload flow ships.
 */
const PACKET_DOCS = [
  ["Dispatch Agreement", "Month-to-month service terms — plain English"],
  ["W-9 Form", "Current IRS revision, ready to fill"],
  ["Insurance Requirements", "$1M auto liability · $100K cargo minimums"],
  ["Factoring Guide", "How factoring works with our invoicing"],
] as const;

export function Packet() {
  return (
    <section id="packet">
      <div className="wrap">
        <span className="eyebrow">Carrier packet</span>
        <h2 className="sec">Everything you need to sign on — in one place.</h2>
        <p className="sub">
          Download the documents, or upload yours and let us build the packet
          for you.
        </p>
        <div className="packet-grid">
          <div className="packet-list">
            {PACKET_DOCS.map(([title, blurb]) => (
              <div className="packet-item" key={title}>
                <div className="doc">
                  <i>PDF</i>
                  <div>
                    <b>{title}</b>
                    <span>{blurb}</span>
                  </div>
                </div>
                <a
                  className="dl"
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    showToast({
                      title: "Packet downloads — available at launch.",
                      body: "Final documents are in legal review. Email support@pickloads.com and we'll send them directly.",
                    });
                  }}
                >
                  DOWNLOAD ↓
                </a>
              </div>
            ))}
          </div>
          <div
            className="upload"
            role="button"
            tabIndex={0}
            onClick={() =>
              showToast({
                title: "Secure upload — Coming Soon.",
                body: "Document upload + e-signature launch with the production build. Email your docs to support@pickloads.com for now.",
              })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                showToast({
                  title: "Secure upload — Coming Soon.",
                  body: "Document upload + e-signature launch with the production build. Email your docs to support@pickloads.com for now.",
                });
              }
            }}
          >
            <span className="big" aria-hidden="true">⇪</span>
            <b>Upload your documents</b>
            <span>
              MC/DOT letter, certificate of insurance, W-9, voided check — drag
              &amp; drop or tap to browse.
            </span>
            <span className="mono">
              {"// Secure upload + e-signature go live with the production build"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
