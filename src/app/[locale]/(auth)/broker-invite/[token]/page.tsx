import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { PageHero } from "@/components/ui/PageHero";
import { AcceptBrokerInviteForm } from "@/components/auth/AcceptBrokerInviteForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Partner Invite — PickLoads Logistics Group",
  robots: { index: false, follow: false },
};

/**
 * M-81 — broker-partner invite accept page (§12 *"invited by an admin"*).
 *
 * A SEPARATE ROUTE from M-58's `/invite/[token]`, not a branch inside it.
 * Both take a 64-hex token and both look it up by SHA-256 hash, but they read
 * different tables and mint different roles, and one route that decided which
 * from the token's shape would be a route where a lookup miss on one table
 * silently falls through to the other. Two tables, two routes, two
 * indistinguishable refusals.
 *
 * The token shape is validated BEFORE any query: a malformed value 404s
 * without touching the database, which keeps a scripted scan out entirely.
 * Everything else — hash match, expiry, single-use, revocation — happens in
 * the server action and produces ONE message for all four failures, so the
 * page is not an oracle for which invites exist.
 *
 * Staff-adjacent surface: English, per M-58's precedent.
 */
export default async function BrokerInvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();

  return (
    <main id="main">
      <PageHero eyebrow="Partner access" title="Join the PickLoads partner portal">
        Partner access is invitation-only — this link was created for you by a
        PickLoads admin.
      </PageHero>
      <section className="light" style={{ padding: "56px 0 88px" }}>
        <div className="wrap">
          <AcceptBrokerInviteForm token={token} />
        </div>
      </section>
    </main>
  );
}
