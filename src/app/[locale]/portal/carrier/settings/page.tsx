import type { Metadata } from "next";
import { requireCarrier } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getV4 } from "@/i18n/v4-server";
import {
  AccountPreferencesForm,
  PasswordChangeForm,
} from "@/components/portal/AccountSettingsForms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Account Settings — PickLoads Carrier Portal",
  robots: { index: false, follow: false },
};

/**
 * M-55 — account settings: password (browser client → Supabase Auth),
 * preferred language (profiles.preferred_language) and email preferences
 * (user_preferences, own-row RLS). Shared forms — M-56 reuses them for
 * shippers.
 */
export default async function CarrierSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireCarrier(locale);
  const tv = await getV4(locale);
  const supabase = await createClient();

  const [{ data: profile }, { data: prefs }] = await Promise.all([
    supabase
      .from("profiles")
      .select("preferred_language")
      .eq("id", session.userId)
      .maybeSingle(),
    supabase
      .from("user_preferences")
      .select("email_load_updates, email_document_reviews, email_marketing")
      .eq("profile_id", session.userId)
      .maybeSingle(),
  ]);

  return (
    <main>
      <div className="pbar">
        <div>
          <span className="crumb">{tv("Carrier portal")}</span>
          <h1>{tv("Account Settings")}</h1>
        </div>
      </div>

      <div className="pgrid2">
        <div className="pcard">
          <h2>{tv("Password")}</h2>
          <p className="mono" style={{ fontSize: ".72rem", color: "var(--steel)", marginBottom: 12 }}>
            {tv("Signed in as")} {session.email ?? "—"}
          </p>
          <PasswordChangeForm />
        </div>
        <div className="pcard">
          <h2>{tv("Language & email")}</h2>
          <AccountPreferencesForm
            preferredLanguage={profile?.preferred_language ?? locale}
            emailLoadUpdates={prefs?.email_load_updates ?? true}
            emailDocumentReviews={prefs?.email_document_reviews ?? true}
            emailMarketing={prefs?.email_marketing ?? false}
          />
        </div>
      </div>
    </main>
  );
}
