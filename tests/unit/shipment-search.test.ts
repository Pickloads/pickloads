import { describe, expect, it } from "vitest";

import {
  EMPTY_SEARCH,
  parseTrackingSearch,
  searchShipmentsByTrackingNumber,
  SEARCH_LIMIT,
  suffixPattern,
} from "@/lib/shipments/search";
import { SHIPMENT_BOARD_COLUMNS } from "@/lib/shipments/board";
import type { StaffScope } from "@/lib/staff-scope";
import { createRecordingClient } from "./stubs/recording-supabase";

/**
 * M-75 — §5's *"searchable by admin and dispatcher"*.
 *
 * The parser is pure and is tested against the inputs a dispatcher actually
 * produces: a number pasted out of an email client (which mangles the hyphen
 * and adds a non-breaking space), the last digits read over the phone, and
 * hostile values. The query half is asserted over a recording client — scope
 * first, bound always, and no user-supplied wildcard reaching the pattern.
 */

const ADMIN: StaffScope = { carrierIds: null, restricted: false };
const DISPATCHER: StaffScope = { carrierIds: ["c-1"], restricted: true };

describe("parseTrackingSearch — what a dispatcher actually types", () => {
  it("recognises a canonical number as an EXACT lookup", () => {
    const term = parseTrackingSearch("PL-2026-000458");
    expect(term.kind).toBe("exact");
    expect(term.value).toBe("PL-2026-000458");
  });

  it("normalises an email-mangled paste to the same exact lookup (M-70)", () => {
    // en dash + non-breaking space + lower case + surrounding whitespace.
    for (const raw of [
      "  pl 2026 – 000458 ",
      "PL‑2026‑000458",
      "pl-2026-000458",
      "PL 2026 000458",
    ]) {
      const term = parseTrackingSearch(raw);
      expect(term.kind, `${JSON.stringify(raw)} did not normalise`).toBe("exact");
      expect(term.value).toBe("PL-2026-000458");
    }
  });

  it("RECONSTRUCTS a separator-less number into the exact lookup", () => {
    // M-70's normaliser folds separators but does not INSERT them, so these
    // fail its pattern on their own. This is the gap the reconstruction closes.
    for (const raw of ["2026-000458", "2026 000458", "PL 2026 000458", "2026000458"]) {
      const term = parseTrackingSearch(raw);
      expect(term.kind, `${raw} did not reconstruct`).toBe("exact");
      expect(term.value).toBe("PL-2026-000458");
      expect(term.pattern).toBeNull();
    }
  });

  it("treats the digits a customer reads out as a tail pattern", () => {
    expect(parseTrackingSearch("000458")).toMatchObject({
      kind: "pattern",
      value: "000458",
      pattern: "PL%000458",
    });
    expect(parseTrackingSearch("458")).toMatchObject({
      kind: "pattern",
      pattern: "PL%458",
    });
    expect(parseTrackingSearch("no. 000458")).toMatchObject({
      kind: "pattern",
      pattern: "PL%000458",
    });
  });

  it("handles a half-typed number as a year-anchored pattern", () => {
    expect(parseTrackingSearch("PL-2026-0004")).toMatchObject({
      kind: "pattern",
      value: "20260004",
      pattern: "PL-2026-%0004",
    });
  });

  it("refuses a year before the programme existed (M-70's floor)", () => {
    // 2025 predates `shipments`; it is malformed data, not history. Neither
    // the direct parse nor the reconstruction may accept it as an exact key.
    expect(parseTrackingSearch("PL-2025-000458").kind).not.toBe("exact");
    expect(parseTrackingSearch("2025-000458").kind).not.toBe("exact");
    expect(parseTrackingSearch("1999-000458").kind).not.toBe("exact");
  });

  it("issues NO query for empty, whitespace or unusable input", () => {
    for (const raw of ["", "   ", "x", "abc", undefined, null, 42, {}]) {
      expect(parseTrackingSearch(raw).kind).toBe("none");
    }
  });

  it("strips wildcards — `%` and `_` are characters, not 'match anything'", () => {
    // The digit filter cannot leave a wildcard behind at all.
    expect(parseTrackingSearch("%%%%").kind).toBe("none");
    expect(parseTrackingSearch("00%45").value).toBe("0045");
    expect(parseTrackingSearch("00%45").pattern).toBe("PL%0045");
    expect(parseTrackingSearch("__000458__").pattern).toBe("PL%000458");
    expect(suffixPattern("0045")).toBe("PL%0045");
  });

  it("truncates a very long input rather than passing it through", () => {
    const term = parseTrackingSearch("9".repeat(500));
    expect(term.raw.length).toBeLessThanOrEqual(32);
    // 32 digits is outside the 2–10 window, so nothing is queried.
    expect(term.kind).toBe("none");
  });

  it("anchors the suffix pattern on the PL prefix", () => {
    expect(suffixPattern("000458")).toBe("PL%000458");
    expect(suffixPattern("000458")).not.toContain("%000458%");
  });

  it("echoes the raw input back for the form, trimmed", () => {
    expect(parseTrackingSearch("  PL-2026-000458  ").raw).toBe("PL-2026-000458");
  });
});

describe("searchShipmentsByTrackingNumber — the query half", () => {
  it("runs no query at all for unusable input", async () => {
    const { client, recorder } = createRecordingClient();
    const result = await searchShipmentsByTrackingNumber(
      client as never,
      "!!!",
      ADMIN,
      "u-1",
    );
    expect(recorder.queries).toHaveLength(0);
    expect(result.searched).toBe(false);
    expect(result).toMatchObject({ rows: [], failed: false });
  });

  it("uses an EQUALITY on the unique index for an exact number", async () => {
    const { client, recorder } = createRecordingClient({ shipments: { data: [] } });
    await searchShipmentsByTrackingNumber(
      client as never,
      "PL-2026-000458",
      ADMIN,
      "u-1",
    );
    const calls = recorder.forTable("shipments")[0]!.calls;
    expect(calls.some((c) => c.method === "eq" && c.args[0] === "tracking_number")).toBe(
      true,
    );
    expect(calls.some((c) => c.method === "ilike")).toBe(false);
  });

  it("uses a bounded ilike for a suffix", async () => {
    const { client, recorder } = createRecordingClient({ shipments: { data: [] } });
    await searchShipmentsByTrackingNumber(client as never, "000458", ADMIN, "u-1");
    const calls = recorder.forTable("shipments")[0]!.calls;
    const ilike = calls.find((c) => c.method === "ilike");
    expect(ilike?.args).toEqual(["tracking_number", "PL%000458"]);
    const limit = recorder.callsOf("limit")[0];
    expect(limit?.args[0]).toBe(SEARCH_LIMIT);
  });

  it("APPLIES THE §19 DISPATCHER SCOPE — search is not the hole in the model", async () => {
    const { client, recorder } = createRecordingClient({ shipments: { data: [] } });
    await searchShipmentsByTrackingNumber(
      client as never,
      "PL-2026-000458",
      DISPATCHER,
      "u-1",
    );
    const calls = recorder.forTable("shipments")[0]!.calls;
    const or = calls.find((c) => c.method === "or");
    expect(or?.args[0]).toBe("dispatcher_id.eq.u-1,carrier_id.in.(c-1)");
    // …and the scope predicate comes BEFORE the tracking-number predicate.
    expect(calls.findIndex((c) => c.method === "or")).toBeLessThan(
      calls.findIndex((c) => c.method === "eq"),
    );
  });

  it("applies no scope for an admin — the non-vacuity control", async () => {
    const { client, recorder } = createRecordingClient({ shipments: { data: [] } });
    await searchShipmentsByTrackingNumber(
      client as never,
      "PL-2026-000458",
      ADMIN,
      "u-1",
    );
    expect(recorder.callsOf("or")).toHaveLength(0);
  });

  it("uses the lean board projection — no §18 financial column", async () => {
    const { client, recorder } = createRecordingClient({ shipments: { data: [] } });
    await searchShipmentsByTrackingNumber(client as never, "000458", ADMIN, "u-1");
    expect(recorder.forTable("shipments")[0]!.columns).toBe(SHIPMENT_BOARD_COLUMNS);
    for (const banned of ["margin", "carrier_pay", "public_access_hash"]) {
      expect(SHIPMENT_BOARD_COLUMNS).not.toContain(banned);
    }
  });

  it("reports a failed read as FAILED, never as 'no results'", async () => {
    const { client } = createRecordingClient({
      shipments: { data: null, error: { message: "boom" } },
    });
    const result = await searchShipmentsByTrackingNumber(
      client as never,
      "PL-2026-000458",
      ADMIN,
      "u-1",
    );
    expect(result.failed).toBe(true);
    expect(result.searched).toBe(true);
    expect(result.rows).toEqual([]);
  });

  it("flags truncation when the bound is hit", async () => {
    const rows = Array.from({ length: SEARCH_LIMIT }, (_, i) => ({ id: `s-${i}` }));
    const { client } = createRecordingClient({ shipments: { data: rows } });
    const result = await searchShipmentsByTrackingNumber(
      client as never,
      "0458",
      ADMIN,
      "u-1",
    );
    expect(result.truncated).toBe(true);
  });

  it("EMPTY_SEARCH is inert — nothing searched, nothing failed", () => {
    expect(EMPTY_SEARCH).toMatchObject({
      searched: false,
      failed: false,
      truncated: false,
      rows: [],
    });
  });
});
