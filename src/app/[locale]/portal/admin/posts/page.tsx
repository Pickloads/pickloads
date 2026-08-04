import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PublishToggle } from "@/components/portal/PostEditor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Blog posts — PickLoads",
  robots: { index: false, follow: false },
};

/** M-33 — staff blog CMS: post list (all locales, drafts included). */
export default async function AdminPostsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireStaff(locale);
  const supabase = await createClient();

  const { data: postRows, error } = await supabase
    .from("posts")
    .select("id, title, slug, locale, category, published, published_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(300);
  const posts = postRows ?? [];
  const published = posts.filter((p) => p.published).length;

  return (
    <main id="main">
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk / Marketing</span>
          <h1>Blog posts</h1>
        </div>
        <Link className="btn btn-amber btn-sm" href="/portal/admin/posts/new">
          + New post
        </Link>
      </div>

      <div className="ptiles">
        <div className="ptile">
          <b>{posts.length}</b>
          <span>Posts total</span>
        </div>
        <div className="ptile">
          <b>{published}</b>
          <span>Published</span>
        </div>
        <div className="ptile">
          <b>{posts.length - published}</b>
          <span>Drafts</span>
        </div>
      </div>

      <div className="ptable-wrap">
        {error ? (
          <p className="pempty">
            Couldn&apos;t load posts ({error.message}). Check the Supabase
            connection.
          </p>
        ) : posts.length === 0 ? (
          <p className="pempty">
            No posts yet. The public /blog shows its newsletter empty state
            until the first article is published (launch target: 2 articles).
          </p>
        ) : (
          <table className="ptable">
            <thead>
              <tr>
                <th>Title</th>
                <th>Slug</th>
                <th>Locale</th>
                <th>Category</th>
                <th>State</th>
                <th>Published</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/portal/admin/posts/${p.id}`}>{p.title}</Link>
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: ".74rem" }}>
                    {p.slug}
                  </td>
                  <td>
                    <span className="pbadge">{p.locale}</span>
                  </td>
                  <td>{p.category ?? "—"}</td>
                  <td>
                    <span className={`pbadge ${p.published ? "green" : "amber"}`}>
                      {p.published ? "live" : "draft"}
                    </span>
                  </td>
                  <td>
                    {p.published_at
                      ? new Date(p.published_at).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "—"}
                  </td>
                  <td>
                    <PublishToggle postId={p.id} published={p.published} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
