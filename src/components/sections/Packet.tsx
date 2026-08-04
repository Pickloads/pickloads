"use client";

import { Link } from "@/i18n/navigation";
import { showToast } from "@/components/ui/PortalToast";
import { useV4 } from "@/i18n/v4";

/*
 * Download links stay inert until lawyer-approved PDFs exist
 * (company_settings.packet_downloads_live, audit U-09). M-21: the upload card
 * now routes to the live secure-upload wizard at /become-a-carrier.
 */
const PACKET_DOCS = [
  ["Dispatch Agreement", "Month-to-month service terms — plain English"],
  ["W-9 Form", "Current IRS revision, ready to fill"],
  ["Insurance Requirements", "$1M auto liability · $100K cargo minimums"],
  ["Factoring Guide", "How factoring works with our invoicing"],
] as const;

export function Packet() {
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
