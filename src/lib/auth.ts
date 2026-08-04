import "server-only";

import { redirect } from "next/navigation";
import { getPathname } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/supabase/database.types";

/**
 * M-23 server-side session/role helpers for the portal surface.
 *
 * Q3/RLS model: pages and CRM actions use the cookie-bound server client so
 * every read/write runs under the user's RLS policies (defense in depth) and
 * DB journaling triggers see `auth.uid()`. Middleware already bounces
 * unauthenticated /portal traffic; these helpers are the authoritative
 * server-side gate (role checks NEVER live client-side).
 */

export interface SessionProfile {
  userId: string;
  email: string | null;
  role: UserRole;
  fullName: string | null;
}

export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return null;
  return {
    userId: user.id,
    email: user.email ?? null,
    role: profile.role,
    fullName: profile.full_name,
  };
}

function localizedPath(href: string, locale: string): string {
  return getPathname({ href, locale });
}

/** Page gate: any authenticated profile, else → /login. */
export async function requireProfile(locale: string): Promise<SessionProfile> {
  const session = await getSessionProfile();
  if (!session) redirect(localizedPath("/login", locale));
  return session;
}

/** Role → portal home (M-32 adds the shipper surface). */
export function portalHomeFor(role: UserRole): string {
  if (role === "admin" || role === "dispatcher") return "/portal/admin";
  if (role === "shipper") return "/portal/shipper";
  return "/portal/carrier";
}

/** Page gate: staff only (admin/dispatcher); others land on their portal. */
export async function requireStaff(locale: string): Promise<SessionProfile> {
  const session = await requireProfile(locale);
  if (session.role !== "admin" && session.role !== "dispatcher") {
    redirect(localizedPath(portalHomeFor(session.role), locale));
  }
  return session;
}

/** Page gate: admin only (settings surface). */
export async function requireAdmin(locale: string): Promise<SessionProfile> {
  const session = await requireProfile(locale);
  if (session.role !== "admin") {
    redirect(localizedPath("/portal", locale));
  }
  return session;
}

export function isStaffRole(role: UserRole): boolean {
  return role === "admin" || role === "dispatcher";
}
