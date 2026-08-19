/**
 * Shared client/server state shapes for the M-20 become-a-carrier wizard
 * (same pattern as src/lib/form-state.ts — plain module, both sides import).
 */

export interface StartState {
  status: "idle" | "success" | "error";
  message?: string;
  /** carriers.id created by `startOnboarding` — the wizard's session handle. */
  carrierId?: string;
  /**
   * The VERIFIED legal company name, echoed back by the server.
   *
   * M-94: the wizard no longer asks for a company name — it was verified with
   * FMCSA in step 1 and `startOnboarding` reads it from the pre-registration.
   * It comes back here so the account step can show and submit it without the
   * browser being the one that decides what this carrier is called.
   */
  companyName?: string;
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
