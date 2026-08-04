# M-23 — CRM (Leads Pipeline)

**Status:** ✅ Complete · **Phase:** 2 · **Date:** 2026-08-04

## What was built
`/portal/admin/leads` + `/portal/admin/leads/[id]` — the staff CRM over
`carrier_leads` (arch §6), plus the portal shell everything Phase 2 hangs on.

### Portal shell
- `src/app/[locale]/portal/layout.tsx` + `src/app/portal.css` — dark admin
  surface composed strictly from existing V4 tokens/values (U-10 citation in
  the stylesheet header; night/asphalt/amber/mono vocabulary, U-03 red
  family). Sidebar (`PortalSidebar`, role-aware links + sign-out), `.pmain`
  pane, `.ptile`/`.ptable`/`.pbadge`/kanban/timeline vocabulary shared by
  M-24/M-25.
- `/portal` role router: staff → `/portal/admin`, carriers → `/portal/carrier`.
- **Auth model:** middleware bounces anonymous traffic; every page calls
  `requireStaff(locale)` (src/lib/auth.ts) which re-verifies the session
  server-side and reads the role from `profiles` — non-staff are redirected
  to the carrier portal. Role checks never live client-side.
- All portal pages are `force-dynamic`, `noindex`, excluded from the sitemap
  (and `/portal` was already in robots disallow).

### Kanban board
- 9 columns = the full `lead_status` pipeline. Cards show name, click-to-call
  `tel:` phone, equipment (truck·trailer), source fallback, age (m/h/d),
  priority badges (high/urgent), `new auth` badge, first 3 tags, and a
  **CALLBACK DUE** flag when `callback_at` is past.
- **Drag & drop:** native HTML5 DnD, optimistic move, server action
  `updateLeadStatus` (Zod uuid+enum), revert + `role=alert` error on failure,
  `router.refresh()` on success. **Journaling is automatic** — the migration
  0003 trigger writes the `status_change` activity and stamps
  `first_contacted_at` on the first move out of NEW; because writes use the
  cookie-bound server client, `auth.uid()` attributes the change to the
  acting dispatcher.
- **Filters:** dispatcher (incl. Unassigned), lead_type, tag substring —
  client-side over the fetched set (≤500 most recent).

### Lead detail
- Full record table (phone/email/type/source/equipment/trucks/state/MC/
  language/created) + **first-contact KPI badge** (green ≤15 min, amber
  after, red "not contacted yet").
- `LeadMetaForm` — status, dispatcher assignment, priority, tags
  (comma-separated → normalized kebab array, max 12), `callback_at`
  datetime picker.
- `ActivityForm` — note / call / callback / appointment; callback and
  appointment require a datetime and also update `carrier_leads.callback_at`.
- Timeline renders `lead_activities` (status changes as `old → new`, other
  types with body), attributed to staff names.

## Security (Q3)
CRM reads/writes use the **cookie-bound server client**, so RLS staff
policies are a real second gate behind the explicit `staffSession()` check in
every action, and `lead_activities` insert RLS (`created_by = auth.uid()`)
holds. The admin (service-role) client is not used anywhere in M-23.

## Judgment calls
- **Realtime (O-04) deferred**: the task spec asks for optimistic DnD via
  server action; multi-dispatcher live sync via Supabase Realtime is a
  leftover — `router.refresh()` after every mutation keeps single-user state
  honest.
- SMS/email logging types exist in the enum but aren't offered in the form
  (no Twilio per Q6; email sending from CRM is Phase 3).
- Admin UI is intentionally English (internal tool, per scope).
- `datetime-local` values are interpreted in the server's timezone —
  acceptable while ops is single-timezone NJ; revisit with multi-TZ staff.

## DB changes
None. Writes: `carrier_leads`, `lead_activities` (+ automatic journal rows).

## Endpoints
Server actions: `updateLeadStatus`, `addLeadActivity`, `updateLeadMeta`.

## Env vars
None new.

## Verification
typecheck ✓ · lint ✓ · build ✓ · prerender-manifest inspected: no portal
routes prerendered (force-dynamic holds) ✓ · secretless render: pages
redirect to /login without a session ✓

## Extension points
- `COLUMNS`/`STATUSES` arrays are the single pipeline definition points.
- Freight-quote CRM (same `lead_activities` table, `quote_id` side) can
  clone this surface for the shipper pipeline.
- Realtime channel on `carrier_leads` plugs into `KanbanBoard`'s
  `useEffect`-sync without structural change.
