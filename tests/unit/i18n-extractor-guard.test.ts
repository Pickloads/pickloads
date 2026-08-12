import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * `scripts/extract-i18n.mjs` REGENERATES the locale catalogs rather than
 * merging into them, so every key added to `messages/` after the V4
 * extraction is a key it cannot reproduce — and therefore deletes.
 *
 * Running it once cost 743 lines and 45 red tests. It now carries a guard that
 * diffs the paths it is about to write against the paths on disk and aborts
 * without writing if any would be lost.
 *
 * This test exists because the guard is the only thing standing between a
 * routine `node scripts/extract-i18n.mjs` and a silent loss of five locales.
 * Deleting the guard must break a test, not a release.
 */

const LOCALES = ["en", "es", "fr", "ru", "ht"] as const;
const SCRIPT = "scripts/extract-i18n.mjs";

function hashCatalogs(): Record<string, string> {
  return Object.fromEntries(
    LOCALES.map((l) => [
      l,
      createHash("sha256")
        .update(readFileSync(resolve(process.cwd(), `messages/${l}.json`)))
        .digest("hex"),
    ]),
  );
}

describe("i18n extractor — cannot destroy translations", () => {
  it("refuses to run, and writes nothing, while it would drop keys", () => {
    const before = hashCatalogs();

    let exitCode = 0;
    let stderr = "";
    try {
      // Spawned through process.execPath, not `npx`/`node` on PATH: resolving
      // the launcher by name is what made an earlier Windows helper ENOENT.
      execFileSync(process.execPath, [SCRIPT], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: string };
      exitCode = e.status ?? -1;
      stderr = e.stderr ?? "";
    }

    // Non-zero: a script that would delete translations must fail the shell,
    // so a chained `&& git commit` can never reach the commit.
    expect(
      exitCode,
      "the extractor did not refuse — has the guard been removed?",
    ).toBe(1);
    expect(stderr).toContain("REFUSING TO WRITE");
    expect(stderr).toContain("Nothing has been written");

    // The assertion that actually matters. An error message is worthless if
    // the files changed anyway.
    expect(
      hashCatalogs(),
      "the extractor modified messages/ despite refusing",
    ).toEqual(before);
  }, 60_000);

  it("NON-VACUITY: the catalogs really do hold keys the script cannot reproduce", () => {
    // If this ever fails, the previous test may be passing for the wrong
    // reason — a guard that never triggers proves nothing. Post-V4 namespaces
    // absent from the script's SHIPMENT table are what it must protect.
    const en = JSON.parse(
      readFileSync(resolve(process.cwd(), "messages/en.json"), "utf8"),
    ) as {
      shipment: Record<string, unknown>;
    };
    const script = readFileSync(resolve(process.cwd(), SCRIPT), "utf8");

    const unreproducible = ["document", "optout", "location", "broker"].filter(
      (ns) => ns in en.shipment && !script.includes(`"${ns}.`),
    );
    expect(unreproducible.length).toBeGreaterThan(0);
  });

  it("the guard compares PATHS, not counts — an add-and-drop run still fails", () => {
    // A guard keyed on key totals passes when a run adds 200 keys and deletes
    // one. This asserts the implementation is a set difference over leaf paths.
    const script = readFileSync(resolve(process.cwd(), SCRIPT), "utf8");
    expect(script).toContain("leafPaths");
    expect(script).toMatch(/filter\(\(p\) => !nextPaths\.has\(p\)\)/);
    expect(script).toContain("process.exit(1)");
  });
});
