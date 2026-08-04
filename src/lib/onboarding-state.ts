/**
 * Shared client/server state shapes for the M-20 become-a-carrier wizard
 * (same pattern as src/lib/form-state.ts — plain module, both sides import).
 */

export interface StartState {
  status: "idle" | "success" | "error";
  message?: string;
  /** carriers.id created by step 1 — the wizard's session handle. */
  carrierId?: string;
}

export const initialStartState: StartState = { status: "idle" };

export type UploadResult =
  | { ok: true; documentId: string; fileName: string }
  | { ok: false; error: string };

export interface AccountState {
  status: "idle" | "success" | "error";
  message?: string;
  /** Whether the dispatch agreement e-sign request went out (M-22 vendor). */
  esign?: "sent" | "pending";
}

export const initialAccountState: AccountState = { status: "idle" };
