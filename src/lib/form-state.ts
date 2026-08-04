/**
 * Shared shape for public-form server actions (audit U-03: explicit
 * loading/success/error states). Client components consume it via
 * `useActionState`; plain module so both sides can import it.
 */
export interface FormState {
  status: "idle" | "success" | "error";
  /** English fallback message; client wraps it in tv() for future dictionary coverage. */
  message?: string;
}

export const initialFormState: FormState = { status: "idle" };
