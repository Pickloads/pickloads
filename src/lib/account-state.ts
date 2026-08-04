/**
 * Shared client/server state for the M-52/M-53 /create-account flows
 * (same plain-module pattern as src/lib/form-state.ts).
 */

/** Where the carrier branch routed the new account (directive M-52). */
export type CarrierSignupNext =
  | "onboarding" // MC active → continue to the become-a-carrier wizard
  | "pending" // MC application pending → account pending staff verification
  | "new_authority" // no authority yet → start-your-trucking-company funnel
  | "review"; // leased-on → manual review flag (account_status_history)

/**
 * Email-verification outcome — honest in every environment (audit §6.4):
 * - "sent": Supabase accepted the signup and emailed a confirmation link.
 * - "none": confirmations are disabled project-side; the session is live.
 * - "unconfigured": no Supabase env in this environment; NOTHING was created.
 */
export type SignupVerification = "sent" | "none" | "unconfigured";

export interface SignupState {
  status: "idle" | "success" | "error";
  message?: string;
  verification?: SignupVerification;
  next?: CarrierSignupNext;
}

export const initialSignupState: SignupState = { status: "idle" };
