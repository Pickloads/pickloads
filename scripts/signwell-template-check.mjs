#!/usr/bin/env node
/**
 * SignWell template configuration check (M-92).
 *
 *   SIGNWELL_API_KEY=… SIGNWELL_TEMPLATE_ID=… node scripts/signwell-template-check.mjs
 *
 * Answers two questions that are otherwise SILENT in production:
 *
 *   1. Does every `api_id` the code sends exist on the template? A mismatch is
 *      not an error — SignWell accepts the request and leaves the field blank.
 *      A carrier signs an agreement with an empty MC number and nothing warns
 *      anyone.
 *
 *   2. Are the five business-critical values editable by the Carrier? SignWell
 *      has no API-level lock, so a field is editable exactly when it is
 *      assigned to a recipient. If the dispatch fee is assigned to the Carrier
 *      placeholder, the carrier can change the fee on their own contract.
 *
 * Prints structure only. Never the API key, never the template id, never a
 * field value — safe to paste into an issue.
 *
 * Exit codes: 0 pass · 1 problems found · 2 not configured / unreachable.
 */

const API_BASE = "https://www.signwell.com/api/v1";

/** Must stay in step with AGREEMENT_FIELD_API_IDS in src/lib/agreements/send.ts. */
const EXPECTED_API_IDS = [
  "carrier_legal_name",
  "carrier_dba",
  "carrier_mc_number",
  "carrier_usdot_number",
  "carrier_rep_name",
  "carrier_rep_title",
  "carrier_address",
  "carrier_city",
  "carrier_state",
  "carrier_zip",
  "carrier_phone",
  "carrier_email",
  "dispatch_fee",
  "effective_date",
];

/** Must stay in step with MUST_NOT_BE_CARRIER_EDITABLE in src/lib/signwell.ts. */
const MUST_NOT_BE_CARRIER_EDITABLE = [
  "carrier_legal_name",
  "carrier_mc_number",
  "carrier_usdot_number",
  "carrier_email",
  "dispatch_fee",
];

const CARRIER_PLACEHOLDER = "Carrier";
const PICKLOADS_PLACEHOLDER = "PickLoads Authorized Representative";

const apiKey = process.env.SIGNWELL_API_KEY;
const templateId = process.env.SIGNWELL_TEMPLATE_ID;

if (!apiKey || !templateId) {
  console.error(
    "✖ SIGNWELL_API_KEY and SIGNWELL_TEMPLATE_ID must both be set.\n" +
      "  Values are never printed by this script.",
  );
  process.exit(2);
}

const res = await fetch(
  `${API_BASE}/document_templates/${encodeURIComponent(templateId)}`,
  { headers: { "X-Api-Key": apiKey } },
).catch((err) => {
  console.error(`✖ Request failed: ${err.message}`);
  process.exit(2);
});

if (!res.ok) {
  console.error(
    `✖ SignWell returned HTTP ${res.status}. ` +
      (res.status === 404
        ? "SIGNWELL_TEMPLATE_ID does not match a template on this account."
        : res.status === 401
          ? "SIGNWELL_API_KEY was rejected."
          : ""),
  );
  process.exit(2);
}

const body = await res.json();

const fields = [];
for (const page of Array.isArray(body.fields) ? body.fields : []) {
  for (const f of Array.isArray(page) ? page : [page]) {
    if (!f || typeof f.api_id !== "string") continue;
    fields.push({
      apiId: f.api_id,
      type: typeof f.type === "string" ? f.type : "?",
      assignedTo:
        (typeof f.placeholder_name === "string" && f.placeholder_name) ||
        (typeof f.recipient_id === "string" && f.recipient_id) ||
        null,
    });
  }
}

const placeholders = (Array.isArray(body.placeholders) ? body.placeholders : [])
  .filter((p) => p && typeof p.name === "string")
  .map((p) => ({
    name: p.name,
    order: typeof p.signing_order === "number" ? p.signing_order : null,
  }));

let problems = 0;
const present = new Set(fields.map((f) => f.apiId));

console.log("── Recipients (placeholders) ───────────────────────────────");
if (placeholders.length === 0) {
  console.log("  (none reported)");
} else {
  for (const p of placeholders) {
    console.log(`  ${String(p.order ?? "?").padEnd(3)} ${p.name}`);
  }
}
for (const [label, name] of [
  ["Carrier", CARRIER_PLACEHOLDER],
  ["PickLoads", PICKLOADS_PLACEHOLDER],
]) {
  if (!placeholders.some((p) => p.name === name)) {
    problems += 1;
    console.log(
      `  ✖ MISSING placeholder for ${label}: expected exactly "${name}"`,
    );
  }
}

console.log("\n── Expected api_id values ──────────────────────────────────");
for (const id of EXPECTED_API_IDS) {
  if (present.has(id)) {
    console.log(`  ✓ ${id}`);
  } else {
    problems += 1;
    console.log(
      `  ✖ ${id}  — NOT ON TEMPLATE (code will send it; it is ignored)`,
    );
  }
}

const extra = [...present].filter((id) => !EXPECTED_API_IDS.includes(id));
if (extra.length) {
  console.log("\n── On the template but never sent by code ──────────────────");
  for (const id of extra) console.log(`  · ${id}`);
  console.log("  (Not an error — the signer fills these in.)");
}

console.log("\n── Must NOT be Carrier-editable ────────────────────────────");
for (const id of MUST_NOT_BE_CARRIER_EDITABLE) {
  const field = fields.find((f) => f.apiId === id);
  if (!field) {
    console.log(`  ? ${id}  — not on template (see above)`);
    continue;
  }
  if (field.assignedTo === null) {
    console.log(`  ✓ ${id}  — unassigned (sender-filled, not editable)`);
  } else {
    problems += 1;
    console.log(
      `  ✖ ${id}  — assigned to "${field.assignedTo}" → EDITABLE by that recipient.\n` +
        `      Fix: in the SignWell template editor, set this field's recipient to\n` +
        `      none / sender so it renders as pre-filled static text.`,
    );
  }
}

console.log(
  problems === 0
    ? "\n✔ Template matches what the code sends."
    : `\n✖ ${problems} problem(s). The agreement is NOT ready for production.`,
);
process.exit(problems === 0 ? 0 : 1);
