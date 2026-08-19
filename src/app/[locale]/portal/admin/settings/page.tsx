import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SettingRow } from "@/components/portal/SettingRow";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Company Settings — PickLoads",
  robots: { index: false, follow: false },
};

/**
 * M-24 — company_settings editor (admin only, arch §9: "the day the MC
 * activates, admin edits 3 keys and the whole site updates").
 */
export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireAdmin(locale);
  const supabase = await createClient();

  const { data: settings, error } = await supabase
    .from("company_settings")
    .select("key, value, description, updated_at")
    .order("key", { ascending: true });

  return (
    <main id="main" className="a-page">
      <header className="a-head">
        <div className="a-head-main">
          <span className="a-crumb">Dispatch desk / Admin</span>
          <h1>Company settings</h1>
          <p className="a-desc">
            These settings drive the public site immediately — credential
            blocks, bond status and the feature gates for testimonials, packet
            downloads, the load ticker and brokerage. Never store secrets here:
            the table is publicly readable.
          </p>
        </div>
        {settings ? (
          <div className="a-head-side">
            <div className="a-badges">
              <span className="a-badge is-neutral">
                {settings.length} setting{settings.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="a-card" role="alert">
          <div className="a-empty">
            <b>Settings could not be loaded</b>
            {error.message}
          </div>
        </div>
      ) : settings && settings.length > 0 ? (
        settings.map((s) => (
          <SettingRow
            key={s.key}
            settingKey={s.key}
            value={s.value}
            description={s.description}
            updatedAt={s.updated_at}
          />
        ))
      ) : (
        <div className="a-card">
          <div className="a-empty">
            <b>No settings found</b>
            The launch defaults have not been installed yet.
          </div>
        </div>
      )}
    </main>
  );
}
