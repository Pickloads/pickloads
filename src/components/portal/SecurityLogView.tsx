import { Link } from "@/i18n/navigation";
import {
  AdminCardShell,
  AdminPage,
  AdminPageHeader,
  EmptyState,
  StatusBadge,
} from "@/components/portal/admin-ui";
import { ScrollRegion } from "@/components/portal/ScrollRegion";
import {
  formatAuditEvent,
  redactedDetailJson,
  type AuditActor,
  type AuditEventRow,
} from "@/lib/audit/format";

/**
 * M-101 — the security log, read as operations rather than as a database.
 *
 * ── WHAT CHANGED ─────────────────────────────────────────────────────────
 *
 * The DETAIL column was `JSON.stringify(event.detail)`. An administrator had
 * to decode `{"risk_tier":"manual_review"}` to learn that a carrier needs
 * review, and every action wore the same amber badge, so nothing stood out.
 *
 * Now each row leads with what happened, in a sentence. The metadata is not
 * gone — it moved one keystroke away, into a native `<details>` disclosure,
 * which is why this needs no client JavaScript and gets keyboard operation and
 * `aria-expanded` from the platform rather than from an ARIA re-implementation.
 *
 * ── WHAT DID NOT CHANGE ──────────────────────────────────────────────────
 *
 * Nothing about the ledger. No action constant renamed, no `detail` key
 * rewritten, nothing dropped from storage. `formatAuditEvent` is pure and the
 * row it reads is the row that was written. See `src/lib/audit/format.ts` for
 * why the allowlist is the security-relevant half of this.
 */

export interface SecurityLogViewProps {
  events: readonly AuditEventRow[];
  actors: readonly AuditActor[];
  total: number;
  page: number;
  totalPages: number;
  filter: string;
  /** Raw actions the filter resolved to, so the page can say what it matched. */
  resolved: readonly string[];
  pageHref: (p: number) => string;
}

export function SecurityLogView({
  events,
  actors,
  total,
  page,
  totalPages,
  filter,
  resolved,
  pageHref,
}: SecurityLogViewProps) {
  const actorOf = (id: string | null) =>
    id === null ? null : (actors.find((a) => a.id === id) ?? null);

  return (
    <AdminPage>
      <AdminPageHeader
        crumb="Dispatch desk / Security"
        title="Security log"
        description="Every signup, account change, staff action and automated check, newest first. Each entry can be opened for the exact metadata that was recorded."
        badges={
          <StatusBadge tone="neutral">
            {total} event{total === 1 ? "" : "s"}
          </StatusBadge>
        }
      />

      <form method="get" className="kfilters">
        <div className="field">
          <label htmlFor="af-action">Action</label>
          <input
            id="af-action"
            name="action"
            type="text"
            defaultValue={filter}
            placeholder="e.g. MFA enabled, or staff.mfa_enrolled"
            aria-describedby="af-action-hint"
          />
        </div>
        <button className="btn btn-ghost btn-sm" type="submit">
          Filter
        </button>
        {filter ? (
          <Link className="btn btn-ghost btn-sm" href="/portal/admin/security">
            Clear
          </Link>
        ) : null}
      </form>
      <p id="af-action-hint" className="a-hint">
        Search by what you read in the table (&ldquo;MFA enabled&rdquo;) or by
        the stored constant (<code className="a-code">staff.mfa_enrolled</code>).
        {resolved.length > 1 ? (
          <>
            {" "}
            Matching {resolved.length} event types.
          </>
        ) : null}
      </p>

      <AdminCardShell title="Activity">
        {events.length === 0 ? (
          <EmptyState
            title={filter ? "No events match this filter" : "No audit events yet"}
          >
            {filter
              ? "Try a broader term, or clear the filter."
              : "Signups, account changes and staff actions land here."}
          </EmptyState>
        ) : (
          <ScrollRegion label="Security log">
            <table className="ptable slog">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">What happened</th>
                  <th scope="col">Origin</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const f = formatAuditEvent(e, actorOf(e.actor_id));
                  const raw = redactedDetailJson(e.detail);
                  const when = new Date(e.created_at);
                  return (
                    <tr key={e.id}>
                      <td className="stacked nw">
                        {when.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                        <span className="tsub">
                          {when.toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      </td>

                      <td className="stacked wrap">
                        {f.actorLabel}
                        <span className="slog-note">{f.actorSub}</span>
                      </td>

                      <td className="stacked">
                        <StatusBadge tone={f.tone}>{f.actionLabel}</StatusBadge>
                      </td>

                      <td className="stacked wrap">
                        {f.targetLabel}
                        {f.targetRef ? (
                          <span className="tsub">{f.targetRef}</span>
                        ) : null}
                      </td>

                      <td className="stacked wrap is-wide">
                        <span className="slog-summary">{f.summary}</span>
                        {f.secondary ? (
                          <span className="slog-note">{f.secondary}</span>
                        ) : null}

                        {f.technical.length > 0 || raw !== null ? (
                          <details className="a-disclosure">
                            <summary>Details</summary>
                            <div className="a-disclosure-body">
                              <dl className="slog-tech">
                                <div>
                                  <dt>Event</dt>
                                  <dd>
                                    <code className="a-code">{f.actionRaw}</code>
                                  </dd>
                                </div>
                                <div>
                                  <dt>Recorded</dt>
                                  <dd>{when.toLocaleString("en-US")}</dd>
                                </div>
                                {e.target_id ? (
                                  <div>
                                    <dt>Target ID</dt>
                                    <dd>
                                      <code className="a-code">
                                        {e.target_id}
                                      </code>
                                    </dd>
                                  </div>
                                ) : null}
                                {f.technical.map((t) => (
                                  <div key={t.label}>
                                    <dt>{t.label}</dt>
                                    <dd
                                      {...(t.redacted
                                        ? { className: "is-redacted" }
                                        : {})}
                                    >
                                      {t.value}
                                    </dd>
                                  </div>
                                ))}
                              </dl>

                              {f.hasRedactions ? (
                                <p className="a-hint">
                                  One or more fields were withheld because their
                                  name matched a sensitive pattern. The stored
                                  record is unchanged.
                                </p>
                              ) : null}

                              {raw !== null ? (
                                <details className="a-disclosure is-nested">
                                  <summary>View raw event data</summary>
                                  <pre className="slog-raw">{raw}</pre>
                                </details>
                              ) : null}
                            </div>
                          </details>
                        ) : null}
                      </td>

                      <td className="stacked nw">
                        {f.ipLabel}
                        {f.ipSub ? (
                          <span className="tsub">{f.ipSub}</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </AdminCardShell>

      {totalPages > 1 ? (
        <p className="ppager">
          {page > 1 ? (
            <Link className="btn btn-ghost btn-sm" href={pageHref(page - 1)}>
              ← Prev
            </Link>
          ) : null}
          <span className="pcount">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link className="btn btn-ghost btn-sm" href={pageHref(page + 1)}>
              Next →
            </Link>
          ) : null}
        </p>
      ) : null}
    </AdminPage>
  );
}
