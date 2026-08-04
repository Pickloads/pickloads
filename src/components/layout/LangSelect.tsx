"use client";

import { useLocale } from "next-intl";
import { useParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type AppLocale } from "@/i18n/routing";

/** V4 language selector — switches locale while preserving the current path. */
export function LangSelect() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();

  return (
    <select
      className="langsel"
      aria-label="Language"
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
