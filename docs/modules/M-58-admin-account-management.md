# M-58 — Admin Account Management

**Status:** ✅ Complete · **Phase:** Upgrade · **Date:** 2026-08-04

## What was built

| Surface | What it does |
|---|---|
| `/portal/admin/users` (admin-only) | Every account: filter by **role + status**, paginated (50/page, exact count, prev/next). Per row: name, login email (admin auth API, honest without service key), phone, join date, role/status badges; carrier rows add company, MC and **onboarding progress x/5** (account → MC/DOT → 4 required docs non-rejected → agreement → active) plus the **dispatcher assignment select** (writes `carriers.assigned_dispatcher_id`, cookie-bound staff RLS + audit). **Approve** (pending→active), **Suspend with mandatory reason**, **Reactivate** — self and admin accounts protected. Each change: `profiles.status` → `account_status_history` (old/new/reason/changed_by) → `audit_events` (`user.suspend`/`user.activate`) → in-portal notification row → customer `AccountStatusEmail`. Enforcement is already central (M-54 `requireProfile`). |
| Staff invite flow | Admin creates invite (email + role admin/dispatcher) → 0012 `staff_invites` row stores **only the SHA-256 hash** of a 32-byte token → `StaffInviteEmail` carries the single-use `/invite/[token]` link (7-day expiry) → accept page (V4 `.bigform`, malformed token 404s) → `acceptStaffInvite`: IP rate limit → hash lookup + expiry + single-use checks → `createUser` **email-confirmed** (the link itself proved inbox control — documented judgment; public signups stay never-auto-confirmed) → **role assigned server-side via service role** (`guard_role_change` still blocks self-promotion) → invite consumed → audit + ops email. Pending/accepted/expired invites listed on the Users page. Honest nothing-was-created state without env (e2e-pinned). |
| `/portal/admin/security` (admin-only) | The `audit_events` ledger paginated (50/page): when / actor (resolved name+role, "system / service" for service-role writes) / action badge / target / detail JSON / IP, with an exact-action filter. |
| Dispatcher least-privilege | Query-level scoping via `src/lib/staff-scope.ts`: dispatchers see **only assigned carriers'** loads (board + dashboard), carriers lists, document review queue, insurance/unsigned queues — plus their own + **unassigned** leads in the CRM (someone must work the new-lead queue; documented judgment), with lead-detail deep links 404ing on foreign assigned leads. Admins unrestricted. Dashboards show an explicit "scoped view" note. DB-level restrictive policies would require touching the frozen 0002 staff policies or constraining admins — the audit's "where feasible" call lands query-level, with every staff mutation journaled in `audit_events` regardless. |

## DB changes

`0012_staff_invites.sql`: `staff_invites` (role CHECK admin/dispatcher,
unique `token_hash`, expiry, `accepted_at`, lower(email) index), RLS enabled —
**staff read only; all writes via service role** inside admin-gated actions.
Validated on local PG16 (M-01 shim): table/RLS assertions, non-staff blocked
from read AND insert, plus a fresh-database run of the full 0001–0012 + seed
chain under `ON_ERROR_STOP=1`.

> Numbering note: the directive sketch called this migration 0010; 0010/0011
> were consumed by M-55 (carrier preference/dispatcher columns) and M-56
> (quote fields), so staff invites land as 0012.

## Files

Actions `src/app/actions/staff.ts` · validation `src/lib/validation/staff.ts`
· scope `src/lib/staff-scope.ts` · emails `AccountStatusEmail` /
`StaffInviteEmail` · components `UserAdminForms.tsx` / `AcceptInviteForm.tsx`
· pages `admin/users`, `admin/security`, `(auth)/invite/[token]` · sidebar
Users/Security entries (admin-only) · dispatcher scoping in `admin/page`,
`admin/loads/page`, `admin/leads/page`, `admin/leads/[id]/page`.

## Tests / gates

+7 unit (`staff.test.ts`: suspend-needs-reason, staff-only invite roles,
token shape, password bounds, unassign, page clamp) → **131 unit**; +2 e2e
(invite page honest no-env state, malformed token 404) → **19 e2e**. Admin
surface stays English (scope decision). No new env vars; apply 0012 with
`supabase db push`.

## Extension points

- MFA for staff (audit §6.1) remains the deliberate next security module —
  invites/status changes are journaled ready for AAL2 gating.
- `staff_invites` shape is the template for customer team invites (M-57 doc).
- Security log filter can grow prefix search (`action like`) without schema
  changes.
