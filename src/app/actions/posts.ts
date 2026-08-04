"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isStaffRole } from "@/lib/auth";
import type { FormState } from "@/lib/form-state";
import type { Database } from "@/lib/supabase/database.types";

/**
 * M-33 blog CMS server actions — staff only (Q3). Writes go through the
 * cookie-bound client so the "staff manage posts" RLS policy gates again
 * and author attribution uses the real session.
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

async function staffSession(): Promise<{
  supabase: ServerSupabase;
  userId: string;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || !isStaffRole(profile.role)) return null;
  return { supabase, userId: user.id };
}

const NOT_STAFF = "Your session expired or lacks staff access. Sign in again.";

const postSchema = z.object({
  id: z
    .union([z.literal(""), z.uuid()])
    .transform((v) => (v ? v : null)),
  title: z.string().trim().min(3, "Title is too short.").max(160),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug: lowercase words separated by hyphens.",
    )
    .max(120),
  locale: z.enum(["en", "es", "fr", "ru", "ht"]),
  category: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => (v ? v : null)),
  excerpt: z
    .string()
    .trim()
    .max(400, "Excerpt max 400 chars.")
    .optional()
    .transform((v) => (v ? v : null)),
  body_md: z.string().trim().min(50, "Write the article first (min 50 chars)."),
  cover_style: z.enum(["c1", "c2", "c3", "c4"]),
  published: z.boolean(),
});

export type SavePostResult = FormState & { postId?: string };

export async function savePost(
  _prev: SavePostResult,
  formData: FormData,
): Promise<SavePostResult> {
  const str = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" ? v : "";
  };
  const parsed = postSchema.safeParse({
    id: str("id"),
    title: str("title"),
    slug: str("slug"),
    locale: str("locale"),
    category: str("category"),
    excerpt: str("excerpt"),
    body_md: str("body_md"),
    cover_style: str("cover_style") || "c1",
    published: formData.get("published") === "on",
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      status: "error",
      message: first?.message ?? "Check the post fields.",
    };
  }
  const post = parsed.data;

  const session = await staffSession();
  if (!session) return { status: "error", message: NOT_STAFF };

  if (post.id) {
    // ---- update ----
    const { data: existing } = await session.supabase
      .from("posts")
      .select("id, published, published_at")
      .eq("id", post.id)
      .maybeSingle();
    if (!existing) return { status: "error", message: "Post not found." };

    const update: Database["public"]["Tables"]["posts"]["Update"] = {
      title: post.title,
      slug: post.slug,
      locale: post.locale,
      category: post.category,
      excerpt: post.excerpt,
      body_md: post.body_md,
      cover_style: post.cover_style,
      published: post.published,
      // First publish stamps published_at; unpublish keeps the original date.
      published_at:
        post.published && existing.published_at === null
          ? new Date().toISOString()
          : existing.published_at,
    };
    const { error } = await session.supabase
      .from("posts")
      .update(update)
      .eq("id", post.id);
    if (error) {
      return {
        status: "error",
        message:
          error.code === "23505"
            ? `A ${post.locale} post with slug "${post.slug}" already exists.`
            : "Couldn't save the post. Retry.",
      };
    }
    return { status: "success", postId: post.id };
  }

  // ---- create ----
  const { data: created, error } = await session.supabase
    .from("posts")
    .insert({
      title: post.title,
      slug: post.slug,
      locale: post.locale,
      category: post.category,
      excerpt: post.excerpt,
      body_md: post.body_md,
      cover_style: post.cover_style,
      published: post.published,
      published_at: post.published ? new Date().toISOString() : null,
      author_id: session.userId,
    })
    .select("id")
    .single();
  if (error || !created) {
    return {
      status: "error",
      message:
        error?.code === "23505"
          ? `A ${post.locale} post with slug "${post.slug}" already exists.`
          : "Couldn't create the post. Retry.",
    };
  }
  return { status: "success", postId: created.id };
}

export async function togglePostPublished(
  postId: string,
): Promise<{ ok: boolean; error?: string }> {
  const id = z.uuid().safeParse(postId);
  if (!id.success) return { ok: false, error: "Invalid post." };
  const session = await staffSession();
  if (!session) return { ok: false, error: NOT_STAFF };

  const { data: existing } = await session.supabase
    .from("posts")
    .select("id, published, published_at")
    .eq("id", id.data)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Post not found." };

  const next = !existing.published;
  const { error } = await session.supabase
    .from("posts")
    .update({
      published: next,
      published_at:
        next && existing.published_at === null
          ? new Date().toISOString()
          : existing.published_at,
    })
    .eq("id", id.data);
  if (error) return { ok: false, error: "Couldn't update publish state." };
  return { ok: true };
}
