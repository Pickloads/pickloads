"use client";

import { useEffect, useRef } from "react";
import { useActionState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useV4 } from "@/i18n/v4";
import {
  createSupportThread,
  replyToSupportThread,
  setSupportThreadStatus,
  staffReplyToSupportThread,
} from "@/app/actions/support";
import { initialFormState } from "@/lib/form-state";

/**
 * M-55 — support thread forms (decision D2, simple threaded messages).
 * Customer variants translate via tv(); the staff variants live on the admin
 * surface (English by scope decision).
 */

export function NewSupportThreadForm() {
  const tv = useV4();
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    createSupportThread,
    initialFormState,
  );
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);

  if (state.status === "success") {
    return (
      <div className="form-ok show" role="status">
        {tv(
          "✓ Message sent. A dispatcher answers here in the portal — usually within one business hour (8am–6pm ET).",
        )}
      </div>
    );
  }
  return (
    <form action={formAction}>
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="st-subject">{tv("Subject")}</label>
        <input id="st-subject" name="subject" type="text" required minLength={3} maxLength={140} placeholder={tv("What do you need help with?")} />
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="st-body">{tv("Message")}</label>
        <textarea id="st-body" name="body" rows={4} required minLength={5} maxLength={5000} />
      </div>
      <button className="btn btn-amber btn-sm" type="submit" aria-busy={pending} disabled={pending}>
        {pending ? tv("Sending…") : tv("Send message")}
      </button>
      <div className={`form-err${state.status === "error" ? " show" : ""}`} role="alert">
        {state.status === "error" && state.message ? tv(state.message) : null}
      </div>
    </form>
  );
}

export function SupportReplyForm({ threadId }: { threadId: string }) {
  const tv = useV4();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    replyToSupportThread,
    initialFormState,
  );
  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);
  return (
    <form action={formAction} ref={formRef}>
      <input type="hidden" name="thread_id" value={threadId} />
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="sr-body">{tv("Reply")}</label>
        <textarea id="sr-body" name="body" rows={3} required minLength={2} maxLength={5000} />
      </div>
      <button className="btn btn-amber btn-sm" type="submit" aria-busy={pending} disabled={pending}>
        {pending ? tv("Sending…") : tv("Send reply")}
      </button>
      <div className={`form-err${state.status === "error" ? " show" : ""}`} role="alert">
        {state.status === "error" && state.message ? tv(state.message) : null}
      </div>
    </form>
  );
}

/* ---------------- Staff (admin surface, English) ---------------- */

export function StaffReplyForm({ threadId }: { threadId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    staffReplyToSupportThread,
    initialFormState,
  );
  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);
  return (
    <form action={formAction} ref={formRef}>
      <input type="hidden" name="thread_id" value={threadId} />
      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="sfr-body">Reply as PickLoads</label>
        <textarea id="sfr-body" name="body" rows={3} required minLength={2} maxLength={5000} />
      </div>
      <button className="btn btn-amber btn-sm" type="submit" aria-busy={pending} disabled={pending}>
        {pending ? "Sending…" : "Send staff reply"}
      </button>
      <div className={`form-err${state.status === "error" ? " show" : ""}`} role="alert">
        {state.status === "error" && state.message ? state.message : null}
      </div>
    </form>
  );
}

export function ThreadStatusButtons({
  threadId,
  status,
}: {
  threadId: string;
  status: "open" | "answered" | "closed";
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    setSupportThreadStatus,
    initialFormState,
  );
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [state, router]);
  const next = status === "closed" ? "open" : "closed";
  return (
    <form action={formAction} style={{ display: "inline" }}>
      <input type="hidden" name="thread_id" value={threadId} />
      <input type="hidden" name="status" value={next} />
      <button className="btn btn-ghost btn-sm" type="submit" aria-busy={pending} disabled={pending}>
        {next === "closed" ? "Close thread" : "Reopen"}
      </button>
    </form>
  );
}
