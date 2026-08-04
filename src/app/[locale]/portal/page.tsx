import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { requireProfile, isStaffRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** /portal — role router: staff → admin dashboard, carriers → their portal. */
export default async function PortalIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await requireProfile(locale);
  redirect(
    getPathname({
      href: isStaffRole(session.role) ? "/portal/admin" : "/portal/carrier",
      locale,
    }),
  );
}
