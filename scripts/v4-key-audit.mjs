#!/usr/bin/env node
/**
 * V4 key audit — ADDITIVE ONLY. It never deletes, renames or rewrites a key.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT `extract-i18n.mjs` ────────────────
 *
 * `scripts/extract-i18n.mjs` regenerates the catalogue from the vendored V4
 * prototype. It is the right tool for that job and the wrong tool for this
 * one: anything the running application says that the prototype never said is
 * absent from its output, so running it to "fix" a missing key removes the
 * ones the app grew afterwards. This script reads the APPLICATION and reports
 * what the application asks for. It writes nothing unless `--write` is passed,
 * and `--write` can only ADD keys to `messages/en.json`.
 *
 * ── THE FAILURE IT FOUND ─────────────────────────────────────────────────
 *
 * `useV4()` resolves a slug and falls back to the English literal when the key
 * is absent:
 *
 *     return t.has(key) ? t(key) : en;
 *
 * That fallback is correct and it is also silent. A string added to a
 * component after the last extractor run renders perfectly in English and
 * renders English in every other locale, forever, with no error, no missing
 * -message warning and no visual defect in the language the author speaks.
 * 211 of the site's 843 literal `tv()` calls were in that state — the whole
 * carrier wizard, the quote page, both equipment pickers, the 404, the cookie
 * banner, half the auth screens. That is the reason the language selector
 * "did not work": for a quarter of the site there was nothing to switch to.
 *
 * ── WHAT COUNTS AS A CALL SITE ───────────────────────────────────────────
 *
 * Two classes, and the second is the one a naive extractor misses:
 *
 *   1. Literals — `tv("Continue to Documents →")` in a component.
 *   2. Data-module labels — `tv(group.label)` where `group` comes from
 *      `src/lib/site-nav.ts`. The string never appears next to a `tv(`, so
 *      scanning source text for `tv("…")` finds none of the navigation, and
 *      the entire main menu rendered English in all five locales.
 *
 * Class 2 is enumerated from the modules themselves (below) rather than
 * inferred, so a new nav entry is covered the moment it is declared.
 *
 * Deliberately NOT enumerated: the long-form bodies in `src/content/
 * {equipment,states,knowledge-base}.ts`. Those are the O-03 content
 * workstream — 500–800 words per page across 14 pages — and listing them here
 * would report a 6,000-string "gap" that no code change can close, drowning
 * the chrome gap that one can. They are tracked in
 * docs/modules/M-90-i18n-repair.md instead.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** Must stay byte-identical to slugifyV4 in src/i18n/v4.ts. */
export function slugifyV4(en) {
  return (
    en
      .toLowerCase()
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "and")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 56)
      .replace(/_+$/g, "") || "s"
  );
}

/**
 * Class 1 — literal `tv("…")` / `tv('…')` / `tv(`…`)` calls, including the
 * multi-line form Prettier produces for long strings.
 */
export function literalCallSites(root = process.cwd()) {
  const files = execSync('git ls-files "src/**/*.tsx" "src/**/*.ts"', {
    encoding: "utf8",
    cwd: root,
  })
    .trim()
    .split("\n")
    .filter(Boolean);

  const out = new Map();
  const re = /\btv\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1\s*[,)]/g;
  for (const file of files) {
    const src = readFileSync(`${root}/${file}`, "utf8");
    let m;
    while ((m = re.exec(src))) {
      // Source is authored with Prettier's line wrapping; the runtime value is
      // the concatenated literal. Collapse the whitespace the same way the
      // JSX text nodes do so the slug matches what ships.
      const lit = m[2]
        .replace(/\\(["'`])/g, "$1")
        .replace(/\\n/g, "\n")
        .replace(/\s+/g, " ")
        .trim();
      if (!lit) continue;
      if (!out.has(lit)) out.set(lit, new Set());
      out.get(lit).add(file);
    }
  }
  return out;
}

/**
 * Class 2 — labels that reach `tv()` through a data module. Enumerated by
 * reading the declarations, because the string and the `tv(` are in different
 * files by design (`src/lib/site-nav.ts` is the single IA definition).
 */
export function dataModuleLabels(root = process.cwd()) {
  const out = new Map();
  const add = (lit, file) => {
    if (!lit) return;
    if (!out.has(lit)) out.set(lit, new Set());
    out.get(lit).add(file);
  };

  const nav = readFileSync(`${root}/src/lib/site-nav.ts`, "utf8");
  for (const m of nav.matchAll(/\blabel:\s*"((?:\\.|[^"])*)"/g)) {
    add(m[1].replace(/\\"/g, '"'), "src/lib/site-nav.ts");
  }
  // `entryLabel()` swaps the label while brokerage is inactive — the
  // replacement is a user-facing string on the same footing as the original.
  for (const m of nav.matchAll(/return\s+"((?:\\.|[^"])*)"/g)) {
    add(m[1].replace(/\\"/g, '"'), "src/lib/site-nav.ts");
  }

  // M-92: agreement status labels. `tv(STATUS_LABEL[status])` — the string and
  // the tv() are in different files, which is the same shape that hid the
  // whole navigation from the extractor.
  try {
    const status = readFileSync(`${root}/src/lib/agreements/status.ts`, "utf8");
    const table = status.match(
      /STATUS_LABEL[\s\S]*?=\s*\{([\s\S]*?)\n\};/,
    )?.[1];
    if (table) {
      for (const m of table.matchAll(/:\s*"((?:\\.|[^"])*)"/g)) {
        add(m[1].replace(/\\"/g, '"'), "src/lib/agreements/status.ts");
      }
    }
  } catch {
    /* module is optional — absent in older trees */
  }

  // Approved onboarding-timing wording (owner decision A3) — headline and
  // qualifier are rendered through tv() on two pages.
  try {
    const timing = readFileSync(
      `${root}/src/lib/copy/onboarding-timing.ts`,
      "utf8",
    );
    for (const m of timing.matchAll(
      /\b(?:headline|qualifier|note)\s*:\s*"((?:\\.|[^"])*)"/g,
    )) {
      add(m[1].replace(/\\"/g, '"'), "src/lib/copy/onboarding-timing.ts");
    }
  } catch {
    /* module is optional — absent in older trees */
  }

  return out;
}

/**
 * Class 3 — `pageMetadata({ title, description })` literals. Since M-90 those
 * two fields resolve through the same V4 bridge, so a `<title>` is a
 * translatable string on exactly the same footing as an `<h1>` and belongs in
 * the same coverage check. Without this the metadata could silently drift back
 * to English-only, which is the defect this repair closed.
 *
 * Only string LITERALS are collected. `title: content.metaTitle` on the
 * equipment and state pages is long-form English from `src/content/*`,
 * deliberately untranslated (O-03) and deliberately not reported here.
 */
export function metadataLiterals(root = process.cwd()) {
  const files = execSync('git ls-files "src/app/**/*.tsx"', {
    encoding: "utf8",
    cwd: root,
  })
    .trim()
    .split("\n")
    .filter(Boolean);

  const out = new Map();
  for (const file of files) {
    const src = readFileSync(`${root}/${file}`, "utf8");
    for (const call of src.matchAll(/pageMetadata\(\{([\s\S]*?)\n\s*\}\)/g)) {
      for (const field of call[1].matchAll(
        /\b(?:title|description):\s*\n?\s*"((?:\\.|[^"])*)"/g,
      )) {
        const lit = field[1].replace(/\\"/g, '"').replace(/\s+/g, " ").trim();
        if (!lit) continue;
        if (!out.has(lit)) out.set(lit, new Set());
        out.get(lit).add(file);
      }
    }
  }
  return out;
}

export function allCallSites(root = process.cwd()) {
  const merged = literalCallSites(root);
  for (const [lit, files] of metadataLiterals(root)) {
    if (!merged.has(lit)) merged.set(lit, new Set());
    for (const f of files) merged.get(lit).add(f);
  }
  for (const [lit, files] of dataModuleLabels(root)) {
    if (!merged.has(lit)) merged.set(lit, new Set());
    for (const f of files) merged.get(lit).add(f);
  }
  return merged;
}

export function missingKeys(root = process.cwd()) {
  const en = JSON.parse(readFileSync(`${root}/messages/en.json`, "utf8"));
  const v4 = en.v4 ?? {};
  const missing = [];
  for (const [lit, files] of allCallSites(root)) {
    const key = slugifyV4(lit);
    if (!(key in v4)) missing.push({ key, literal: lit, files: [...files] });
  }
  return missing;
}

/* ── CLI ─────────────────────────────────────────────────────────────── */
// pathToFileURL rather than string concatenation: on Windows argv[1] is
// `C:\…`, whose file URL is `file:///C:/…` — a hand-built `file://${…}` has
// one slash too few and the CLI silently does nothing.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = process.cwd();
  const missing = missingKeys(root);
  const total = allCallSites(root).size;

  if (process.argv.includes("--write")) {
    const path = `${root}/messages/en.json`;
    const en = JSON.parse(readFileSync(path, "utf8"));
    let added = 0;
    // Sorted by key so a rerun produces the same file, and so the collision
    // resolution below is decided by the data rather than by filesystem order.
    for (const { key, literal } of [...missing].sort((a, b) =>
      a.key === b.key
        ? a.literal.localeCompare(b.literal)
        : a.key.localeCompare(b.key),
    )) {
      // Two literals can collide on one slug — the slugifier lower-cases and
      // truncates at 56 chars, so "Carrier resources" and "Carrier Resources"
      // are one key. That is pre-existing V4 behaviour (18 such collisions
      // already ship); both call sites render the same translation, which for
      // case variants of the same phrase is right. First writer wins, and the
      // sort above makes "first" deterministic instead of incidental.
      if (key in en.v4) continue;
      en.v4[key] = literal;
      added += 1;
    }
    // APPENDED, not sorted into place. The existing catalogue is not in sorted
    // order, so re-sorting it would rewrite 769 lines that nobody changed and
    // bury the additions in the diff. Copy changes in this repo get read.
    writeFileSync(path, `${JSON.stringify(en, null, 2)}\n`, "utf8");
    console.log(`✔ added ${added} key(s) to messages/en.json`);
  } else {
    console.log(`tv() call sites: ${total}`);
    console.log(`missing from messages/en.json v4: ${missing.length}`);
    for (const m of missing) {
      console.log(`  ${m.key}  ::  ${JSON.stringify(m.literal)}`);
    }
  }
}
