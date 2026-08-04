"use client";

import { useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import { markAllNotificationsRead } from "@/app/actions/portal-account";

/** M-55 — notifications page: clear the unread state (own-rows RLS). */
export function MarkNotificationsReadButton() {
  const tv = useV4();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      aria-busy={pending}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await markAllNotificationsRead();
          router.refresh();
        })
      }
    >
      {pending ? "…" : tv("Mark all read")}
    </button>
  );
}
