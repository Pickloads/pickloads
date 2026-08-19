import type { ReactNode } from "react";

/**
 * M-100 — the admin design-system primitives.
 *
 * ── WHY ONE FILE ─────────────────────────────────────────────────────────
 *
 * The brief lists fourteen candidate components and then says "do NOT
 * over-engineer". These are presentational shells over the `.a-*` vocabulary
 * in `portal.css`; splitting eleven of them into eleven files would add
 * imports and no clarity. They are exported individually, so a future split
 * costs nothing.
 *
 * ── WHAT THEY DO AND DO NOT DO ───────────────────────────────────────────
 *
 * They render. They hold no state, read nothing, decide nothing. Every value
 * arrives as a prop, already fetched and already decided by a page. That is
 * the boundary the brief draws around this whole task (§22), and it is what
 * lets the same markup be rendered into a jsdom harness and measured in a
 * real layout engine.
 *
 * ── THE ONE STRUCTURAL RULE WORTH KNOWING ────────────────────────────────
 *
 * `DetailRow` renders `<div class="drow"><dt/><dd/></div>` inside a `<dl>`.
 * The wrapper div is deliberate and is valid HTML5 (the spec permits a `div`
 * grouping `dt`/`dd` pairs inside a `dl`). It exists because the row must own
 * its divider: the old markup put `border-top` on the `dt` AND on the `dd`,
 * which are two boxes that `align-items:baseline` places at different Y — so
 * every row drew two rules a few pixels apart. One wrapper, one border.
 */

/* ── page ──────────────────────────────────────────────────────────────── */

export function AdminPage({ children }: { children: ReactNode }) {
  return <div className="a-page">{children}</div>;
}

export function AdminPageHeader({
  crumb,
  title,
  description,
  identifiers,
  badges,
  actions,
}: {
  crumb?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Record keys — USDOT, MC. Rendered monospace because they are machine
   *  identifiers, which is the only thing §15 reserves monospace for. */
  identifiers?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="a-head">
      <div className="a-head-main">
        {crumb ? <span className="a-crumb">{crumb}</span> : null}
        <h1>{title}</h1>
        {description ? <p className="a-desc">{description}</p> : null}
        {identifiers ? <div className="a-ids">{identifiers}</div> : null}
      </div>
      {badges || actions ? (
        <div className="a-head-side">
          {badges ? <div className="a-badges">{badges}</div> : null}
          {actions ? <div className="a-badges">{actions}</div> : null}
        </div>
      ) : null}
    </header>
  );
}

export function AdminGrid({ children }: { children: ReactNode }) {
  return <div className="a-grid">{children}</div>;
}

/** A column of the two-column grid. Cards inside it are evenly gapped, so no
 *  card needs a margin of its own — the source of "random margins". */
export function AdminColumn({ children }: { children: ReactNode }) {
  return <div className="a-col">{children}</div>;
}

export function AdminSection({
  title,
  children,
}: {
  title?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="a-section">
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

/* ── card ──────────────────────────────────────────────────────────────── */

export function AdminCard({
  title,
  actions,
  children,
  /** `flush` when the body is a DetailList or a table, which carry their own
   *  padding so their dividers can span the whole card. */
  flush = false,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="a-card">
      {title ? (
        <div className="a-card-head">
          <h2>{title}</h2>
          {actions ? <div className="a-head-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? "a-card-body is-flush" : "a-card-body"}>
        {children}
      </div>
    </section>
  );
}

/** A card whose body is entirely custom — used when a card must mix a flush
 *  list with a padded footer, which `AdminCard` cannot express. */
export function AdminCardShell({
  title,
  actions,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="a-card">
      {title ? (
        <div className="a-card-head">
          <h2>{title}</h2>
          {actions ? <div className="a-head-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/* ── detail list ───────────────────────────────────────────────────────── */

export function DetailList({ children }: { children: ReactNode }) {
  return <dl className="dlist">{children}</dl>;
}

export function DetailRow({
  label,
  children,
  /** Monospace + weight: this value is a record identifier, not prose. */
  id = false,
  muted = false,
  sub,
}: {
  label: ReactNode;
  children: ReactNode;
  id?: boolean;
  muted?: boolean;
  /** Second line: provenance, an expiry warning, a timestamp. */
  sub?: ReactNode;
}) {
  const cls = ["", id ? "is-id" : "", muted ? "is-muted" : ""]
    .filter(Boolean)
    .join(" ")
    .trim();
  return (
    <div className="drow">
      <dt>{label}</dt>
      <dd {...(cls ? { className: cls } : {})}>
        {children}
        {sub ? <span className="dsub">{sub}</span> : null}
      </dd>
    </div>
  );
}

/**
 * A labelled band separating groups of rows (§10: IDENTITY / AUTHORITY / …).
 *
 * It sits BETWEEN DetailLists rather than inside one. The first attempt put it
 * inside the `dl` as a bare `dt` alongside the `div`-wrapped pairs, and axe
 * rejected it (`definition-list`): HTML permits either bare `dt`/`dd` children
 * or `div`-grouped ones, not a mixture. Each group being its own `dl` is also
 * the truer structure — these are four short lists, not one long one.
 */
export function DetailGroup({ children }: { children: ReactNode }) {
  return <p className="dgroup">{children}</p>;
}

/* ── badge ─────────────────────────────────────────────────────────────── */

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

export function StatusBadge({
  tone = "neutral",
  children,
  dot = false,
}: {
  tone?: Tone;
  children: ReactNode;
  /** Decorative only — the label always states the meaning in words, so no
   *  status is carried by colour alone (§20). */
  dot?: boolean;
}) {
  return (
    <span className={`a-badge is-${tone}`}>
      {dot ? <span className="dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/* ── reason codes ──────────────────────────────────────────────────────── */

export function ReasonList({ children }: { children: ReactNode }) {
  return <ul className="a-reasons">{children}</ul>;
}

export function ReasonItem({
  text,
  code,
  finding = false,
}: {
  text: ReactNode;
  code: string;
  /** Marks the reason the file came to a human. Shown with a rule down the
   *  left edge AND ordered first — not colour alone. */
  finding?: boolean;
}) {
  return (
    <li {...(finding ? { className: "is-finding" } : {})}>
      <span className="r-text">{text}</span>
      <code className="a-code">{code}</code>
    </li>
  );
}

/* ── callout, note, state, actions, empty ──────────────────────────────── */

export function InfoCallout({
  children,
  inset = false,
}: {
  children: ReactNode;
  /** Padded away from a flush card body. */
  inset?: boolean;
}) {
  return (
    <aside className={inset ? "a-callout is-inset" : "a-callout"}>
      <span className="a-ico" aria-hidden="true">
        i
      </span>
      <p>{children}</p>
    </aside>
  );
}

export function ReviewNote({ children }: { children: ReactNode | null }) {
  if (children === null || children === undefined || children === "") {
    return <p className="a-note is-empty">No note was recorded.</p>;
  }
  return <p className="a-note">{children}</p>;
}

export function StateBlock({
  tone = "neutral",
  icon,
  title,
  children,
}: {
  tone?: Tone;
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`a-state is-${tone}`}>
      <span className="a-ico" aria-hidden="true">
        {icon}
      </span>
      <div className="a-state-body">
        <h3>{title}</h3>
        {children ? <p>{children}</p> : null}
      </div>
    </div>
  );
}

export function ActionBar({
  children,
  end = false,
}: {
  children: ReactNode;
  end?: boolean;
}) {
  return <div className={end ? "a-actions is-end" : "a-actions"}>{children}</div>;
}

export function EmptyState({
  title,
  children,
}: {
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="a-empty">
      <b>{title}</b>
      {children}
    </div>
  );
}

/* ── metrics ───────────────────────────────────────────────────────────── */

export function MetricGrid({
  children,
  compact = false,
}: {
  children: ReactNode;
  /** For rows of many small counts (a pipeline funnel) rather than headline
   *  figures. One modifier instead of per-tile inline sizing. */
  compact?: boolean;
}) {
  return (
    <div className={compact ? "a-metrics is-compact" : "a-metrics"}>
      {children}
    </div>
  );
}

export function MetricCard({
  value,
  label,
  sub,
  tone,
}: {
  value: ReactNode;
  label: ReactNode;
  sub?: ReactNode;
  tone?: "success" | "warning" | "danger" | "accent";
}) {
  return (
    <div className={tone ? `a-metric is-${tone}` : "a-metric"}>
      <span className="m-val">{value}</span>
      <span className="m-lbl">{label}</span>
      {sub ? <span className="m-sub">{sub}</span> : null}
    </div>
  );
}
