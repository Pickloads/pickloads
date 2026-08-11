import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CARRIER_UPLOADABLE_DOC_TYPES,
  DEFAULT_DOCUMENT_VISIBILITY,
  DOCUMENT_AUDIENCES,
  DOCUMENT_AUDIENCES_ORDER,
  DOCUMENT_MAX_PAGE_SIZE,
  DOCUMENT_PAGE_SIZE,
  DRIVER_UPLOADABLE_DOC_TYPES,
  MAX_SHIPMENT_DOCUMENT_BYTES,
  NO_PUBLIC_DOCUMENTS,
  SHIPMENT_DOCS_BUCKET,
  STAFF_UPLOADABLE_DOC_TYPES,
  UPLOADABLE_DOC_TYPES,
  canUpload,
  documentReachesAudience,
  documentTypeKey,
  documentTypesForAudience,
  legalRowVisibilities,
  resolveDocumentLimit,
  shipmentDocumentPath,
  toCustomerDocumentDtos,
  type DocumentAudience,
} from "@/lib/shipments/documents";
import {
  SHIPMENT_DOCUMENT_TYPES,
  SHIPMENT_DOCUMENT_VISIBILITIES,
  type ShipmentDocumentType,
} from "@/lib/shipments/types";
import { MAX_UPLOAD_BYTES, SIGNED_URL_TTL_SECONDS, sniffMime } from "@/lib/uploads";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import ru from "../../messages/ru.json";
import ht from "../../messages/ht.json";

/**
 * M-77 — §16's document visibility MATRIX, pinned.
 *
 * `docs/FINAL-IMPLEMENTATION-PLAN.md` §4 restores this requirement with the
 * note that the mapping was *"never stated"*. A mapping that is stated in one
 * file and asserted nowhere is a mapping one careless edit away from being
 * wrong again, so the centrepiece here is a TABLE-DRIVEN walk of **every
 * document type × every audience** — 11 × 5 = 55 cells, each with the §16 or
 * §12 sentence it comes from written beside it.
 *
 * The expectations below are transcribed from the DIRECTIVE, not from
 * `documents.ts`. That is the whole point: a test that imported the matrix and
 * compared it to itself would pass for any matrix.
 */

/* ------------------------------------------------------------------ *
 * THE EXPECTED MATRIX — transcribed from §16 and §12, not from the code
 * ------------------------------------------------------------------ */

type Cell = readonly [ShipmentDocumentType, DocumentAudience, boolean, string];

/**
 * Every cell, with its authority. `true` means "an APPROVED, un-narrowed
 * document of this type is readable by this audience".
 */
const MATRIX: readonly Cell[] = [
  // ── quote ────────────────────────────────────────────────────────────
  ["quote", "public", false, "§16: do not put shipment documents in public buckets"],
  ["quote", "shipper", true, "§16 shipper-visible: approved shipment paperwork"],
  ["quote", "carrier", false, "§12/§18: quote + rate confirmation discloses the margin"],
  ["quote", "broker", false, "§12: a broker gets status, timeline, POD, BOL — not the quote"],
  // ── shipper_confirmation ─────────────────────────────────────────────
  ["shipper_confirmation", "public", false, "§16"],
  ["shipper_confirmation", "shipper", true, "§16 shipper-visible: approved shipment paperwork"],
  ["shipper_confirmation", "carrier", false, "§12/§18: the shipper's commercial correspondence"],
  ["shipper_confirmation", "broker", false, "§12"],
  // ── rate_confirmation ────────────────────────────────────────────────
  ["rate_confirmation", "public", false, "§4: never show carrier rate confirmations"],
  ["rate_confirmation", "shipper", false, "§16 lists it under CARRIER-visible only"],
  ["rate_confirmation", "carrier", true, "§16 carrier-visible: carrier rate confirmation"],
  ["rate_confirmation", "broker", false, "§12: not among a broker's permissions"],
  // ── bol ──────────────────────────────────────────────────────────────
  ["bol", "public", false, "§16"],
  ["bol", "shipper", true, "§16 shipper-visible: BOL"],
  ["bol", "carrier", true, "§16 carrier-visible: BOL"],
  ["bol", "broker", true, "§12: BOL, when authorized — the authorization is the org link"],
  // ── lumper_receipt ───────────────────────────────────────────────────
  ["lumper_receipt", "public", false, "§16"],
  ["lumper_receipt", "shipper", true, "§16: approved shipment paperwork (accessorial evidence)"],
  ["lumper_receipt", "carrier", true, "§16: approved operational documents"],
  ["lumper_receipt", "broker", false, "§12 does not name accessorial evidence"],
  // ── detention_documentation ──────────────────────────────────────────
  ["detention_documentation", "public", false, "§16"],
  ["detention_documentation", "shipper", true, "§16: approved shipment paperwork"],
  ["detention_documentation", "carrier", true, "§16: approved operational documents"],
  ["detention_documentation", "broker", false, "§12"],
  // ── delivery_receipt ─────────────────────────────────────────────────
  ["delivery_receipt", "public", false, "§16"],
  ["delivery_receipt", "shipper", true, "§16: approved shipment paperwork"],
  ["delivery_receipt", "carrier", true, "§16: approved operational documents"],
  ["delivery_receipt", "broker", false, "§12"],
  // ── pod ──────────────────────────────────────────────────────────────
  ["pod", "public", false, "§16"],
  ["pod", "shipper", true, "§16 shipper-visible: POD"],
  ["pod", "carrier", true, "§16 carrier-visible: POD"],
  ["pod", "broker", true, "§12: POD, unqualified"],
  // ── invoice ──────────────────────────────────────────────────────────
  ["invoice", "public", false, "§4: never show shipper billing details"],
  ["invoice", "shipper", true, "§16 shipper-visible: shipper invoice"],
  ["invoice", "carrier", false, "§16 names the SHIPPER invoice; carrier billing is M-31's"],
  ["invoice", "broker", false, "§12: must not see shipper billing"],
  // ── claim ────────────────────────────────────────────────────────────
  ["claim", "public", false, "§16 staff-only: private claim review"],
  ["claim", "shipper", false, "§16 staff-only: private claim review"],
  ["claim", "carrier", false, "§16 staff-only: private claim review"],
  ["claim", "broker", false, "§16 staff-only: private claim review"],
  // ── other ────────────────────────────────────────────────────────────
  ["other", "public", false, "§16: no document type is public"],
  ["other", "shipper", true, "§16: staff choose per row; the type licenses it"],
  ["other", "carrier", true, "§16: staff choose per row; the type licenses it"],
  ["other", "broker", true, "§16/§12: staff choose per row; the type licenses it"],
];

const APPROVED = { status: "approved" } as const;

describe("§16 visibility MATRIX — every doc type × every audience", () => {
  it("covers all 11 × 4 customer cells with no gaps and no duplicates", () => {
    expect(MATRIX.length).toBe(
      SHIPMENT_DOCUMENT_TYPES.length * DOCUMENT_AUDIENCES_ORDER.length,
    );
    const seen = new Set(MATRIX.map(([t, a]) => `${t}/${a}`));
    expect(seen.size).toBe(MATRIX.length);
    for (const type of SHIPMENT_DOCUMENT_TYPES) {
      for (const audience of DOCUMENT_AUDIENCES_ORDER) {
        expect(seen.has(`${type}/${audience}`), `${type}/${audience} missing`).toBe(
          true,
        );
      }
    }
  });

  for (const [docType, audience, expected, authority] of MATRIX) {
    it(`${docType} → ${audience} is ${expected} (${authority})`, () => {
      /*
       * The row is filed at the type's WIDEST licensed band, which is what
       * "un-narrowed" means. Using `DEFAULT_DOCUMENT_VISIBILITY` here would
       * conflate two separate rules: `other` DEFAULTS to `staff_only` (nobody
       * has looked at the file yet) while the matrix still licenses three
       * audiences for it once a human widens it. Both facts have their own
       * test below.
       */
      const reaches = documentReachesAudience(
        { doc_type: docType, visibility: legalRowVisibilities(docType)[0]!, ...APPROVED },
        audience,
      );
      expect(reaches).toBe(expected);
      // And the same answer from the declared matrix itself, so the predicate
      // and the data cannot drift apart.
      expect(DOCUMENT_AUDIENCES[docType].includes(audience)).toBe(expected);
    });
  }

  /* ---------------- the fifth column: staff ---------------- */

  it("`staff_only` is a FLOOR, not a matrix cell — no row names it", () => {
    for (const type of SHIPMENT_DOCUMENT_TYPES) {
      expect(DOCUMENT_AUDIENCES[type]).not.toContain("staff_only");
    }
    // …and it is a legal `visibility` value for EVERY type, because narrowing
    // always is.
    for (const type of SHIPMENT_DOCUMENT_TYPES) {
      expect(legalRowVisibilities(type)).toContain("staff_only");
    }
  });

  it("§4/§16: NO document type is public, and that is asserted not assumed", () => {
    expect(NO_PUBLIC_DOCUMENTS).toBe(true);
    for (const type of SHIPMENT_DOCUMENT_TYPES) {
      expect(DOCUMENT_AUDIENCES[type]).not.toContain("public");
      expect(legalRowVisibilities(type)).not.toContain("public");
    }
    expect(documentTypesForAudience("public")).toEqual([]);
  });

  it("§4's four named public prohibitions each resolve to `false`", () => {
    // "carrier rate confirmations", "insurance documents" (a carrier
    // compliance doc, which is `other` filed staff-only), "shipper billing
    // details", "internal notes".
    for (const type of ["rate_confirmation", "invoice", "claim"] as const) {
      expect(documentReachesAudience({ doc_type: type, visibility: DEFAULT_DOCUMENT_VISIBILITY[type], ...APPROVED }, "public")).toBe(false);
    }
    // `other` defaults to staff_only precisely because "internal notes" and
    // "carrier compliance documents" arrive through it.
    expect(DEFAULT_DOCUMENT_VISIBILITY.other).toBe("staff_only");
    expect(
      documentReachesAudience(
        { doc_type: "other", visibility: "staff_only", ...APPROVED },
        "shipper",
      ),
    ).toBe(false);
  });

  it("the bands do NOT nest — a shipper never inherits carrier or broker", () => {
    // If they nested, a shipper would see the rate confirmation.
    expect(
      documentReachesAudience(
        { doc_type: "rate_confirmation", visibility: "carrier", ...APPROVED },
        "shipper",
      ),
    ).toBe(false);
    // And a broker would see the shipper's invoice.
    expect(
      documentReachesAudience(
        { doc_type: "invoice", visibility: "shipper", ...APPROVED },
        "broker",
      ),
    ).toBe(false);
  });

  it("§12's broker band is REAL: exactly BOL, POD and `other`", () => {
    expect([...documentTypesForAudience("broker")]).toEqual([
      "bol",
      "pod",
      "other",
    ]);
    // Which is the whole reason `broker` exists in the enum (plan §4).
    expect(SHIPMENT_DOCUMENT_VISIBILITIES).toContain("broker");
  });
});

/* ------------------------------------------------------------------ *
 * status and visibility — the two narrowing clauses
 * ------------------------------------------------------------------ */

describe("§16 'approved' is a precondition of visibility, not a label", () => {
  for (const status of ["pending", "rejected", "expired"] as const) {
    it(`a ${status} POD reaches NOBODY, not even its own audiences`, () => {
      for (const audience of DOCUMENT_AUDIENCES_ORDER) {
        expect(
          documentReachesAudience(
            { doc_type: "pod", visibility: "shipper", status },
            audience,
          ),
        ).toBe(false);
      }
    });
  }

  it("`visibility: staff_only` overrides the matrix for any type", () => {
    for (const audience of DOCUMENT_AUDIENCES_ORDER) {
      expect(
        documentReachesAudience(
          { doc_type: "bol", visibility: "staff_only", ...APPROVED },
          audience,
        ),
      ).toBe(false);
    }
  });

  it("NON-VACUITY: the same BOL at its default band DOES reach three audiences", () => {
    const reached = DOCUMENT_AUDIENCES_ORDER.filter((a) =>
      documentReachesAudience(
        { doc_type: "bol", visibility: "shipper", ...APPROVED },
        a,
      ),
    );
    expect(reached).toEqual(["shipper", "carrier", "broker"]);
  });

  it("every default `visibility` is itself legal for its type", () => {
    for (const type of SHIPMENT_DOCUMENT_TYPES) {
      expect(legalRowVisibilities(type)).toContain(
        DEFAULT_DOCUMENT_VISIBILITY[type],
      );
    }
  });

  it("a type with NO customer audience defaults to staff_only", () => {
    for (const type of SHIPMENT_DOCUMENT_TYPES) {
      if (DOCUMENT_AUDIENCES[type].length === 0) {
        expect(DEFAULT_DOCUMENT_VISIBILITY[type]).toBe("staff_only");
      }
    }
    expect(DOCUMENT_AUDIENCES.claim).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * The DTO
 * ------------------------------------------------------------------ */

describe("toCustomerDocumentDtos — filter and serialize as one act", () => {
  const ROWS = [
    {
      id: "a",
      doc_type: "bol" as const,
      visibility: "shipper" as const,
      status: "approved" as const,
      file_name: "bol.pdf",
      size_bytes: 1,
      uploaded_at: "2026-09-01T00:00:00.000Z",
      approved_at: "2026-09-01T01:00:00.000Z",
    },
    {
      id: "b",
      doc_type: "rate_confirmation" as const,
      visibility: "carrier" as const,
      status: "approved" as const,
      file_name: "ratecon.pdf",
      size_bytes: 2,
      uploaded_at: "2026-09-02T00:00:00.000Z",
      approved_at: "2026-09-02T01:00:00.000Z",
    },
    {
      id: "c",
      doc_type: "pod" as const,
      visibility: "shipper" as const,
      status: "pending" as const,
      file_name: "pod.jpg",
      size_bytes: 3,
      uploaded_at: "2026-09-03T00:00:00.000Z",
      approved_at: null,
    },
  ];

  it("gives the shipper the BOL only — not the rate con, not the pending POD", () => {
    const dtos = toCustomerDocumentDtos(ROWS, "shipper");
    expect(dtos.map((d) => d.id)).toEqual(["a"]);
  });

  it("gives the carrier the rate confirmation and the BOL", () => {
    const dtos = toCustomerDocumentDtos(ROWS, "carrier");
    expect(dtos.map((d) => d.id).sort()).toEqual(["a", "b"]);
  });

  it("gives the broker the BOL and nothing else", () => {
    expect(toCustomerDocumentDtos(ROWS, "broker").map((d) => d.id)).toEqual(["a"]);
  });

  it("gives the public NOTHING, for any input", () => {
    expect(toCustomerDocumentDtos(ROWS, "public")).toEqual([]);
  });

  /**
   * KEY-SET EQUALITY — the M-70 discipline. Widening the serializer fails
   * here rather than going unnoticed, and `storage_path` in particular is
   * absent at every audience: it is the argument a signed URL is minted from,
   * so a page that had it could ask for a URL to a path it was never shown.
   */
  it("the customer DTO's key set is EXACTLY the approved list", () => {
    const [dto] = toCustomerDocumentDtos(ROWS, "shipper");
    expect(Object.keys(dto!).sort()).toEqual(
      [
        "approved_at",
        "doc_type",
        "doc_type_key",
        "file_name",
        "id",
        "size_bytes",
        "uploaded_at",
      ].sort(),
    );
    expect(Object.keys(dto!)).not.toContain("storage_path");
    expect(Object.keys(dto!)).not.toContain("visibility");
    expect(Object.keys(dto!)).not.toContain("review_note");
    expect(Object.keys(dto!)).not.toContain("uploaded_by");
  });

  it("NON-VACUITY: the same assertion FAILS against a widened object", () => {
    const [dto] = toCustomerDocumentDtos(ROWS, "shipper");
    const widened = { ...dto!, storage_path: "shipment/uuid-bol.pdf" };
    expect(() =>
      expect(Object.keys(widened).sort()).toEqual(
        [
          "approved_at",
          "doc_type",
          "doc_type_key",
          "file_name",
          "id",
          "size_bytes",
          "uploaded_at",
        ].sort(),
      ),
    ).toThrow();
  });

  it("STRUCTURAL GUARD: `documents.ts` never spreads a row into a DTO", () => {
    const src = readFileSync("src/lib/shipments/documents.ts", "utf8").replace(
      /\/\*[\s\S]*?\*\/|\/\/.*$/gm,
      "",
    );
    for (const forbidden of ["...row", "...doc", "delete ", "omit(", ": any", "as unknown as"]) {
      expect(src, `documents.ts contains ${forbidden}`).not.toContain(forbidden);
    }
  });
});

/* ------------------------------------------------------------------ *
 * §13/§14 — who may upload what
 * ------------------------------------------------------------------ */

describe("upload allow-lists (§13, §14)", () => {
  it("§13's driver gets EXACTLY the two documents the directive names", () => {
    expect([...DRIVER_UPLOADABLE_DOC_TYPES]).toEqual(["bol", "pod"]);
  });

  it("a carrier gets BOL, POD and the accessorial evidence only they hold", () => {
    expect([...CARRIER_UPLOADABLE_DOC_TYPES]).toEqual([
      "bol",
      "pod",
      "lumper_receipt",
      "detention_documentation",
      "delivery_receipt",
    ]);
  });

  it("a carrier can NEVER file a document we issue", () => {
    for (const type of ["quote", "shipper_confirmation", "rate_confirmation", "invoice", "claim"] as const) {
      expect(canUpload("carrier", type), type).toBe(false);
      expect(canUpload("driver", type), type).toBe(false);
    }
  });

  it("staff file all eleven §16 types", () => {
    expect([...STAFF_UPLOADABLE_DOC_TYPES]).toEqual([...SHIPMENT_DOCUMENT_TYPES]);
    for (const type of SHIPMENT_DOCUMENT_TYPES) {
      expect(canUpload("staff", type)).toBe(true);
    }
  });

  it("the driver list is a strict subset of the carrier list", () => {
    for (const type of DRIVER_UPLOADABLE_DOC_TYPES) {
      expect(CARRIER_UPLOADABLE_DOC_TYPES).toContain(type);
    }
    expect(DRIVER_UPLOADABLE_DOC_TYPES.length).toBeLessThan(
      CARRIER_UPLOADABLE_DOC_TYPES.length,
    );
  });

  it("every role's list is a real subset of the enum — no invented type", () => {
    for (const [role, types] of Object.entries(UPLOADABLE_DOC_TYPES)) {
      for (const type of types) {
        expect(SHIPMENT_DOCUMENT_TYPES, `${role}/${type}`).toContain(type);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Storage — bucket, cap, paths
 * ------------------------------------------------------------------ */

describe("private storage (§16)", () => {
  it("is its OWN bucket, not a path inside carrier-docs", () => {
    expect(SHIPMENT_DOCS_BUCKET).toBe("shipment-docs");
    expect(SHIPMENT_DOCS_BUCKET).not.toBe("carrier-docs");
  });

  it("migration 0024 creates that bucket PRIVATE", () => {
    const sql = readFileSync(
      "supabase/migrations/0024_shipment_documents.sql",
      "utf8",
    );
    // The insert names the bucket and sets `public` false. `true` must appear
    // nowhere in the bucket insert at all.
    const insert = sql.slice(
      sql.indexOf("insert into storage.buckets"),
      sql.indexOf("on conflict (id) do nothing;"),
    );
    expect(insert).toContain("'shipment-docs'");
    expect(insert).toContain("false");
    expect(insert).not.toMatch(/\btrue\b/);
    expect(insert).toContain("10485760");
  });

  it("0024 does NOT touch the frozen 0004 bucket", () => {
    const sql = readFileSync(
      "supabase/migrations/0024_shipment_documents.sql",
      "utf8",
    );
    const statements = sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements).not.toContain("carrier-docs");
  });

  it("the size cap is the bucket's own cap — one number, not two", () => {
    expect(MAX_SHIPMENT_DOCUMENT_BYTES).toBe(10 * 1024 * 1024);
    // Declared separately from `MAX_UPLOAD_BYTES` because `documents.ts` is a
    // CLIENT-importable module and `uploads.ts` is `server-only`. Pinned here
    // so the two numbers cannot drift.
    expect(MAX_SHIPMENT_DOCUMENT_BYTES).toBe(MAX_UPLOAD_BYTES);
    // …and the bucket's own limit in 0024 is the same number.
    const sql = readFileSync(
      "supabase/migrations/0024_shipment_documents.sql",
      "utf8",
    );
    expect(sql).toContain(String(MAX_SHIPMENT_DOCUMENT_BYTES));
  });

  it("paths are shipment-namespaced AND randomized", () => {
    const path = shipmentDocumentPath(
      "11111111-1111-4111-8111-111111111111",
      "pod.pdf",
      "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    );
    expect(path).toBe(
      "11111111-1111-4111-8111-111111111111/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee-pod.pdf",
    );
    // The prefix is what 0024's CHECK constraint enforces.
    expect(path.startsWith("11111111-1111-4111-8111-111111111111/")).toBe(true);
    // Two uploads of the SAME file name are different objects.
    expect(
      shipmentDocumentPath("s", "pod.pdf", "u1") ===
        shipmentDocumentPath("s", "pod.pdf", "u2"),
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * MIME sniffing (§16, audit S-03) — the check that is not `accept=`
 * ------------------------------------------------------------------ */

describe("magic-byte MIME validation", () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, ...Array(20).fill(0)]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array(20).fill(0)]);
  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(20).fill(0),
  ]);
  const heic = new Uint8Array([
    0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ...Array(12).fill(0),
  ]);

  it("accepts exactly the four types the bucket allows", () => {
    expect(sniffMime(pdf)).toBe("application/pdf");
    expect(sniffMime(jpeg)).toBe("image/jpeg");
    expect(sniffMime(png)).toBe("image/png");
    expect(sniffMime(heic)).toBe("image/heic");
  });

  it("a `.pdf` whose BYTES are a script is refused", () => {
    // `<?php ` — the file a caller would name `pod.pdf` and set
    // `Content-Type: application/pdf` on. Neither is consulted.
    const php = new Uint8Array(
      [...'<?php system($_GET["c"]);'].map((c) => c.charCodeAt(0)),
    );
    expect(sniffMime(php)).toBeNull();
  });

  it("HTML, SVG, ZIP and a bare text file are all refused", () => {
    const bytes = (s: string) =>
      new Uint8Array([...s.padEnd(24, " ")].map((c) => c.charCodeAt(0)));
    expect(sniffMime(bytes("<!DOCTYPE html><html>"))).toBeNull();
    expect(sniffMime(bytes("<svg xmlns='http://x'>"))).toBeNull();
    expect(sniffMime(bytes("PKzipzipzip"))).toBeNull();
    expect(sniffMime(bytes("proof of delivery"))).toBeNull();
  });

  it("a truncated header is refused rather than guessed", () => {
    expect(sniffMime(new Uint8Array([0x25, 0x50, 0x44]))).toBeNull();
    expect(sniffMime(new Uint8Array())).toBeNull();
  });

  it("a PDF magic number LATER in the file does not count", () => {
    const decoy = new Uint8Array([
      0, 0, 0, 0, 0x25, 0x50, 0x44, 0x46, ...Array(20).fill(0),
    ]);
    expect(sniffMime(decoy)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * TTL (§15, S-01)
 * ------------------------------------------------------------------ */

describe("signed-URL TTL", () => {
  it("is the shared 300-second constant, never a literal", () => {
    expect(SIGNED_URL_TTL_SECONDS).toBe(300);
    expect(SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(300);
  });

  it("`document-store.ts` passes the CONSTANT to createSignedUrl", () => {
    const src = readFileSync("src/lib/shipments/document-store.ts", "utf8");
    const calls = [...src.matchAll(/createSignedUrl\(([^)]*)\)/g)];
    expect(calls.length).toBe(1);
    expect(calls[0]![1]).toContain("SIGNED_URL_TTL_SECONDS");
    // NUMERIC LITERALS ARE REJECTED — the plan asked for this test by name.
    expect(calls[0]![1]).not.toMatch(/,\s*\d+/);
  });

  it("NON-VACUITY: the same scan REJECTS a literal TTL", () => {
    const bad = 'createSignedUrl(doc.storage_path, 86400)';
    const calls = [...bad.matchAll(/createSignedUrl\(([^)]*)\)/g)];
    expect(calls[0]![1]).toMatch(/,\s*\d+/);
  });

  it("the signed URL is NEVER written to the audit ledger or a signal", () => {
    const src = readFileSync("src/lib/shipments/document-store.ts", "utf8");
    // The only place `signedUrl` may appear as CODE is the return value; the
    // comments strip out first so the "NEVER log this" note does not count
    // against the rule it is describing.
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const uses = [...code.matchAll(/signed\.signedUrl/g)];
    expect(uses.length).toBe(1);
    expect(code).toContain("url: signed.signedUrl");
    // Not in `detail:` (audit or signal), and not in any console call.
    expect(code).not.toMatch(/detail:\s*\{[^}]*signedUrl/);
    expect(code).not.toMatch(/detail:\s*[^,\n]*signedUrl/);
    expect(code).not.toMatch(/console\.(log|error|warn)\([^)]*signedUrl/);
  });
});

/* ------------------------------------------------------------------ *
 * §25 bounds
 * ------------------------------------------------------------------ */

describe("§25 — document lists are bounded", () => {
  it("has a default page size and a hard ceiling", () => {
    expect(DOCUMENT_PAGE_SIZE).toBe(25);
    expect(DOCUMENT_MAX_PAGE_SIZE).toBe(50);
    expect(DOCUMENT_PAGE_SIZE).toBeLessThanOrEqual(DOCUMENT_MAX_PAGE_SIZE);
  });

  it("clamps a caller-supplied limit rather than trusting it", () => {
    expect(resolveDocumentLimit(10)).toBe(10);
    expect(resolveDocumentLimit(5000)).toBe(DOCUMENT_MAX_PAGE_SIZE);
    expect(resolveDocumentLimit(0)).toBe(DOCUMENT_PAGE_SIZE);
    expect(resolveDocumentLimit(-3)).toBe(DOCUMENT_PAGE_SIZE);
    expect(resolveDocumentLimit(Number.NaN)).toBe(DOCUMENT_PAGE_SIZE);
    expect(resolveDocumentLimit(undefined)).toBe(DOCUMENT_PAGE_SIZE);
    expect(resolveDocumentLimit(7.9)).toBe(7);
  });
});

/* ------------------------------------------------------------------ *
 * §24 — no English document label in the library
 * ------------------------------------------------------------------ */

describe("§24 — document labels are keys, translated ×5", () => {
  const CATALOGUES = { en, es, fr, ru, ht } as const;

  it("`documentTypeKey` is namespaced and distinct per type", () => {
    const keys = SHIPMENT_DOCUMENT_TYPES.map(documentTypeKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key.startsWith("shipment.document.")).toBe(true);
  });

  it("every document type has a NON-EMPTY entry in all five locales", () => {
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      const docs = (catalogue as { shipment: { document: Record<string, string> } })
        .shipment.document;
      for (const type of SHIPMENT_DOCUMENT_TYPES) {
        expect(docs[type], `${locale}/${type}`).toBeTruthy();
        expect(docs[type]!.trim().length, `${locale}/${type}`).toBeGreaterThan(0);
      }
    }
  });

  it("the five catalogues have IDENTICAL key sets for `shipment.document`", () => {
    const keysOf = (c: unknown) =>
      Object.keys(
        (c as { shipment: { document: Record<string, string> } }).shipment.document,
      ).sort();
    const base = keysOf(en);
    for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
      expect(keysOf(catalogue), locale).toEqual(base);
    }
  });

  it("the four non-English catalogues actually DIFFER from English", () => {
    const label = (c: unknown) =>
      (c as { shipment: { document: Record<string, string> } }).shipment.document
        .pod;
    for (const locale of ["es", "fr", "ru", "ht"] as const) {
      expect(label(CATALOGUES[locale]), locale).not.toBe(label(en));
    }
  });
});
