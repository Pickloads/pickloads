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
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk / Admin</span>
          <h1>Company settings</h1>
        </div>
      </div>
      <p
        className="mono"
        style={{ fontSize: ".72rem", color: "var(--steel)", marginBottom: 20, maxWidth: 720 }}
      >
        {"// "}These keys drive the public site live: MC/USDOT credential
        blocks, bond status, feature gates (testimonials, packet downloads,
        ticker mode, brokerage). Values are JSON. Never store secrets here —
        the table is publicly readable.
      </p>
      {error ? (
        <p className="pempty">Couldn&apos;t load settings ({error.message}).</p>
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
        <p className="pempty">
          No settings found — run supabase/seed.sql to install the launch
          defaults.
        </p>
      )}
    </main>
  );
}
