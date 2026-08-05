import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

/**
 * M-69 / P-4 — the `audit_events` ledger has exactly ONE writer.
 *
 * src/lib/audit.ts has been documented as the single writer since M-61, but
 * four action files inserted straight into the table (staff.ts ×5,
 * carrier-portal.ts ×2, account.tsx ×2, quotes.ts ×1), so the helper's
 * contract — never log secrets, always capture the caller IP, never let a
 * failed journal write roll back the operator's action — was not actually
 * enforceable. M-69 routes every one of those through the helper; this rule
 * is what stops the next module from re-opening the hole.
 *
 * Allowed to touch the table:
 *   src/lib/audit.ts                                  — the writer itself
 *   src/app/[locale]/portal/admin/security/page.tsx   — the READER (the
 *                                                       admin security log)
 * Everything else must call recordAuditEvent().
 */
const AUDIT_TABLE_SELECTOR =
  "CallExpression[callee.property.name='from'][arguments.0.value='audit_events']";
const AUDIT_TABLE_MESSAGE =
  "audit_events has one writer: call recordAuditEvent() from src/lib/audit.ts " +
  "(M-69/P-4). Direct .from('audit_events') is allowed only in src/lib/audit.ts " +
  "and the admin security reader page.";

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/audit.ts",
      "src/app/**/portal/admin/security/page.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: AUDIT_TABLE_SELECTOR, message: AUDIT_TABLE_MESSAGE },
      ],
    },
  },
];

export default eslintConfig;
