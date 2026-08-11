# PickLoads tracking documentation

`docs/DIRECTIVE-tracking.md` §29 names eighteen documents. This directory is
those eighteen, one file each, plus this index. They are written for the
person who has to operate, extend or repair the tracking system — not for the
person who built it — so each one starts with what the thing IS before it
explains how it works.

The eighteen are checked by `tests/unit/section-29-docs.test.ts`: the file
must exist, must be non-trivial, and must open with the H1 the index names.
A document deleted or emptied fails the unit lane. That check does not read
the prose, so it cannot tell you the words are still true; it can tell you
nobody quietly removed one.

| # | §29 name | File |
|---|---|---|
| 1 | shipment architecture | [`architecture.md`](architecture.md) |
| 2 | shipment status model | [`status-model.md`](status-model.md) |
| 3 | event visibility model | [`event-visibility.md`](event-visibility.md) |
| 4 | tracking-number rules | [`tracking-numbers.md`](tracking-numbers.md) |
| 5 | public tracking security | [`public-tracking-security.md`](public-tracking-security.md) |
| 6 | shipper tracking portal | [`shipper-portal.md`](shipper-portal.md) |
| 7 | carrier update workflow | [`carrier-workflow.md`](carrier-workflow.md) |
| 8 | dispatcher workflow | [`dispatcher-workflow.md`](dispatcher-workflow.md) |
| 9 | document permissions | [`document-permissions.md`](document-permissions.md) |
| 10 | notification architecture | [`notifications.md`](notifications.md) |
| 11 | ETA architecture | [`eta.md`](eta.md) |
| 12 | tracking-provider adapter interface | [`provider-adapters.md`](provider-adapters.md) |
| 13 | RLS policies | [`rls.md`](rls.md) |
| 14 | migrations | [`migrations.md`](migrations.md) |
| 15 | responsive behavior | [`responsive.md`](responsive.md) |
| 16 | testing | [`testing.md`](testing.md) |
| 17 | launch procedure | [`launch.md`](launch.md) |
| 18 | troubleshooting | [`troubleshooting.md`](troubleshooting.md) |

## Where the other authorities live

- `docs/DIRECTIVE-tracking.md` — the specification these implement.
- `docs/FINAL-IMPLEMENTATION-PLAN.md` — the module plan and its decisions.
- `docs/modules/M-70…M-84*.md` — what each module built, and why.
- `docs/LAUNCH-RUNBOOK.md` — the operational runbook, of which §17 here is the
  tracking chapter.
- `docs/TRACKING-ACCEPTANCE.md` — §31's nineteen acceptance criteria, walked.

## The two rules that shape all of it

**Nothing customer-facing is invented.** §30 forbids fake GPS positions, fake
ETAs, fabricated shipments and the phrase "live tracking" while updates are
manual. Every provider adapter in the repo refuses to fetch (there is no
telematics contract yet) rather than returning a plausible position; every ETA
carries the source that produced it; the sample data on the marketing site is
labelled as sample data. Where a document below describes something as not yet
live, that is the honest state and not an oversight.

**Money never crosses an audience boundary.** `gross_shipper_amount`,
`carrier_pay` and `margin` are revoked from the browser roles at the column
level (migration 0030) and handed back, one audience at a time, through a
`security definer` accessor. The DTO serializers build payloads from explicit
allow-lists and never by spreading a row. Both halves are tested, and both
tests are proved capable of failing.
