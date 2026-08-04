import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHero } from "@/components/ui/PageHero";

/*
 * Legal document shells (arch §3 legal/[doc]). Content is an external
 * dependency: lawyer-drafted text (legal checklist §10). Until each document
 * is delivered, the page states its status honestly — no lorem ipsum, no
 * AI-drafted legal text (directive: nothing fake).
 */
const LEGAL_DOCS: Record<string, { title: string; eyebrow: string }> = {
  privacy: { title: "Privacy Policy", eyebrow: "Legal" },
  terms: { title: "Terms of Service", eyebrow: "Legal" },
  cookies: { title: "Cookie Policy", eyebrow: "Legal" },
  "carrier-agreement": { title: "Carrier Agreement", eyebrow: "Legal" },
  "dispatch-agreement": { title: "Dispatch Agreement", eyebrow: "Legal" },
};

export function generateStaticParams() {
  return Object.keys(LEGAL_DOCS).map((doc) => ({ doc }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ doc: string }>;
}): Promise<Metadata> {
  const { doc } = await params;
  const entry = LEGAL_DOCS[doc];
  if (!entry) return {};
  return {
    title: `${entry.title} — PickLoads Logistics Group LLC`,
    robots: { index: false }, // indexable once real content lands
  };
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ doc: string }>;
}) {
  const { doc } = await params;
  const entry = LEGAL_DOCS[doc];
  if (!entry) notFound();

  return (
    <main>
      <PageHero eyebrow={entry.eyebrow} title={entry.title} />
      <section className="light">
        <div className="wrap" style={{ maxWidth: 820 }}>
          <p className="sub" style={{ maxWidth: "none" }}>
            This document is being finalized with counsel and will be published
            here before public launch. For any questions in the meantime,
            contact{" "}
            <a href="mailto:support@pickloads.com" style={{ color: "var(--amber-deep)", fontWeight: 600 }}>
              support@pickloads.com
            </a>{" "}
            or call (908) 404-5373.
          </p>
        </div>
      </section>
    </main>
  );
}
