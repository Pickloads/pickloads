-- ============================================================================
-- PickLoads — Migration 0013: let the anon role EXECUTE is_staff() (M-61).
--
-- FOUND BY THE NEW RLS SUITE (supabase/tests/20_rls_isolation.sql), not by
-- review. Reproduction on local PG16, anon role, one published + one draft
-- post:
--
--     set role anon;
--     select count(*) from posts where published = true;
--     ERROR:  permission denied for function is_staff
--
-- Why: `posts` carries TWO permissive SELECT policies (0002) —
--   "public read published posts"  using (published)
--   "staff manage posts"           for all using (is_staff())
-- PostgreSQL ORs permissive policies and applies RLS quals BEFORE the
-- caller's WHERE. For a row with published = false the OR does not
-- short-circuit, so is_staff() is invoked — and 0002 granted EXECUTE on it
-- to `authenticated` only. Result on a live project: the public blog list,
-- the post pages and the sitemap (all anon-key reads in src/lib/posts.ts)
-- fail the moment a single unpublished draft exists — which is the normal
-- state of the M-33 editor workflow. The app's honest-degradation path turns
-- that into an empty blog + a logged error, so it would have shipped silently.
--
-- Fix (additive; 0001–0004 stay frozen): grant EXECUTE to anon. is_staff()
-- is SECURITY DEFINER, STABLE and returns
--   coalesce((select role from profiles where id = auth.uid()) in (...), false)
-- so for an anon session (auth.uid() is null) it returns false and exposes
-- nothing — it is a boolean oracle about the CALLER only. No policy changes,
-- no new anon read/write surface: every anon SELECT still resolves to
-- "published posts + company_settings" exactly as 0002 intended.
--
-- current_user_role() deliberately stays authenticated-only: its sole
-- anon-reachable policy pairs with `using (true)` on company_settings, which
-- the planner constant-folds before the function is ever reached (verified in
-- the same suite: "anon CAN read company_settings").
-- ============================================================================

grant execute on function public.is_staff() to anon;

comment on function public.is_staff() is
  'Staff predicate for RLS. EXECUTE granted to authenticated AND anon (0013): '
  'anon must be able to evaluate the OR-ed "staff manage posts" policy to read '
  'published posts. Returns false for anonymous sessions — no data exposure.';
