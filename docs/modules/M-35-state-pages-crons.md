# M-35 — State pages + daily crons (O-01)

**Status:** ✅ Complete · **Phase:** 3 · **Date:** 2026-08-04

## What was built

### `/truck-dispatch/[state]` — 6 priority state pages
`src/content/states.ts` — typed content module (same pattern/rationale as
M-16 equipment): **original, unique 500–800-word content per state**, no
boilerplate swaps. Each page carries state-specific substance:

- **New Jersey (ST-01)** — home-market page: Port Newark–Elizabeth, Exit 8A
  warehouse belt, NYC-metro toll math, TWIC/port access, inbound-heavy
  reload strategy.
- **New York (ST-02)** — borough delivery reality (banned parkways, low
  bridges, congestion toll), **NY HUT certificate/decals requirement**,
  upstate I-90 lanes, metro-premium economics.
- **Florida (ST-03)** — inbound-state honesty: produce calendar (Nov–Jun,
  Apr–Jun peak), ports/transloads, I-4 corridor, hurricane-season surges,
  round-trip pricing.
- **Georgia (ST-04)** — Atlanta hub depth, **Port of Savannah / Garden City
  transload economy**, Gainesville poultry reefer, Dalton flooring,
  GA↔FL triangle.
- **Texas (ST-05)** — DFW–Houston–SA triangle valued per day, **Laredo
  border relay**, RGV produce, Permian energy flatbed, **TxDMV intrastate
  authority nuance**.
- **Illinois (ST-06)** — Chicago rail-intermodal engine, Joliet/Elwood
  (CenterPoint) belt, UIIA note, I-PASS, winter-premium dispatch doctrine.

Rates are labeled 2026 spot **estimates** ("estimates, not promises") in the
same mono ratesNote style as equipment pages. Template = the M-16 vocabulary
(PageHero → about-grid story + .svc requirements → .flow lanes → light FAQ →
CtaBand), **Service JSON-LD with `areaServed: {"@type":"State"}`**,
`generateStaticParams` × 5 locales, `dynamicParams=false`.

### `/truck-dispatch` index
Six `.eq-card` links + honest "more states monthly / we dispatch all 48 —
call us" note. Added to `PUBLIC_ROUTES`; index + 6 states × 5 locales are in
the sitemap with hreflang alternates. Footer's existing "Dispatch by State"
links now resolve (they pointed at these routes since M-12). Footer's
"Shipper Login" coming-soon toast replaced with a real `/login` link (M-32
follow-through).

### `/api/cron/daily` (O-01)
Guarded by `CRON_SECRET` — Vercel Cron sends `Authorization: Bearer
<CRON_SECRET>` automatically; comparison is `timingSafeEqual`; unset secret
→ 503 no-op, wrong secret → 401. Admin client (a cron has no user session;
needs auth-email lookups). Two tasks:

1. **Insurance expiring ≤30d** (active carriers): carrier-facing email
   (`InsuranceExpiryEmail`, escalating copy) at the **30/14/7/3/1/0-day
   thresholds only** — a daily nag trains carriers to ignore it — plus one
   staff digest listing the whole window every run.
2. **Callbacks due today** (open leads, `callback_at < end of today`
   including overdue): one digest per assigned dispatcher (auth email
   lookup), unassigned bucket → internal inbox.

All sends go through `sendEmail` → `email_log`, so cron activity appears in
the M-34 Notifications feed. Returns a JSON run summary.

### `vercel.json`
`{"crons":[{"path":"/api/cron/daily","schedule":"0 11 * * *"}]}` — 11:00
UTC = 7am ET, before the dispatch day starts.

## Vercel Cron setup (deployment)
1. Set `CRON_SECRET` (any strong random string) in the Vercel project env.
2. Deploy — vercel.json registers the schedule automatically (Hobby allows
   daily crons; Pro for more).
3. Verify: Vercel → Project → Settings → Cron Jobs shows the job; trigger a
   test run and check the JSON response + email_log rows.
4. Local test: `curl -H "Authorization: Bearer $CRON_SECRET" \
   http://localhost:3000/api/cron/daily`.

## Judgment calls
- Day boundaries are **UTC**; with the 7am-ET run time, "today (UTC)"
  aligns with the ET working day closely enough for digests. A TZ-aware
  version is a two-line change if it ever bites.
- Callback digest includes **overdue** callbacks (anything unresolved
  before today), flagged OVERDUE — a due-today-only filter would silently
  bury missed ones.
- Threshold alerting (30/14/7/3/1/0) instead of daily carrier emails;
  staff digest stays daily because staff asked the dashboard for it (M-24).

## DB changes
None.

## Endpoints
`GET /api/cron/daily` (CRON_SECRET-guarded).

## Env vars
`CRON_SECRET` (added to `.env.example`).

## Verification
typecheck ✓ · lint ✓ · build ✓ — 212 static pages (35 new: 7 routes × 5
locales), /api/cron/daily present, portal still excluded from prerender ✓
