/**
 * Extracts the V4 prototype's translation dictionaries (T = plain strings,
 * RICH = HTML strings) into next-intl message catalogs.
 *
 * Keys are deterministic slugs of the English source string, so the V4
 * dictionary remains the single source of truth (audit U-08). Rich strings are
 * converted to next-intl tag syntax (<br> → <br></br>; inline style attrs
 * stripped — styling lives in components, not messages).
 *
 * Usage: node scripts/extract-i18n.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const html = readFileSync("reference/pickloadssitev4.html", "utf8");
const LOCALES = ["es", "fr", "ru", "ht"];

function grabObject(startMarker) {
  const start = html.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found: ${startMarker}`);
  const braceStart = html.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      depth--;
      if (depth === 0) return html.slice(braceStart, i + 1);
    }
  }
  throw new Error("unbalanced braces");
}

// The prototype defines: `var T = {...}` then two `Object.assign(T, {...})`
// blocks, plus `var RICH = {...}` — hunt them all down.
const dicts = [];
dicts.push(grabObject("var T ="));
let idx = 0;
while ((idx = html.indexOf("Object.assign(T,", idx)) !== -1) {
  dicts.push(grabObject(html.slice(idx, idx + 20)) ? grabObject2(idx) : "");
  idx += 10;
}
function grabObject2(from) {
  const braceStart = html.indexOf("{", from + "Object.assign(T,".length - 1);
  let depth = 0;
  for (let i = braceStart; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      depth--;
      if (depth === 0) return html.slice(braceStart, i + 1);
    }
  }
  throw new Error("unbalanced");
}
let rich = {};
if (html.includes("var RICH")) {
  rich = Function(`"use strict"; return (${grabObject("var RICH =")})`)();
}

const flat = {};
for (const src of dicts) {
  if (!src) continue;
  const obj = Function(`"use strict"; return (${src})`)();
  Object.assign(flat, obj);
}

export function slugify(en) {
  return en
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56)
    .replace(/_+$/g, "") || "s";
}

function toRichSyntax(s) {
  return s
    .replace(/&nbsp;/g, "\u00a0")
    .replace(/&amp;/g, "&")
    .replace(/<br\s*\/?>/g, "<br></br>")
    .replace(/<b\s+style="[^"]*">/g, "<b>")
    .replace(/<em\s+style="[^"]*">/g, "<em>");
}

const catalogs = Object.fromEntries(["en", ...LOCALES].map((l) => [l, {}]));
const keyIndex = {};
const seen = new Set();

function addEntry(en, translations, isRich) {
  let key = slugify(en);
  while (seen.has(key) && keyIndex[key] !== en) key += "_x";
  seen.add(key);
  keyIndex[key] = en;
  catalogs.en[key] = isRich ? toRichSyntax(en) : en;
  for (const l of LOCALES) {
    const v = translations?.[l];
    catalogs[l][key] = v ? (isRich ? toRichSyntax(v) : v) : catalogs.en[key];
  }
}

for (const [en, tr] of Object.entries(flat)) addEntry(en, tr, false);
// RICH entries are keyed by data-i18n id (hero.title etc.) with per-locale HTML;
// English source is the element's innerHTML — we keep the id-based key.
const RICH_EN = {
  "hero.title": "Your truck stays <em>loaded</em>.<br>We handle everything else.",
  "hero.note": "<b>■ DISPATCH ACTIVE NOW</b> &nbsp;·&nbsp; Brokerage division launches with FMCSA MC authority & BMC-84 bond — in process.",
  "svc.d.p": "We act as your back office: finding freight, negotiating rates and handling the paperwork under <b>your</b> operating authority.",
  "boards.p": "<b>Your dispatcher works every major load source</b> — plus direct broker relationships built lane by lane.",
  "ab.p2": 'We started with a simple standard: <b>treat every truck like it\'s our own.</b> That means verifying the broker before booking, negotiating like the margin is ours, planning lanes around a driver\'s home time — and answering the phone at 2am when something goes wrong.',
  "ct.hours": "Mon–Fri 8am–6pm ET · Sat 9am–2pm ET<br>Dispatch support: 24/7, including holidays",
};
for (const [id, en] of Object.entries(RICH_EN)) {
  const key = "rich_" + id.replace(/\./g, "_");
  catalogs.en[key] = toRichSyntax(en);
  for (const l of LOCALES) {
    const v = rich[id]?.[l];
    catalogs[l][key] = v ? toRichSyntax(v) : catalogs.en[key];
  }
  keyIndex[key] = en;
}

mkdirSync("messages", { recursive: true });
for (const [l, cat] of Object.entries(catalogs)) {
  const sorted = Object.fromEntries(Object.entries(cat).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(`messages/${l}.json`, JSON.stringify({ v4: sorted }, null, 2) + "\n");
}
writeFileSync("messages/_key-index.json", JSON.stringify(keyIndex, null, 2) + "\n");
console.log(`extracted ${Object.keys(catalogs.en).length} strings × ${1 + LOCALES.length} locales`);
