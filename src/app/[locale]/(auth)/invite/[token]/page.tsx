import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { PageHero } from "@/components/ui/PageHero";
import { AcceptInviteForm } from "@/components/auth/AcceptInviteForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Staff Invite — PickLoads Logistics Group",
  robots: { index: false, follow: false },
};

/**
 * M-58 — staff invite accept page. The URL token is the credential (raw
 * token lives only in the invite email; the DB stores its SHA-256 hash).
 * All validation — hash match, expiry, single-use — happens in the server
 * action; a malformed token 404s immediately. Staff surface: English.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();

  return (
    <main>
      <PageHero eyebrow="Dispatch desk" title="Join the PickLoads team">
        Staff access is invite-only — this link was created for you by an
        admin.
      </PageHero>
      <section className="light" style={{ padding: "56px 0 88px" }}>
        <div className="wrap">
          <AcceptInviteForm token={token} />
        </div>
      </section>
    </main>
  );
}
