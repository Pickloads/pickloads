# M-90 — Internationalisation repair

**Status:** shipped · **Branch:** `final-website-production` · **Date:** 2026-08-13

---

## 1. What

The public site now renders in the locale the visitor selects. Before this
module, choosing French changed the URL, the `<html lang>` and roughly
three-quarters of the body copy — and left the navigation, the page title, the
process diagram, the carrier wizard, the 404, the cookie banner, both equipment
pickers and every `<meta>` description in English.

260 message keys were added, 1,040 translations authored across four locales,
and two test suites added that would have caught the defect on the day it was
introduced.

## 2. Why — the root cause

`useV4()` and `getV4()` bridge the V4 design dictionary to next-intl. Both end
in the same line (`src/i18n/v4.ts`):

```ts
return t.has(key) ? t(key) : en;
```

A string whose slug is not in `messages/en.json` falls back to the English
literal the component passed in. That is the correct behaviour — the
alternative is rendering `continue_to_documents` at a customer — but it is
**silent**. There is no console warning, no missing-message error, no build
failure, and no visual defect in the language the author speaks.

`scripts/extract-i18n.mjs` generates the catalogue from the vendored V4
prototype. Every string the application grew _after_ the last extractor run —
the whole navigation refactor, the carrier onboarding wizard, the auth screens,
the metadata — was therefore invisible to the catalogue and rendered English
forever, in all five locales.

**211 of the site's 843 literal `tv()` calls were in that state, plus the
entire `site-nav.ts` label set and all 33 page titles/descriptions.**

Three things made it survive review:

1. **It is invisible in English.** Every affected string renders perfectly at
   `/`. The bug only exists on the other four locales.
2. **The existing tests could not see it.** `i18n-coverage-ratchet.test.ts`
   compares `fr.json` against `en.json`. The missing strings were in _neither_
   file — you cannot measure a gap between two files when the thing you lost is
   in a third place, the source.
3. **The navigation case is worse than the rest.** `SiteNav` renders
   `tv(group.label)` where `group` comes from `src/lib/site-nav.ts`. The string
   and the `tv(` are in different files by design, so even a source scan for
   `tv("…")` finds none of the main menu.

### What was NOT wrong

Worth recording, because all four were suspected first and all four are fine:

- **Routing.** `localePrefix: "as-needed"`, the middleware matcher, the
  `[locale]` layout, `setRequestLocale`, `generateStaticParams` — correct.
  All 35 locale × representative-route combinations return 200 and preserve
  the requested locale.
- **The loader.** `src/i18n/request.ts` resolves the right catalogue per
  locale.
- **The language selector.** It preserves the pathname and sets the locale
  correctly, on desktop and at mobile widths (`.topbar` keeps `.langsel`
  visible below 700px; only `.tb-hide` links drop).
- **`fr.json` / `es.json`.** Both were, and remain, essentially complete.

The reported symptom — "the selector does not translate the site" — was real
and the diagnosis in the report was reasonable, but the selector was never the
component at fault.

## 3. How

### 3.1 `scripts/v4-key-audit.mjs` (new)

Reads the **application** and reports which strings it asks for that the
catalogue does not have. Additive only: `--write` can add a key to
`messages/en.json` and can do nothing else. It is deliberately not
`extract-i18n.mjs`, which regenerates from the prototype and would delete the
260 keys this module added.

Three classes of call site:

| Class              | Example                                | Why it needs its own collector          |
| ------------------ | -------------------------------------- | --------------------------------------- |
| Literals           | `tv("Continue to Documents →")`        | —                                       |
| Data-module labels | `tv(group.label)` from `site-nav.ts`   | The string is never adjacent to a `tv(` |
| Metadata           | `pageMetadata({ title, description })` | Since §3.3 these translate too          |

Deliberately **not** collected: the long-form bodies in
`src/content/{equipment,states,knowledge-base}.ts`. Those are the O-03 content
workstream (500–800 words × 14 pages); listing them would report a ~6,000
string "gap" that no code change can close and would drown the chrome gap that
one can. See §6.

### 3.2 Hard-coded strings

Seven surfaces rendered bare JSX text with no `tv()` at all:

- `ServicesSplit` — the entire nine-node process flow strip and its title.
  The translations already existed in the catalogue and had never been used.
- `Pricing` — two of three plan headings (`Owner-Operator`, `Box Truck & Hot
Shot`; the middle plan was already wrapped) and the pricing note.
- `CallFab` — the mobile call CTA, the loudest control below 700px.
- `LoadTicker` — the board's visible label and its accessible name.
- `Logo` — `aria-label="PickLoads — home"`.
- `LangSelect` — `aria-label="Language"`, i.e. the switcher announced itself
  in the one language the user was trying to leave.
- `BoardsStrip` — the "DIRECT BROKER NETWORK" channel label and the
  affiliation disclaimer. The three platform names (DAT ONE, TRUCKSTOP,
  123LOADBOARD) stay verbatim: they are third-party trademarks.

### 3.3 Metadata (`src/lib/seo.ts`)

`pageMetadata()` is now `async` and resolves `title` and `description` through
`getV4(locale)`. `canonical` and the hreflang set were already per-locale; the
two fields a search result and a shared link actually display were not. Every
locale emitted the English `<title>`, `<meta name="description">` and Open
Graph pair.

The bridge's English fallback is doing real work here: the equipment and state
pages pass long-form English `content.metaTitle` / `metaDescription`, which are
untranslated by design. They keep working and keep telling the truth.

Two call sites spread the result and needed an explicit `await` —
`search/page.tsx` and `knowledge-base/page.tsx`. **TypeScript did not catch
them**, because `Metadata` has no required properties, so spreading a Promise
into an object literal type-checks cleanly and silently produces `{}`.

## 4. Coverage

`v4` namespace, 1,029 keys (was 769). Missing keys: **0 in every locale.**

| Locale | Keys  | Missing | Byte-identical to English | Note                                                                                                                                 |
| ------ | ----- | ------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| en     | 1,029 | —       | —                         | source                                                                                                                               |
| fr     | 1,029 | 0       | 46                        | 42 are loanwords/proper nouns the site keeps in English on purpose (`Dry Van`, `Hot Shot`, `FAQ`, `Blog`, `PickLoads`, `VIN`, `EIN`) |
| es     | 1,029 | 0       | 33                        | same                                                                                                                                 |
| ht     | 1,029 | 0       | 540                       | 363 pre-existing + 177 · see §6                                                                                                      |
| ru     | 1,029 | 0       | 521                       | 363 pre-existing + 158 · see §6                                                                                                      |

The `shipment` namespace (411 strings) is unchanged by this module: es 2,
fr 7, ru 363, ht 363 untranslated, exactly the M-84 baseline.

Byte-equality over-counts — it cannot tell a deliberate loanword from a missed
string — which is why the ratchet baselines are measured ceilings rather than
zero. It never under-counts.

## 5. Tests

| Suite                                      | Tests | Proves                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/i18n-key-coverage.test.ts`     | 7     | Every `tv()` call site, nav label and metadata literal has a catalogue key. Catalogues carry the identical key set in the identical order, with no blank values. Includes a non-vacuity check on the collector and a slugifier-parity check against the runtime bridge.                                                                                                                                                    |
| `tests/e2e/i18n-locales.spec.ts`           | 47    | 35 locale × route combinations return 200 and keep their locale; `/en` redirects rather than 404s; FR/ES/HT/RU render specific translated nav, hero and chrome; the English string is _absent_ where a translation exists; the selector preserves the route in both directions and raises no hydration error; title/description/OG are localized; hreflang is exact on all five locales; the sitemap carries every locale. |
| `tests/unit/i18n-coverage-ratchet.test.ts` | 11    | Unchanged mechanism; baselines raised with the accounting in §6.                                                                                                                                                                                                                                                                                                                                                           |

The unit suite closes the source side; the e2e suite closes the rendered side.
Both are needed — the defect was invisible to catalogue-vs-catalogue checks by
construction.

Two candidate e2e assertions were **removed rather than forced**, and the
reason is in the spec:

- `new_authority_program` on `/fr` — the French copy deliberately keeps the
  programme's proper name in English inside a French sentence. The English
  phrase is legitimately on the page.
- `how_can_we_help` on `/contact` — it is a `placeholder` attribute. It _is_
  translated; a body-text assertion cannot see it.

## 6. Translations needing native review

Every key below is **live in English on the Russian and Haitian Creole sites**.
Nothing here is machine-translated into those two languages, because all of it
is legal, regulatory, pricing or agreement-adjacent — the category
`docs/COWORK-CONTENT-REVIEW.md` §3 reserves for a human translator. Machine
-translating an ESIGN consent into Haitian Creole to make a number in a test
file go down is not a trade this repo makes.

**55 keys, ht + ru.** Grouped by what a reviewer needs to be qualified in:

_Dispatch agreement & e-signature (12)_ — `a_signed_dispatch_agreement`,
`after_you_create_your_account_in_the_next_step_the_dispa`,
`dispatch_agreement_e_signature`, `e_signature_activating_shortly`,
`e_signature_via_dropbox_sign`,
`i_agree_to_receive_and_sign_documents_electronically_esi`,
`our_dispatch_agreement_is_completing_legal_review_nothin`,
`plain_english_dispatch_agreement_e_signed`,
`we_ll_email_your_dispatch_agreement_for_e_signature_as_s`,
`you_sign_the_agreement`,
`your_dispatch_agreement_is_on_its_way_to_your_inbox_for`,
`carrier_agreement`

_FMCSA / authority / filing (13)_ — `bmc_84_surety_bond_75k`,
`brokerage_operations_open_with_our_mc_activation`,
`brokerage_operations_open_with_our_mc_activation_early_r`,
`fmcsa_vetting_21_days`, `llc_filed_need_mc_usdot`,
`llc_formation_in_your_home_state_and_ein_registration_wi`,
`mc_filed_waiting_on_fmcsa`, `mc_letter_coi_w_9_voided_check`,
`mc_pending_usdot_pending`,
`mc_usdot_filing_with_the_fmcsa_boc_3_process_agent_desig`,
`new_authority_program`, `pending_fmcsa_filing`, `your_operating_authority`

_Pricing & contract terms (7)_ — `fees_are_the_percentage_agreed_in_your_dispatch_agreemen`,
`month_to_month_terms_in_plain_english_no_exclusivity_no`,
`no_forced_dispatch`, `percentages_apply_to_load_gross_month_to_month_cancel_an`,
`state_filing_fees_fmcsa_fees_and_insurance_premiums_are`,
`terms_are_agreed_case_by_case`,
`how_much_does_dispatch_cost_is_it_forced_dispatch_how_do`

_Legal notices & privacy (11)_ — `cookie_consent`, `cookie_policy`,
`files_are_stored_in_a_private_encrypted_bucket_and_revie`,
`final_documents_are_in_legal_review_email_support_picklo`,
`for_legal_questions_about_your_business_structure_consul`,
`platform_names_are_the_property_of_their_respective_owne`,
`privacy_policy`, `service_disclaimer`,
`shipment_and_account_documents_are_private_to_your_compa`,
`terms_of_service`,
`we_use_one_analytics_cookie_to_understand_site_traffic_n`

_Operational claims (5)_ — `authority_activates_and_you_roll_straight_into_our_carri`,
`in_process`, `on_request`,
`updates_are_entered_by_our_dispatch_team_as_milestones_a`,
`we_act_as_your_back_office_finding_freight_negotiating_r`

_Insurance (1)_ — `insurance_guidance_before_you_overpay_1m_auto_liability`

_Page metadata for the above surfaces (6)_ —
`dispatch_under_your_own_authority_load_booking_and_rate`,
`full_truckload_and_partial_freight_with_vetted_carriers`,
`llc_ein_mc_usdot_filing_boc_3_ucr_and_insurance_guidance`,
`onboard_with_pickloads_in_about_10_minutes_company_info`,
`start_your_trucking_company_new_authority_program_picklo`,
`tell_us_about_your_shipment_pickup_delivery_dates_and_eq`

The FR and ES versions of these same 55 strings **were** authored, following
the doctrine already established for the existing 769 keys (whose
legal-adjacent entries are translated in fr/es). They are new copy in a
regulated domain and should go into the same review pass, at lower priority
than the ht/ru gap.

### Still outstanding, and not touched here

- **`shipment` namespace, ru + ht: 363 of 411 untranslated.** The M-84 gap,
  unchanged. Tracked in `docs/TRACKING-ACCEPTANCE.md`.
- **Long-form page bodies (O-03).** `src/content/equipment.ts` (8 pages),
  `states.ts` (6 pages) and `knowledge-base.ts` are English-only prose,
  500–800 words each, rendered through `tv()` and falling back honestly. The
  _chrome_ around them translates; the article does not. This is a translation
  project, not a defect.
- **`AcceptInviteForm` / `AcceptBrokerInviteForm`.** Documented English-by-scope
  at M-58 (staff and partner invites). Left as-is: changing that scope is an
  owner decision, not a bug fix. Flagged here so it is a choice on the record
  rather than an oversight.

## 7. Files changed

**New**

- `scripts/v4-key-audit.mjs`
- `tests/unit/i18n-key-coverage.test.ts`
- `tests/e2e/i18n-locales.spec.ts`
- `docs/modules/M-90-i18n-repair.md`

**Catalogues** — `messages/{en,fr,es,ht,ru}.json` (+260 keys each, purely
additive: 0 keys removed, 0 existing values changed)

**Source**

- `src/lib/seo.ts` — `pageMetadata()` localizes title/description
- `src/app/[locale]/(site)/search/page.tsx`, `…/knowledge-base/page.tsx` —
  `await` the now-async `pageMetadata`
- `src/components/sections/{ServicesSplit,Pricing,LoadTicker,BoardsStrip}.tsx`
- `src/components/layout/{CallFab,LangSelect}.tsx`
- `src/components/ui/Logo.tsx`

**Tests** — `tests/unit/i18n-coverage-ratchet.test.ts` (baselines raised, with
the accounting inline)

## 8. Extension points

- **Adding a user-facing string:** write `tv("Your string")`, run
  `node scripts/v4-key-audit.mjs --write`, then translate the new key in the
  four locale files. `tests/unit/i18n-key-coverage.test.ts` fails until the key
  exists; `i18n-coverage-ratchet.test.ts` fails if you leave it English.
- **Adding a locale:** `routing.locales` + a `CATALOGUES` entry in
  `src/i18n/request.ts` (typed — a missing entry is a compile error) + the
  locale file. The hreflang map, sitemap and selector derive from `routing`.
- **Adding a page:** pass English literals to `pageMetadata`; they become
  catalogue keys through the same audit.
- **Translating the ht/ru queue:** work §6 top-down, lower the `v4` baselines
  in the ratchet test, and say so in the commit.

## 9. Deployment

No schema change, no new environment variable, no Vercel/Cloudflare/Supabase
configuration change. Message catalogues are bundled at build time, so the fix
ships with the next deploy and nothing needs to be invalidated by hand.
