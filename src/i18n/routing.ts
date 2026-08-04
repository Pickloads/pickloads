import { defineRouting } from "next-intl/routing";

/** Arch §2: 5 locales, en default, URLs /es/... , x-default = en. */
export const routing = defineRouting({
  locales: ["en", "es", "fr", "ru", "ht"],
  defaultLocale: "en",
  localePrefix: "as-needed",
});

export type AppLocale = (typeof routing.locales)[number];
