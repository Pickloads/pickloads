"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { savePost, togglePostPublished, type SavePostResult } from "@/app/actions/posts";

/** M-33 — staff post editor (create + edit) and publish toggle. */

export interface EditablePost {
  id: string;
  title: string;
  slug: string;
  locale: string;
  category: string | null;
  excerpt: string | null;
  body_md: string;
  cover_style: string | null;
  published: boolean;
}

const LOCALES = ["en", "es", "fr", "ru", "ht"] as const;
const COVERS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "c1", label: "c1 — green (market)" },
  { value: "c2", label: "c2 — amber (tips)" },
  { value: "c3", label: "c3 — slate (news)" },
  { value: "c4", label: "c4 — red (alerts)" },
];

const initialState: SavePostResult = { status: "idle" };

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function PostEditor({ post }: { post: EditablePost | null }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(savePost, initialState);
  const [slug, setSlug] = useState(post?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(post));

  useEffect(() => {
    if (state.status === "success" && state.postId) {
      if (!post) router.push(`/portal/admin/posts/${state.postId}`);
      else router.refresh();
    }
  }, [state, post, router]);

  return (
    <form action={formAction} className="pcard" style={{ maxWidth: 860 }}>
      <input type="hidden" name="id" value={post?.id ?? ""} />
      <div className="pform-row">
        <div className="field">
          <label htmlFor="pe-title">Title *</label>
          <input
            id="pe-title"
            name="title"
            required
            maxLength={160}
            defaultValue={post?.title ?? ""}
            onChange={(e) => {
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="pe-slug">Slug *</label>
          <input
            id="pe-slug"
            name="slug"
            required
            maxLength={120}
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
            placeholder="q3-freight-market-update"
          />
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="pe-locale">Locale *</label>
          <select id="pe-locale" name="locale" defaultValue={post?.locale ?? "en"}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pe-category">Category</label>
          <input
            id="pe-category"
            name="category"
            maxLength={60}
            defaultValue={post?.category ?? ""}
            placeholder="Freight Market"
          />
        </div>
      </div>
      <div className="pform-row">
        <div className="field">
          <label htmlFor="pe-cover">Cover style</label>
          <select
            id="pe-cover"
            name="cover_style"
            defaultValue={post?.cover_style ?? "c1"}
          >
            {COVERS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pe-published" style={{ marginBottom: 7 }}>
            Published
          </label>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "13px 12px",
              border: "1px solid var(--line)",
              borderRadius: 6,
              background: "#0B0E11",
              cursor: "pointer",
              fontSize: ".9rem",
            }}
          >
            <input
              id="pe-published"
              type="checkbox"
              name="published"
              defaultChecked={post?.published ?? false}
              style={{ width: 18, height: 18, accentColor: "var(--amber)" }}
            />
            Visible on /blog when checked
          </label>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="pe-excerpt">Excerpt (card + meta description)</label>
        <textarea
          id="pe-excerpt"
          name="excerpt"
          rows={2}
          maxLength={400}
          defaultValue={post?.excerpt ?? ""}
        />
      </div>
      <div className="field" style={{ marginBottom: 14 }}>
        <label htmlFor="pe-body">
          Body — markdown (## headings, **bold**, *italic*, [links](https://…),
          - lists, &gt; quotes)
        </label>
        <textarea
          id="pe-body"
          name="body_md"
          rows={22}
          required
          defaultValue={post?.body_md ?? ""}
          style={{ fontFamily: "var(--font-mono)", fontSize: ".84rem", lineHeight: 1.6 }}
        />
      </div>
      {state.status === "error" && state.message ? (
        <p role="alert" style={{ fontFamily: "var(--font-mono)", color: "#f2c9c9", fontSize: ".76rem", marginBottom: 12 }}>
          {state.message}
        </p>
      ) : null}
      {state.status === "success" ? (
        <p role="status" style={{ fontFamily: "var(--font-mono)", color: "#4CC492", fontSize: ".76rem", marginBottom: 12 }}>
          Saved.
        </p>
      ) : null}
      <button className="btn btn-amber btn-sm" type="submit" aria-busy={pending}>
        {pending ? "Saving…" : post ? "Save changes" : "Create post"}
      </button>
    </form>
  );
}

export function PublishToggle({
  postId,
  published,
}: {
  postId: string;
  published: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button
        type="button"
        className={`btn btn-sm ${published ? "btn-ghost" : "btn-green"}`}
        style={{ padding: "5px 10px", fontSize: ".68rem" }}
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await togglePostPublished(postId);
            if (!result.ok) setError(result.error ?? "Failed.");
            else router.refresh();
          });
        }}
      >
        {published ? "Unpublish" : "Publish"}
      </button>
      {error ? (
        <span role="alert" style={{ fontFamily: "var(--font-mono)", color: "#f2c9c9", fontSize: ".66rem" }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
