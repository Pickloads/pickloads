"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  buildPublicTimeline,
  timelineTextEquivalent,
  type MilestoneState,
  type TimelineSubject,
} from "@/lib/shipments/public-timeline";
import { formatTrackingDateTime } from "@/components/tracking/format";

/**
 * M-73 — §8's progress timeline and §23's text equivalent, in one component.
 *
 * ── SEMANTIC MARKUP (§23) ─────────────────────────────────────────────────
 *
 * An ordered list. Not a row of divs, not a table, not an SVG: §8's milestones
 * ARE an ordered sequence, and `<ol>` is the element that says so to a screen
 * reader, to Reader Mode and to a stylesheet-less render. Every step carries
 * its own `<time datetime>`, so the timestamp is machine-readable as well as
 * localized.
 *
 * ── STATE IS TEXT, NOT COLOUR (§23) ───────────────────────────────────────
 *
 * Each step renders a VISIBLE word for its state — "Completed", "Current
 * step", "Not started", "Current step, needs attention". The green dot, the
 * amber dot and the red ring are a redundant second signal. Delete
 * `src/app/v4.css` and this timeline still tells you exactly where the truck
 * is, which is the only reliable test of "not colour alone".
 *
 * ── THE TEXT EQUIVALENT (§23, verbatim requirement) ───────────────────────
 *
 * "The visual tracking timeline must have a text equivalent for assistive
 * technologies." That is the `role="status"` paragraph: one sentence carrying
 * progress, the current step and its state. It is also the aria-live target —
 * when a visitor looks up a second shipment, the sentence changes and is
 * announced, instead of a screen reader silently re-rendering nine list items
 * or reading all of them aloud.
 *
 * `aria-hidden` is NOT used to hide the list from assistive technology: the
 * summary is an entry point, not a replacement. A screen-reader user who wants
 * the timestamps navigates the list exactly like everyone else.
 */

const STATE_CLASS: Record<MilestoneState, string> = {
  complete: "is-complete",
  current: "is-current",
  exception: "is-exception",
  upcoming: "is-upcoming",
};

const STATE_KEY: Record<MilestoneState, string> = {
  complete: "shipment.a11y.step_complete",
  current: "shipment.a11y.step_current",
  exception: "shipment.a11y.step_exception",
  upcoming: "shipment.a11y.step_upcoming",
};

/**
 * M-74: the prop is `TimelineSubject` (status + events + exceptions), not
 * `PublicTrackingDto`. `/track` passes its public DTO exactly as before; the
 * shipper portal passes `toShipperDto(...)`. One timeline, two audiences,
 * zero duplicated milestone logic — and the heading id below is derived from
 * `headingId` so two timelines can never collide on one page.
 */
export function TrackingTimeline({
  tracking,
  headingId = "track-progress-heading",
}: {
  tracking: TimelineSubject;
  headingId?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const timeline = buildPublicTimeline(tracking);
  const summary = timelineTextEquivalent(timeline);

  const summaryText = summary.cancelled
    ? t("shipment.a11y.timeline_summary_cancelled", {
        completed: summary.completed,
        total: summary.total,
      })
    : summary.currentKey === null
      ? t("shipment.a11y.timeline_summary_not_started")
      : t(
          summary.exception
            ? "shipment.a11y.timeline_summary_exception"
            : "shipment.a11y.timeline_summary",
          {
            completed: summary.completed,
            total: summary.total,
            current: t(summary.currentKey),
          },
        );

  return (
    <section className="track-section" aria-labelledby={headingId}>
      <h2 id={headingId}>{t("shipment.result.timeline_title")}</h2>

      {/* §23 text equivalent + the aria-live target for status changes. */}
      <p className="sr-only" role="status">
        {summaryText}
      </p>

      <ol className="track-timeline" aria-label={t("shipment.a11y.timeline_label")}>
        {timeline.steps.map((step) => (
          <li
            key={step.milestone}
            className={`track-step ${STATE_CLASS[step.state]}`}
          >
            <span className="lbl">{t(step.label_key)}</span>
            <span className="st">{t(STATE_KEY[step.state])}</span>
            {step.at === null ? null : (
              <time dateTime={step.at}>
                {formatTrackingDateTime(step.at, locale)}
              </time>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
