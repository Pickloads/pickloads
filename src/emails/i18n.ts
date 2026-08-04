/**
 * M-60 — email locale plumbing.
 *
 * Customer-facing emails are authored in en/es/fr. ru/ht MIRROR ENGLISH for
 * now (⚠ flagged for native review before those locales are marketed — same
 * M-42 precedent as the site dictionaries; the mirror is explicit in
 * `pick()` so a future ru/ht authoring pass only touches the dictionaries).
 *
 * The recipient's language comes from `profiles.preferred_language` when the
 * recipient is a known account, else from the submitting form's locale.
 * Anything unknown falls back to English.
 */

export const EMAIL_LOCALES = ["en", "es", "fr", "ru", "ht"] as const;
export type EmailLocale = (typeof EMAIL_LOCALES)[number];

/** Locales with authored email copy; ru/ht mirror en (pending native review). */
export type AuthoredLocale = "en" | "es" | "fr";

export function resolveEmailLocale(
  raw: string | null | undefined,
): EmailLocale {
  const v = (raw ?? "").toLowerCase().slice(0, 2);
  return (EMAIL_LOCALES as readonly string[]).includes(v)
    ? (v as EmailLocale)
    : "en";
}

/** Dictionary shape: authored en/es/fr; ru/ht resolve to en. */
export type EmailDict<T> = Record<AuthoredLocale, T>;

export function pick<T>(dict: EmailDict<T>, locale: EmailLocale): T {
  if (locale === "es" || locale === "fr") return dict[locale];
  // ru/ht mirror en until natively reviewed (see module doc).
  return dict.en;
}

/** Shared customer-footer strings. */
export const FOOTER_DICT: EmailDict<{ questions: string; hours: string }> = {
  en: {
    questions: "Questions? Call (908) 404-5373 or reply to this email.",
    hours: "Dispatch desk: Mon–Fri 8am–6pm, Sat 9am–2pm ET · Dispatch support 24/7",
  },
  es: {
    questions:
      "¿Preguntas? Llama al (908) 404-5373 o responde a este correo.",
    hours:
      "Mesa de dispatch: lun–vie 8am–6pm, sáb 9am–2pm ET · Soporte de dispatch 24/7",
  },
  fr: {
    questions:
      "Des questions ? Appelez le (908) 404-5373 ou répondez à cet e-mail.",
    hours:
      "Bureau dispatch : lun–ven 8h–18h, sam 9h–14h ET · Support dispatch 24/7",
  },
};

/** A built, ready-to-send customer email. */
export interface BuiltEmail {
  subject: string;
  /** email_log.template identifier. */
  template: string;
  react: React.ReactElement;
}
