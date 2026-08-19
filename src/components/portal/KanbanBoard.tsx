"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, Link } from "@/i18n/navigation";
import { updateLeadStatus, type LeadStatusValue } from "@/app/actions/crm";
import {
  leadAge,
  leadEquipment,
  leadSourceLabel,
} from "@/lib/leads/presentation";
import type {
  LeadStatus,
  LeadType,
  PriorityLevel,
} from "@/lib/supabase/database.types";

/**
 * M-23 Kanban — 9 pipeline columns, native HTML5 drag & drop, optimistic
 * status moves via the `updateLeadStatus` server action (journaling is
 * automatic in the DB trigger). Failed moves revert and surface the error.
 */

export interface KanbanLead {
  id: string;
  full_name: string | null;
  phone: string;
  truck_type: string | null;
  trailer_type: string | null;
  lead_type: LeadType;
  source: string;
  status: LeadStatus;
  priority: PriorityLevel;
  tags: string[];
  assigned_to: string | null;
  callback_at: string | null;
  created_at: string;
}

export interface StaffOption {
  id: string;
  name: string;
}

const COLUMNS: ReadonlyArray<{ status: LeadStatusValue; label: string }> = [
  { status: "new", label: "New" },
  { status: "call", label: "Call" },
  { status: "qualified", label: "Qualified" },
  { status: "appointment", label: "Appointment" },
  { status: "agreement", label: "Agreement" },
  { status: "waiting_documents", label: "Waiting docs" },
  { status: "active", label: "Active" },
  { status: "inactive", label: "Inactive" },
  { status: "lost", label: "Lost" },
];

export function KanbanBoard({
  leads: serverLeads,
  staff,
}: {
  leads: KanbanLead[];
  staff: StaffOption[];
}) {
  const router = useRouter();
  const [leads, setLeads] = useState(serverLeads);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<LeadStatusValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Fresh server data (after router.refresh) wins over stale local state.
  useEffect(() => setLeads(serverLeads), [serverLeads]);

  const [fDispatcher, setFDispatcher] = useState("all");
  const [fType, setFType] = useState("all");
  const [fTag, setFTag] = useState("");

  const filtered = useMemo(
    () =>
      leads.filter((lead) => {
        if (fDispatcher === "unassigned" && lead.assigned_to !== null) return false;
        if (
          fDispatcher !== "all" &&
          fDispatcher !== "unassigned" &&
          lead.assigned_to !== fDispatcher
        )
          return false;
        if (fType !== "all" && lead.lead_type !== fType) return false;
        if (fTag && !lead.tags.some((t) => t.includes(fTag.toLowerCase())))
          return false;
        return true;
      }),
    [leads, fDispatcher, fType, fTag],
  );

  function moveLead(id: string, status: LeadStatusValue) {
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.status === status) return;
    const previous = lead.status;
    setError(null);
    // Optimistic move
    setLeads((prev) =>
      prev.map((l) => (l.id === id ? { ...l, status } : l)),
    );
    startTransition(async () => {
      const result = await updateLeadStatus(id, status);
      if (!result.ok) {
        setLeads((prev) =>
          prev.map((l) => (l.id === id ? { ...l, status: previous } : l)),
        );
        setError(result.error ?? "Move failed.");
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="kboard">
      <div className="kfilters">
        <div className="field">
          <label htmlFor="kf-dispatcher">Dispatcher</label>
          <select
            id="kf-dispatcher"
            value={fDispatcher}
            onChange={(e) => setFDispatcher(e.target.value)}
          >
            <option value="all">All</option>
            <option value="unassigned">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="kf-type">Lead type</label>
          <select
            id="kf-type"
            value={fType}
            onChange={(e) => setFType(e.target.value)}
          >
            <option value="all">All</option>
            <option value="dispatch">Dispatch</option>
            <option value="new_authority">New authority</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="kf-tag">Tag</label>
          <input
            id="kf-tag"
            type="text"
            placeholder="filter by tag"
            value={fTag}
            onChange={(e) => setFTag(e.target.value)}
          />
        </div>
      </div>

      <div className={`form-err${error ? " show" : ""}`} role="alert" style={{ marginBottom: 14, marginTop: 0 }}>
        {error}
      </div>

      <div className="kanban">
        {COLUMNS.map((col) => {
          const cards = filtered.filter((l) => l.status === col.status);
          return (
            <section
              key={col.status}
              className={`kcol${overCol === col.status ? " dragover" : ""}`}
              aria-label={`${col.label} — ${cards.length} leads`}
              onDragOver={(e) => {
                e.preventDefault();
                setOverCol(col.status);
              }}
              onDragLeave={() => setOverCol(null)}
              onDrop={(e) => {
                e.preventDefault();
                setOverCol(null);
                const id = e.dataTransfer.getData("text/plain");
                if (id) moveLead(id, col.status);
              }}
            >
              <h3 className="kcol-head">
                <span className="kcol-name">{col.label}</span>
                <span className="kcol-count" aria-hidden="true">
                  {cards.length}
                </span>
              </h3>
              {cards.map((lead) => {
                const overdue =
                  lead.callback_at !== null &&
                  new Date(lead.callback_at).getTime() < Date.now();
                return (
                  <div
                    key={lead.id}
                    className={`kcard${dragId === lead.id ? " dragging" : ""}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", lead.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(lead.id);
                    }}
                    onDragEnd={() => setDragId(null)}
                  >
                    <b>
                      <Link href={`/portal/admin/leads/${lead.id}`}>
                        {lead.full_name ?? "Unknown carrier"}
                      </Link>
                    </b>
                    <a className="kphone" href={`tel:${lead.phone.replace(/[^+\d]/g, "")}`}>
                      <span aria-hidden="true">☎</span> {lead.phone}
                    </a>
                    <span className="kmeta">
                      <span className="kmeta-main">
                        {leadEquipment(lead.truck_type, lead.trailer_type) ||
                          leadSourceLabel(lead.source)}
                      </span>
                      <span className="kmeta-age">{leadAge(lead.created_at)}</span>
                    </span>
                    {overdue || lead.lead_type === "new_authority" ||
                    lead.priority === "urgent" || lead.priority === "high" ||
                    lead.tags.length > 0 ? (
                      <span className="ktags">
                        {overdue ? (
                          <span className="pbadge kprio-urgent">Callback due</span>
                        ) : null}
                        {lead.priority === "urgent" ? (
                          <span className="pbadge kprio-urgent">Urgent</span>
                        ) : null}
                        {lead.priority === "high" ? (
                          <span className="pbadge kprio-high">High</span>
                        ) : null}
                        {lead.lead_type === "new_authority" ? (
                          <span className="pbadge green">New authority</span>
                        ) : null}
                        {lead.tags.slice(0, 2).map((t) => (
                          <span key={t} className="pbadge">
                            {t}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </div>
                );
              })}
              {cards.length === 0 ? (
                <p className="kcol-empty">No leads at this stage</p>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
