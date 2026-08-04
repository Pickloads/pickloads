"use client";

/**
 * Language selector. Until next-intl locale routing lands (M-13) this renders
 * the V4 control with EN active; M-13 replaces the handler with router-based
 * locale switching (/es/... URLs, hreflang).
 */
export function LangSelect() {
  return (
    <select
      className="langsel"
      aria-label="Language"
      defaultValue="en"
      onChange={() => {
        /* M-13: router.replace(pathname, { locale: value }) */
      }}
    >
      <option value="en">EN</option>
      <option value="es">ES</option>
      <option value="fr">FR</option>
      <option value="ru">RU</option>
      <option value="ht">HT</option>
    </select>
  );
}
