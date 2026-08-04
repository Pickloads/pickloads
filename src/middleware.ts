import createIntlMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/middleware";

const intlMiddleware = createIntlMiddleware(routing);

export async function middleware(request: NextRequest) {
  // Supabase first: refreshes the session and enforces /portal protection.
  // If it redirects (unauthenticated portal access), that wins.
  const sessionResponse = await updateSession(request);
  if (sessionResponse.headers.has("location")) return sessionResponse;

  // next-intl handles locale detection/rewrites; carry refreshed auth cookies over.
  const intlResponse = intlMiddleware(request);
  for (const cookie of sessionResponse.cookies.getAll()) {
    intlResponse.cookies.set(cookie);
  }
  return intlResponse;
}

export const config = {
  matcher: [
    // M-15: robots.txt/sitemap.xml are locale-less metadata routes — the intl
    // middleware must not rewrite them into /[locale]/… (they'd 404).
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2)$).*)",
  ],
};
