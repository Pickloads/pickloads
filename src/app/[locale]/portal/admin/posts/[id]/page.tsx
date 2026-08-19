import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PostEditor, PublishToggle } from "@/components/portal/PostEditor";
import { renderMarkdown } from "@/lib/markdown";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Edit post — PickLoads",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** M-33 — edit a post, with a server-rendered preview of the safe renderer. */
export default async function EditPostPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  await requireStaff(locale);
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();

  const { data: post } = await supabase
    .from("posts")
    .select(
      "id, title, slug, locale, category, excerpt, body_md, cover_style, published, published_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!post) notFound();

  return (
    <main id="main" className="a-page">
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk / Marketing / Posts</span>
          <h1>Edit post</h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {post.published ? (
            // Plain anchor: the live URL depends on the POST's locale, not
            // the admin UI locale (en lives unprefixed, others at /xx/…).
            <a
              className="btn btn-ghost btn-sm"
              href={
                post.locale === "en"
                  ? `/blog/${post.slug}`
                  : `/${post.locale}/blog/${post.slug}`
              }
              target="_blank"
              rel="noreferrer"
            >
              View live ↗
            </a>
          ) : null}
          <PublishToggle postId={post.id} published={post.published} />
          <Link className="btn btn-ghost btn-sm" href="/portal/admin/posts">
            ← All posts
          </Link>
        </div>
      </div>

      <div className="pgrid2">
        <PostEditor post={post} />
        <div className="pcard">
          <h2>Preview (saved version)</h2>
          <div
            className="article-body"
            // Safe by construction: renderMarkdown escapes ALL input before
            // rebuilding its small allow-list of tags (src/lib/markdown.ts).
            dangerouslySetInnerHTML={{ __html: renderMarkdown(post.body_md) }}
          />
        </div>
      </div>
    </main>
  );
}
