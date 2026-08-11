import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * M-84 — §29's eighteen documents, verified to exist.
 *
 * `docs/DIRECTIVE-tracking.md` §29 names eighteen documents to create or
 * update. This test is the cheapest honest guarantee available: each named
 * file exists, opens with the H1 the index claims, is long enough to be a
 * document rather than a stub, and is linked from `docs/tracking/README.md`.
 *
 * ── WHAT IT DELIBERATELY DOES NOT CLAIM ───────────────────────────────────
 *
 * That the prose is TRUE. No test can read a paragraph and tell you the
 * system still behaves that way; that is what review is for, and pretending
 * otherwise would be the kind of green that teaches people to stop reading.
 * What it catches is the failure that actually happens: a document quietly
 * deleted, emptied, renamed or dropped from the index during a refactor,
 * while every other lane stays green.
 *
 * The length floor is not arbitrary. A file under it is a placeholder, and a
 * placeholder in an index of eighteen reads exactly like a document until
 * somebody opens it.
 */

const DOCS_DIR = "docs/tracking";
const INDEX = `${DOCS_DIR}/README.md`;

/** §29's list, in the directive's own order, with the H1 each file opens on. */
const SECTION_29_DOCUMENTS: readonly {
  requirement: string;
  file: string;
  heading: string;
}[] = [
  { requirement: "shipment architecture", file: "architecture.md", heading: "Shipment architecture" },
  { requirement: "shipment status model", file: "status-model.md", heading: "Shipment status model" },
  { requirement: "event visibility model", file: "event-visibility.md", heading: "Event visibility model" },
  { requirement: "tracking-number rules", file: "tracking-numbers.md", heading: "Tracking-number rules" },
  { requirement: "public tracking security", file: "public-tracking-security.md", heading: "Public tracking security" },
  { requirement: "shipper tracking portal", file: "shipper-portal.md", heading: "Shipper tracking portal" },
  { requirement: "carrier update workflow", file: "carrier-workflow.md", heading: "Carrier update workflow" },
  { requirement: "dispatcher workflow", file: "dispatcher-workflow.md", heading: "Dispatcher workflow" },
  { requirement: "document permissions", file: "document-permissions.md", heading: "Document permissions" },
  { requirement: "notification architecture", file: "notifications.md", heading: "Notification architecture" },
  { requirement: "ETA architecture", file: "eta.md", heading: "ETA architecture" },
  { requirement: "tracking-provider adapter interface", file: "provider-adapters.md", heading: "Tracking-provider adapter interface" },
  { requirement: "RLS policies", file: "rls.md", heading: "RLS policies" },
  { requirement: "migrations", file: "migrations.md", heading: "Migrations" },
  { requirement: "responsive behavior", file: "responsive.md", heading: "Responsive behavior" },
  { requirement: "testing", file: "testing.md", heading: "Testing" },
  { requirement: "launch procedure", file: "launch.md", heading: "Launch procedure" },
  { requirement: "troubleshooting", file: "troubleshooting.md", heading: "Troubleshooting" },
] as const;

/** Below this a file is a placeholder wearing a document's name. */
const MIN_CHARS = 1200;

describe("§29 documentation — the eighteen exist", () => {
  it("the list has exactly eighteen entries, and no duplicate files", () => {
    expect(SECTION_29_DOCUMENTS).toHaveLength(18);
    const files = SECTION_29_DOCUMENTS.map((d) => d.file);
    expect(new Set(files).size).toBe(18);
  });

  for (const doc of SECTION_29_DOCUMENTS) {
    it(`§29 · ${doc.requirement}`, () => {
      const path = `${DOCS_DIR}/${doc.file}`;
      expect(existsSync(path), `${path} does not exist`).toBe(true);

      const text = readFileSync(path, "utf8");
      expect(
        text.length,
        `${path} is ${text.length} characters — that is a stub, not a document`,
      ).toBeGreaterThan(MIN_CHARS);

      const firstHeading = text.split("\n").find((l) => l.startsWith("# "));
      expect(
        firstHeading,
        `${path} has no H1`,
      ).toBe(`# ${doc.heading}`);
    });
  }

  it("every one of the eighteen is linked from the index", () => {
    const index = readFileSync(INDEX, "utf8");
    for (const doc of SECTION_29_DOCUMENTS) {
      expect(
        index.includes(`(${doc.file})`),
        `${INDEX} does not link ${doc.file} — §29 "${doc.requirement}" is unreachable`,
      ).toBe(true);
    }
  });

  it("the runbook §29 asks to be updated still exists and covers the eight named topics", () => {
    const runbook = readFileSync("docs/LAUNCH-RUNBOOK.md", "utf8").toLowerCase();
    // §29: "new environment variables; database migrations; public tracking
    // configuration; map configuration; notification setup; smoke tests;
    // go-live checks; rollback steps."
    for (const topic of [
      "environment variable",
      "migration",
      "public tracking",
      "map",
      "notification",
      "smoke test",
      "go-live",
      "rollback",
    ]) {
      expect(
        runbook.includes(topic),
        `docs/LAUNCH-RUNBOOK.md does not mention "${topic}" (§29)`,
      ).toBe(true);
    }
  });

  it("NON-VACUITY — the checker rejects a document that is not there", () => {
    // Without this, a bug in `existsSync`'s path construction would make all
    // eighteen assertions pass against a directory that does not exist.
    expect(existsSync(`${DOCS_DIR}/this-document-was-never-written.md`)).toBe(
      false,
    );
    expect(
      readFileSync(INDEX, "utf8").includes("(this-document-was-never-written.md)"),
    ).toBe(false);
  });
});
