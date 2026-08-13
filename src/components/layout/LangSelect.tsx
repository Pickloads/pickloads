"use client";

import { useLocale } from "next-intl";
import { useParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";
import { useV4 } from "@/i18n/v4";

/** V4 language selector — switches locale while preserving the current path. */
export function LangSelect() {
  const tv = useV4();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();

  return (
    <select
      className="langsel"
      /* M-90: announced in the locale the user is currently reading, so a
         French speaker looking for the switcher hears "Langue" and not the
         one English word on the page they cannot yet change. */
      aria-label={tv("Language")}
      value={locale}
      onChange={(e) => {
        router.replace(
          // @ts-expect-error — dynamic params are compatible at runtime (next-intl docs pattern)
          { pathname, params },
          { locale: e.target.value as AppLocale },
        );
      }}
    >
      {routing.locales.map((l) => (
        <option key={l} value={l}>
          {l.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
