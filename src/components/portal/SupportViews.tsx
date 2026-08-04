import { Link } from "@/i18n/navigation";
import { getV4 } from "@/i18n/v4-server";
import type { SupportStatus } from "@/lib/supabase/database.types";

/**
 * M-55 — shared server-rendered support views (carrier + shipper portals,
 * M-56 reuses them). Message bodies render as escaped plain text (React
 * default) with preserved line breaks — never HTML (audit §6.8).
 */

export const SUPPORT_STATUS_BADGE: Record<
  SupportStatus,
  { cls: string; label: string }
> = {
  open: { cls: "amber", label: "Open" },
  answered: { cls: "green", label: "Answered" },
  closed: { cls: "", label: "Closed" },
};

export interface SupportThreadRowUi {
  id: string;
  subject: string;
  status: SupportStatus;
  updated_at: string;
}

export async function SupportThreadsTable({
  locale,
  threads,
  basePath,
}: {
  locale: string;
  threads: SupportThreadRowUi[];
  basePath: string;
}) {
  const tv = await getV4(locale);
  return (
    <div className="ptable-wrap">
      {threads.length === 0 ? (
        <p className="pempty">
          {tv(
            "No conversations yet — send us a message above and the answer lands right here.",
          )}
        </p>
      ) : (
        <table className="ptable">
          <thead>
            <tr>
              <th>{tv("Subject")}</th>
              <th>{tv("Status")}</th>
              <th>{tv("Updated")}</th>
            </tr>
          </thead>
          <tbody>
            {threads.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link href={`${basePath}/${t.id}`}>{t.subject}</Link>
                </td>
                <td>
                  <span className={`pbadge ${SUPPORT_STATUS_BADGE[t.status].cls}`}>
                    {tv(SUPPORT_STATUS_BADGE[t.status].label)}
                  </span>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {new Date(t.updated_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export interface SupportMessageUi {
  id: string;
  body: string;
  is_staff: boolean;
  created_at: string;
}

export async function SupportMessagesTimeline({
  locale,
  messages,
}: {
  locale: string;
  messages: SupportMessageUi[];
}) {
  const tv = await getV4(locale);
  return (
    <ul className="timeline">
      {messages.map((m) => (
        <li className="tl" key={m.id}>
          <span className="tlt">
            {new Date(m.created_at).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}{" "}
            ·{" "}
            {m.is_staff ? (
              <span className="pbadge amber">{tv("PickLoads")}</span>
            ) : (
              <span className="pbadge">{tv("You")}</span>
            )}
          </span>
          {/* Escaped plain text; line breaks preserved via CSS. */}
          <p style={{ whiteSpace: "pre-wrap" }}>{m.body}</p>
        </li>
      ))}
    </ul>
  );
}
