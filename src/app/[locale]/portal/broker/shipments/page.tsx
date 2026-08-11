import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";

export const dynamic = "force-dynamic";

/**
 * M-81 — `/portal/broker/shipments` → `/portal/broker`.
 *
 * The detail route is `/portal/broker/shipments/[shipmentId]`, so this
 * segment exists as a parent whether or not anything renders it. A dangling
 * parent that 404s is the kind of thing a partner hits by deleting the id off
 * the end of a URL, and answering that with "not found" while the list plainly
 * exists one level up is a worse experience than one redirect.
 *
 * A redirect and not a duplicate list: two routes rendering the same table
 * would be two places to keep the §25 bound, the filters and the empty states
 * in step.
 */
export default async function BrokerShipmentsIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(getPathname({ href: "/portal/broker", locale }));
}
