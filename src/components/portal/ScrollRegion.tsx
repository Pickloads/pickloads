import type { ReactNode } from "react";

/**
 * M-82 — a horizontally scrolling box that a keyboard can actually reach.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 *
 * `.ptable-wrap` and `.kanban` both carry `overflow-x:auto`. A mouse user
 * drags them; a touch user swipes them. A keyboard user can only scroll a box
 * that either **is** focusable or **contains** something focusable — and
 * several tracking regions contain neither:
 *
 *   * the tracking-provider adapter table (§9) — four rows of environment
 *     variable names, no links, 562px wide, so it scrolls at every phone
 *     width and its right-hand columns are unreachable;
 *   * the exception table (§21) — same shape;
 *   * the shipment summary, assignment history, contacts and update history
 *     tables, whenever their content happens to hold no link;
 *   * the whole `.kanban` strip when every column is empty or failed, which
 *     is precisely the state a dispatcher hits on a bad morning.
 *
 * axe reports this as `scrollable-region-focusable` (serious, WCAG 2.1.1).
 * Six modules of jsdom scanning could not see it: jsdom has no layout, so
 * nothing ever "scrolls" there and the rule never fires.
 *
 * ── THE FIX, AND WHY IT IS THIS ONE ───────────────────────────────────────
 *
 * M-59 hit the identical problem on the public site's `.flow` process strips
 * and solved it with `tabIndex={0} role="region" aria-label`. This is that
 * pattern, extracted so the eleven tracking call sites cannot drift apart.
 * `tabIndex` alone would satisfy axe but drop the keyboard user onto an
 * unnamed `div`; the labelled region is what makes the stop mean something.
 *
 * It is applied UNIFORMLY rather than only where a table happens to lack a
 * link today, because whether a region needs the affordance depends on both
 * the viewport and the row data — a rule that holds at 320px with one row
 * and breaks at 480px with another is not a rule anyone can maintain.
 */
export function ScrollRegion({
  label,
  className = "ptable-wrap",
  children,
  style,
}: {
  /** Names the stop. Usually the section heading this table sits under. */
  label: string;
  className?: string;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={className}
      role="region"
      aria-label={label}
      tabIndex={0}
      style={style}
    >
      {children}
    </div>
  );
}
