import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import type { Database } from "./database.types";

/** Route prefixes that require an authenticated session (Phase 2+). */
const PROTECTED_PREFIXES = ["/portal"];

/**
 * M-02b: portal routes live under [locale] (localePrefix "as-needed"), so
 * /es/portal must be recognized as protected too. Returns the pathname with
 * a leading locale segment removed, plus the locale prefix for redirects.
 */
function splitLocale(pathname: string): { prefix: string; path: string } {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return { prefix: `/${locale}`, path: "/" };
    if (pathname.startsWith(`/${locale}/`)) {
      return { prefix: `/${locale}`, path: pathname.slice(locale.length + 1) };
    }
  }
  return { prefix: "", path: pathname };
}

/**
 * Session refresh + route protection, called from the root middleware.
 * Follows the @supabase/ssr contract: the response object must carry any
 * refreshed cookies back to the browser.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Never run logic between client creation and getUser() (supabase/ssr rule).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const { prefix, path } = splitLocale(pathname);
  // M-51: /portal itself is the pre-auth selection page — only its subpaths
  // require a session. The page role-routes signed-in users server-side.
  const isProtected = PROTECTED_PREFIXES.some((p) =>
    path.startsWith(`${p}/`),
  );

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = `${prefix}/login`;
    url.search = "";
    url.searchParams.set("next", pathname);
    // M-54: auth cookies present but no valid user → the session expired
    // (or was revoked); the login page shows the explicit expired state
    // instead of a silent bounce.
    const hadSession = request.cookies
      .getAll()
      .some((c) => c.name.includes("-auth-token"));
    if (hadSession) url.searchParams.set("expired", "1");
    return NextResponse.redirect(url);
  }

  return response;
}
