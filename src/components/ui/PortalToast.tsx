"use client";

import { useEffect, useRef, useState } from "react";

export interface ToastDetail {
  title: string;
  body: string;
}

/**
 * V4 "coming soon" toast. Any component fires it via `showToast()`.
 * Faithful port of the prototype's portal-toast behavior (5s auto-hide).
 */
export function showToast(detail: ToastDetail) {
  window.dispatchEvent(new CustomEvent<ToastDetail>("pl:toast", { detail }));
}

export function PortalToast() {
  const [toast, setToast] = useState<ToastDetail | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onToast(e: Event) {
      const { detail } = e as CustomEvent<ToastDetail>;
      setToast(detail);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(null), 5000);
    }
    window.addEventListener("pl:toast", onToast);
    return () => {
      window.removeEventListener("pl:toast", onToast);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div
      className={`portal-toast${toast ? " show" : ""}`}
      role="status"
      aria-live="polite"
    >
      {toast ? (
        <>
          <b>{toast.title}</b>
          <br />
          {toast.body}
        </>
      ) : null}
    </div>
  );
}
