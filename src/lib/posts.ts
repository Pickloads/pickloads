import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * M-33 — public blog reads. Uses a bare ANON-key client (no cookies): the
 * only visible rows are those the "public read published posts" RLS policy
 * exposes (published = true), which is exactly the public contract.
 *
 * Graceful degradation: with placeholder/unset Supabase env (build, secret-
 * less previews) every helper resolves to empty — the blog renders its
 * honest empty state and the sitemap simply omits posts.
 */

export type PublicPost = Pick<
  Database["public"]["Tables"]["posts"]["Row"],
  | "id"
  | "slug"
  | "locale"
  | "title"
  | "excerpt"
  | "category"
  | "body_md"
  | "cover_style"
  | "published_at"
  | "updated_at"
>;

const POST_COLUMNS =
  "id, slug, locale, title, excerpt, category, body_md, cover_style, published_at, updated_at";

function tryCreateAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || url.includes("placeholder")) return null;
  return createSupabaseClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function fetchPublishedPosts(
  locale: string,
): Promise<PublicPost[]> {
  const client = tryCreateAnonClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from("posts")
      .select(POST_COLUMNS)
      .eq("locale", locale)
      .eq("published", true)
      .order("published_at", { ascending: false })
      .limit(100);
    if (error) {
      console.error("[posts] list fetch failed", error.message);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.error("[posts] list fetch failed", err);
    return [];
  }
}

export async function fetchPublishedPost(
  locale: string,
  slug: string,
): Promise<PublicPost | null> {
  const client = tryCreateAnonClient();
  if (!client) return null;
  try {
    const { data, error } = await client
      .from("posts")
      .select(POST_COLUMNS)
      .eq("locale", locale)
      .eq("slug", slug)
      .eq("published", true)
      .maybeSingle();
    if (error) {
      console.error("[posts] post fetch failed", error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error("[posts] post fetch failed", err);
    return null;
  }
}

/** (slug, locale, updated_at) of every published post — sitemap feed. */
export async function fetchPublishedPostRefs(): Promise<
  Array<{ slug: string; locale: string; updated_at: string }>
> {
  const client = tryCreateAnonClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from("posts")
      .select("slug, locale, updated_at")
      .eq("published", true)
      .limit(1000);
    if (error) {
      console.error("[posts] sitemap fetch failed", error.message);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.error("[posts] sitemap fetch failed", err);
    return [];
  }
}
