# M-33 — Blog CMS

**Status:** ✅ Complete · **Phase:** 3 · **Date:** 2026-08-04

## What was built

### Safe markdown renderer (`src/lib/markdown.ts`)
No new dependency (CLAUDE.md rule). ALL input is HTML-escaped first, then a
small allow-list is rebuilt on top: `# ## ###` headings (demoted one level —
h1 is the page title), paragraphs, `**bold**`, `*italic*`, `` `code` ``,
fenced code blocks, `[text](url)` links (**http(s)/site-relative only** —
`javascript:` etc. render as literal text; external links get
`rel="noopener noreferrer"`), ordered/unordered lists, blockquotes, `---`
rules. Raw HTML in `body_md` can never reach the page. Plus
`readingMinutes()` (~200 wpm) for the card meta line.

### Staff editor — `/portal/admin/posts`
- List (all locales, drafts included) with live/draft badges, publish dates,
  one-click **Publish/Unpublish** toggle.
- `/portal/admin/posts/new` + `/portal/admin/posts/[id]`: title (auto-slugs
  until the slug is touched), slug, locale, category, excerpt, markdown body,
  cover style c1–c4 (labeled with the V4 gradient meanings), publish
  checkbox. Edit view renders a server-side **preview** of the saved body
  through the same renderer the public page uses.
- `savePost` stamps `published_at` on first publish and keeps it across
  unpublish/republish; unique `(slug, locale)` violations return a readable
  message. Author = session user. All writes cookie-bound ("staff manage
  posts" RLS).

### Public `/blog` (SAMPLE_POSTS removed — audit F-13 resolved)
Reads published posts for the current locale via a **bare anon-key client**
(`src/lib/posts.ts`) — the "public read published posts" RLS policy is the
exact public contract. Empty locale → honest "first articles are on the way"
empty state + the newsletter form. ISR `revalidate = 600`.

### `/blog/[slug]` article page
V4 vocabulary: cover hero reusing the `.post` cover gradients (v4.css
selectors extended to `.article-cover.c1–c4` — same values, no new colors)
+ token-only prose styles (`.article-body`). Meta line (date · read time),
excerpt lede, body via the safe renderer, back link, `CtaBand`. **Article
JSON-LD** (author/publisher = the LocalBusiness `@id`), OpenGraph
`type=article` with published/modified times. Unknown slug, draft, or
malformed slug → 404.

### Sitemap
Now async: published posts appended per their own locale. **No hreflang
alternates are fabricated for posts** — posts are per-locale documents
(unique `(slug, locale)`); a translation may not exist. Canonical-only on
the article page for the same reason.

## Graceful degradation
`tryCreateAnonClient` returns null on unset/placeholder Supabase env, so
build-time prerender, secretless previews and the sitemap all fall back to
"no posts" instead of throwing.

## Judgment calls
- ISR (10 min) over force-dynamic for the public pages: blog freshness
  doesn't need per-request DB reads and static-ish pages keep Lighthouse
  happy. Staff verify with the "View live" link after ~10 min or a redeploy.
- The cover system stays c1–c4 gradients (V4 vocabulary) instead of image
  uploads — no storage surface, no image moderation, visually consistent.
- Body headings demoted one level (`#` → h2, `##` → h3, `###` → h4) so a
  writer using `#` can't create a second h1 on the page.

## DB changes
None (posts table from 0001; RLS from 0002).

## Endpoints
Server actions `savePost`, `togglePostPublished`. Public reads in
`src/lib/posts.ts` (list, single, sitemap refs).

## Env vars
None new.

## Verification
typecheck ✓ · lint ✓ · build ✓ (177 static pages; /blog/[slug] dynamic+ISR)
· renderer smoke-tested: script tags escaped, `javascript:` links inert ✓
