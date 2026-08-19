import type { Metadata } from "next";
import { Link } from "@/i18n/navigation";
import { requireStaff } from "@/lib/auth";
import { PostEditor } from "@/components/portal/PostEditor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "New post — PickLoads",
  robots: { index: false, follow: false },
};

/** M-33 — create a blog post. */
export default async function NewPostPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireStaff(locale);

  return (
    <main id="main" className="a-page">
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk / Marketing / Posts</span>
          <h1>New post</h1>
        </div>
        <Link className="btn btn-ghost btn-sm" href="/portal/admin/posts">
          ← All posts
        </Link>
      </div>
      <PostEditor post={null} />
    </main>
  );
}
