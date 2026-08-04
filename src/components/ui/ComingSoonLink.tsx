"use client";

import { showToast } from "./PortalToast";

/**
 * Carrier/Shipper Login links — portals ship in Phase 2/3; until then this
 * reproduces the prototype's intentional "Coming Soon" toast (audit F-02:
 * phased scope approved).
 */
export function ComingSoonLink({
  kind,
  className,
  children,
}: {
  kind: "Carrier" | "Shipper";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href="#"
      className={className}
      onClick={(e) => {
        e.preventDefault();
        showToast({
          title: `${kind} Portal — Coming Soon.`,
          body: "Live tracking, documents & settlements are on the way. Call (908) 404-5373 in the meantime.",
        });
      }}
    >
      {children}
    </a>
  );
}
