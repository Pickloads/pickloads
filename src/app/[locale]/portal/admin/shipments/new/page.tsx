import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBooleanSetting } from "@/lib/company-settings";
import {
  BROKERAGE_CLOSED_MESSAGE,
  mapQuoteToShipmentDraft,
  QUOTE_CONVERSION_COLUMNS,
  type ConvertibleQuote,
} from "@/lib/shipments/create";
import {
  QuoteConvertForm,
  ShipmentCreateForm,
  type ShipperOption,
} from "@/components/portal/ShipmentOpsForms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "New shipment — PickLoads",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * M-75 — §14's "create shipment" and "convert accepted quote to shipment", on
 * one page because they are the same act arriving from two directions.
 *
 * `?quote=<id>` switches the page into conversion mode: it shows what the
 * quote maps to, names anything the mapping cannot carry, and offers one
 * button. The mapping shown here is the SAME pure function the server action
 * runs (`mapQuoteToShipmentDraft`), so the preview cannot disagree with the
 * result — a preview computed a second way is a preview that is eventually
 * wrong.
 *
 * §2 is enforced in three places and rendered in one: the switchboard read
 * below decides what this page SHOWS, `create.ts` refuses the ACTION, and
 * 0017's trigger refuses the INSERT. A dispatcher meets the first; the other
 * two are what make the first not the only thing standing between a closed
 * brokerage and a shipment.
 */
export default async function NewShipmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  await requireStaff(locale);
  const sp = await searchParams;
  const quoteParam = typeof sp.quote === "string" ? sp.quote : null;

  const supabase = await createClient();
  const brokerageOpen = await getBooleanSetting("brokerage_active", false);

  const [{ data: shipperRows }, quoteResult] = await Promise.all([
    supabase
      .from("shippers")
      .select("id, company_name")
      .order("company_name")
      .limit(500),
    quoteParam !== null && UUID.test(quoteParam)
      ? supabase
          .from("freight_quotes")
          .select(QUOTE_CONVERSION_COLUMNS)
          .eq("id", quoteParam)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const shippers: ShipperOption[] = (shipperRows ?? []).map((s) => ({
    id: s.id,
    name: s.company_name,
  }));

  const quote = (quoteResult.data ?? null) as ConvertibleQuote | null;
  const mapped = quote === null ? null : mapQuoteToShipmentDraft(quote);

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk / Shipments</span>
          <h1>{quote === null ? "New shipment" : "Convert quote"}</h1>
        </div>
        <Link className="btn btn-ghost btn-sm" href="/portal/admin/shipments">
          ← Board
        </Link>
      </div>

      {quote !== null && mapped !== null ? (
        <>
          <span className="psec">From quote</span>
          <div className="ptable-wrap" style={{ marginBottom: 16 }}>
            <table className="ptable ptable--cards">
              <thead>
                <tr>
                  <th scope="col">Lane</th>
                  <th scope="col">Equipment</th>
                  <th scope="col">Weight</th>
                  <th scope="col">Quoted rate</th>
                  <th scope="col">Quote stage</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td data-th="Lane">
                    {quote.pickup_city ?? "?"}, {quote.pickup_state ?? "?"} →{" "}
                    {quote.delivery_city ?? "?"}, {quote.delivery_state ?? "?"}
                  </td>
                  <td data-th="Equipment">{quote.equipment ?? "—"}</td>
                  <td data-th="Weight">{quote.weight_lbs ?? "—"}</td>
                  <td data-th="Quoted rate">
                    {quote.quoted_rate === null ? "—" : `$${quote.quoted_rate}`}
                  </td>
                  <td data-th="Quote stage">{quote.status}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {!mapped.ok ? (
            <p className="pempty" role="alert">
              {mapped.reason}
            </p>
          ) : !brokerageOpen ? (
            <p className="pempty" role="status">
              {BROKERAGE_CLOSED_MESSAGE}
            </p>
          ) : (
            <>
              {mapped.warnings.length > 0 ? (
                <ul className="pempty" style={{ paddingTop: 0 }}>
                  {mapped.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
              <QuoteConvertForm
                quoteId={quote.id}
                label={`${mapped.draft.origin_city}, ${mapped.draft.origin_state} → ${mapped.draft.destination_city}, ${mapped.draft.destination_state}`}
              />
            </>
          )}
          <p className="pempty">
            Or <Link href="/portal/admin/shipments/new">create a shipment from
            scratch</Link> and reference the quote by hand.
          </p>
        </>
      ) : (
        <ShipmentCreateForm
          shippers={shippers}
          brokerageOpen={brokerageOpen}
          brokerageMessage={BROKERAGE_CLOSED_MESSAGE}
        />
      )}
    </main>
  );
}
