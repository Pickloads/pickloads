import { Link } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";

/**
 * M-69 / P-2 — the referral line is GATED, not deleted.
 *
 * "// Refer a carrier who signs up → earn a referral bonus." renders on the
 * home page, every /blog/[slug], all 8 /dispatch/[equipment] pages,
 * /truck-dispatch and the 6 state pages — × 5 locales. No referral programme
 * exists (directive §32 J / M-95 is unbuilt), so it was a live promise the
 * company could not honour.
 *
 * The approved marketing string is NOT removed: the standing design boundary
 * forbids changing approved copy without owner approval, and deleting it
 * would also drop it from the five i18n catalogues. Instead it renders only
 * when `company_settings.referral_program_active` is true (default false,
 * migration 0015 + seed) — the promise stops today and returns with one
 * setting flip, no deploy and no re-translation.
 *
 * `referralActive` is a prop rather than a read inside this component so the
 * 300+ statically prerendered pages that embed it stay prerendered: each
 * page reads the flag once through src/lib/company-settings.ts.
 */
export function CtaBand({ referralActive = false }: { referralActive?: boolean }) {
  const tv = useV4();
  return (
    <section className="cta-band" id="setup">
      <div className="wrap">
        <div>
          <h2>{tv("Ready to stop hunting loads?")}</h2>
<p>{tv("Carrier setup takes 5 minutes: docs, e-signature, done. Your dispatcher starts working your lanes today.")}</p>
{referralActive ? (
<p className="mono-note">{tv("// Refer a carrier who signs up → earn a referral bonus.")}</p>
) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Link className="btn btn-dark" href="/#quote">
            {tv("Start Carrier Setup")}
          </Link>
          <a
            className="btn btn-ghost"
            style={{ borderColor: "rgba(18,22,26,.35)", color: "var(--ink)" }}
            href="tel:+19084045373"
          >
            {tv("Or call (908) 404-5373")}
          </a>
        </div>
      </div>
    </section>
  );
}
