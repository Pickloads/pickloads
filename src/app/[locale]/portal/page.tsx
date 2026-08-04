import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { requireProfile, portalHomeFor } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** /portal — role router: staff → admin, shippers → shipper, carriers → carrier. */
export default async function PortalIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireProfile(locale);
  redirect(getPathname({ href: portalHomeFor(session.role), locale }));
}
