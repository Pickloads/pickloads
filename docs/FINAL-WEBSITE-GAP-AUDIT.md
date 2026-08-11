# Final website — gap audit

**Baseline:** `m84b-certified` (`2315386`) · **Branch:**
`final-website-production` · **Date:** 2026-08-11

Compares five sources: **(A)** the certified application on disk, **(B)** the
approved V4 HTML reference (`reference/pickloadssitev4.html`, vendored
byte-identical from the workspace original), **(C)** the cahier des charges,
**(D)** `docs/DIRECTIVE-business-website.md`, **(E)** the final website
production directive.

**Legend:** ✅ COMPLETE · 🟡 EXISTS — NEEDS POLISH · 🟠 PARTIAL · ❌ MISSING ·
🔒 LEGAL GATED · ⚙️ EXTERNAL CONFIG REQUIRED

---

## 0 · Headline

The platform is further along than a "final website phase" usually starts from.
**16 public routes exist**, the design system is real and already shared with
the portal, all five locales are wired, and the certified test lanes cover the
public surface at 12 breakpoints and WCAG 2.2 AA.

What is missing is not *quality* on what exists — it is **seven destinations
that were always scheduled for M-85…M-101 and have never been built**, plus
four platform-level features (theme, PWA, search, booking).

| | Count |
|---|---|
| ✅ Complete | 12 |
| 🟡 Exists, needs polish | 9 |
| 🟠 Partial | 6 |
| ❌ Missing | 11 |
| 🔒 Legal-gated (cannot be completed by engineering) | 3 |
| ⚙️ External config required | 5 |

**No STOP condition found.** No destructive migration, no auth redesign, no RLS
regression, no brokerage-gate conflict, no data-loss risk, no need to expose
sensitive data. One specification contradiction, minor, recorded in §5.

---

## 1 · Primary destinations

| Destination | Status | Evidence / what remains |
|---|---|---|
| **Home** | 🟡 | `(site)/page.tsx` renders the full V4 section order: Hero, ServicesSplit, QuickQuote, EquipmentGrid, Pricing, Testimonials (gated), Compliance, NewAuthority, WhyStats, Industries, HowAndCompare, BoardsStrip, LoadTicker, Packet, ShippersTeaser, CtaBand. **Needs**: the dual-path audience split (§11) is implied by `ServicesSplit` but not stated as "what can PickLoads do for you"; hero messaging to be confirmed against §10 |
| **Dispatch Services** | 🟠 | `/truck-dispatch` + `/truck-dispatch/[state]` (6 state pages) + `/dispatch/[equipment]` exist and are strong SEO surfaces. **There is no single "Dispatch Services" conversion page** of the kind §12 describes — the offering is spread across equipment and state pages |
| **Freight Brokerage** | 🟡 🔒 | `/shippers` is the brokerage page. Correctly gated: pre-brokerage honest state, no false authority claim. **Needs** polish to §14's structure; must not be "activated" by copy |
| **New Authority Program** | ✅ | `/start-your-trucking-company` — filing-assistance framing, "not a law firm" disclaimer present and correct (§16, §W) |
| **Track Shipment** | ✅ | `/track` — certified M-73. Two-factor lookup, enumeration protection, access ledger, rate limit, Turnstile, strict public DTO. **Do not touch** beyond visual integration |
| **About** | 🟡 | `/about` exists. **Needs** §21's mission/vision treatment and a check that no fabricated history creeps in |
| **Contact** | 🟡 | `/contact` exists with a form. **Needs** §33's contact categories (dispatch / freight / carrier / new authority / partnership / support / general) |

## 2 · Conversion surfaces

| Surface | Status | Notes |
|---|---|---|
| **Request a Quote (page)** | ✅ **DELIVERED** | `/request-a-quote`, live in all five locales. Renders the SAME `FreightQuoteForm` and `submitFreightQuote` action as `/shippers` — one quote system, not two. Funnel instrumented (`quote_view` / `quote_started` / `quote_submitted` / `quote_failed`). Registered in `PUBLIC_ROUTES`, so it is in the sitemap with hreflang. 8 dedicated e2e tests + 12-breakpoint responsive + axe. **It also fixed a live mis-targeting**: the primary CTA pointed at `/#quote`, the home page's *carrier* setup form |
| **Become a Carrier** | 🟡 | `/become-a-carrier` exists and feeds `/create-account/carrier`. **Needs** §17's documentation/expectations detail |
| **Get Dispatch / Start Dispatching** | 🟠 | CTAs exist across equipment pages; no single owned funnel entry |
| **Book a Consultation** | ❌ ⚙️ | No booking surface. Requires an approved Calendly (or equivalent) URL |
| **Newsletter** | ✅ | Capture + double opt-in confirm + unsubscribe token (M-69). Does **not** silently subscribe quote/contact users — verified |

## 3 · Resources

| Surface | Status | Notes |
|---|---|---|
| **FAQ** | 🟡 | `/faq` exists as a static accordion. `FINAL-IMPLEMENTATION-PLAN` notes it is a TS array, unreachable by search → **M-98** would move it to a table |
| **Knowledge Base** | ❌ | Never built. Scheduled **M-90** |
| **Downloads Center** | ❌ | Never built. Scheduled **M-92**. The gate already exists: `company_settings.packet_downloads_live` |
| **Blog / Company News** | 🟠 | `/blog` + `/blog/[slug]` with a full staff editor, publish workflow, Article JSON-LD, ISR. **`posts.category` is a bare text column** — rendered but not indexed, filterable or routable → **M-91** |
| **Support Center (public)** | ❌ | Authenticated support threads exist (`/portal/*/support`, staff inbox). **No public/guest surface** → **M-89** |

## 4 · Company

| Surface | Status | Notes |
|---|---|---|
| **Careers** | ❌ | Never built → **M-93**. Must show an honest "no open roles" state rather than invented listings |
| **Partner Program** | ❌ | Never built → **M-94** |
| **Referral Program** | ❌ | Never built → **M-95**. `company_settings.referral_program_active` already exists and is **false**; no dollar amounts may be advertised |
| **Customer testimonials** | 🟠 | `TestimonialsSection` is built and **correctly gated** on `testimonials_visible` (false) — it renders nothing rather than fake praise. Needs the approval workflow/ratings of **M-87** |
| **Carrier reviews** | ✅ | Correctly **absent** from all public surfaces. §25/§C require they stay internal → **M-88** |

## 5 · Authentication & portal transition

| Surface | Status | Notes |
|---|---|---|
| **Login Center** | 🟠 | `/portal` is a two-door chooser (carrier / shipper) and `/login` is role-routed server-side. §38 asks for four explicit pathways incl. **dispatcher and admin**, plus broker partner |
| **Role routing** | ✅ | Server-enforced (M-54). Roles are never client-assignable — proved by unit tests and a DB trigger |
| **Portal visual continuity** | 🟡 | Portal already reuses the V4 vocabulary and the dark-surface overrides added in M-74 |

> **Specification contradiction (minor, recorded per §71).** §38 asks for
> visible **Dispatcher Login** and **Admin Login** pathways. §7 says *"do not
> expose internal-only surfaces through public navigation."* Staff sign in
> through the same `/login` with server-side role routing, so separate public
> doors would advertise the existence of staff surfaces for no functional gain.
> **Recommendation:** build the Login Center with customer-facing doors
> (shipper, carrier, broker partner) and a single low-emphasis "Staff sign-in"
> link to `/login`. This satisfies §38's intent without violating §7. Flagged
> rather than resolved unilaterally.

## 6 · Platform features

| Feature | Status | Notes |
|---|---|---|
| **Multi-language** | ✅ 🟡 | Five locales wired (`en`, `es`, `fr`, `ru`, `ht`) with `next-intl`, no hardcoded strings, 176 shipment keys × 5. **Note:** §43 names four public languages (EN/ES/FR/HT) and anticipates "an existing fifth locale" — that is `ru`. **Do not remove it**; it is fully populated |
| **SEO** | 🟡 | Sitemap with hreflang, robots, Article + Service JSON-LD, per-page metadata, `noindex` on private surfaces and on legal shells. **Needs** §44's full pass: breadcrumb schema, organization schema, OG/Twitter coverage audit, internal linking |
| **Responsive** | ✅ | 12 breakpoints, executed in Chromium |
| **Accessibility** | ✅ | WCAG 2.2 AA axe scans, executed |
| **Analytics** | 🟠 ⚙️ | GA4 consent-gated (fires only after consent). **No business-event taxonomy** (§52/§53) |
| **Theme (light/dark/system)** | ❌ | Not implemented. `FINAL-IMPLEMENTATION-PLAN` schedules the semantic-token layer as **M-101**, decision D-3 |
| **PWA** | ❌ | No manifest, no icons, no service worker → **M-99**. Must exclude shipment data from any offline shell |
| **Global search** | ❌ | Not implemented → **M-98**. Must respect RLS; must never become a bypass |
| **Google Reviews** | ❌ ⚙️ | No integration → **M-100**. Requires a real Google Business Profile |
| **Google Maps** | 🟠 ⚙️ | Embed key slot exists in `.env.example`; used on contact. Must never expose shipment coordinates |
| **Meeting booking** | ❌ ⚙️ | No provider configured |
| **Performance** | 🟡 | Next 15 defaults, ISR on blog, no measured Core Web Vitals baseline |

## 7 · Legal & compliance state 🔒

| Item | Status |
|---|---|
| Privacy Policy · Terms · Cookie Policy · Dispatch Agreement · Carrier Agreement | 🔒 shells, **no approved content** — `docs/LEGAL-DOCUMENTS-REQUIRED.md` |
| Broker-Carrier · Shipper-Broker agreements | 🔒 **no shell at all** |
| Broker-partner access agreement | 🔒 model built, text missing |
| New Authority disclaimers | ✅ present and correct |
| Document-upload authorisation language | ❌ absent |
| `brokerage_active` | ✅ **false**, fail-closed at the database. Must stay that way |
| Honest marketing | ✅ no fake reviews, loads, rates, counts, GPS, offices, awards or authority. MC/USDOT render as pending |

**Engineering cannot clear any 🔒 row.** They are counsel and licensing items.

## 8 · What must NOT be touched

Certified and load-bearing. Website work integrates with these; it does not
duplicate or modify them:

auth · authorization · RLS (806 assertions) · shipment domain · transitions ·
events · secure tracking · shipper portal · dispatcher operations · carrier
operations · driver updates · documents · POD · ETA · exceptions ·
notifications · map architecture · broker-partner architecture · responsive
infrastructure · accessibility infrastructure · integration lane · e2e lane ·
observability · retention · **the brokerage gate**.

---

## 9 · Honest scope statement

The eleven ❌ rows are not polish. They are **eleven of the seventeen modules
`FINAL-IMPLEMENTATION-PLAN` Phase D already scopes (M-85 → M-101)** — a build
cycle comparable to M-50…M-62, not an afternoon's work. Anyone reading "final
website phase" as "tidy up the existing pages" would be wrong by roughly a
quarter of engineering.

The plan in `docs/FINAL-WEBSITE-IMPLEMENTATION-PLAN.md` sequences them so that
each phase ships something verifiable, the certified lanes stay green
throughout, and nothing is built ahead of the legal or business fact it depends
on.
