import { getTranslations } from "next-intl/server";
import { slugifyV4 } from "./v4";

/**
 * Server-side (async-context) counterpart of useV4() — same V4-dictionary
 * bridge, usable in generateMetadata, JSON-LD builders and async RSC where
 * hooks are illegal. Falls back to the English literal identically.
 */
export async function getV4(locale: string): Promise<(en: string) => string> {
  const t = await getTranslations({ locale, namespace: "v4" });
  return (en: string) => {
    const key = slugifyV4(en);
    return t.has(key) ? t(key) : en;
  };
}
