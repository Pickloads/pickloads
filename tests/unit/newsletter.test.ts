import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  isUnsubscribeSuccess,
  marketingUnsubscribeHeaders,
  normalizeUnsubscribeToken,
  oneClickUnsubscribeUrl,
  ONE_CLICK_BODY,
  ONE_CLICK_POST_HEADER,
  UNSUBSCRIBE_API_PATH,
  UNSUBSCRIBE_PATH,
  unsubscribeUrl,
} from "@/lib/newsletter";

/**
 * M-69 / P-1 — newsletter unsubscribe.
 *
 * Guards the two properties that make the flow legally and operationally
 * correct: the token is unguessable and strictly validated, and the state
 * change is idempotent.
 */

const TOKEN = "3f2b1c7e-9a41-4d2b-8e77-0c5a1d9f4b62";

describe("unsubscribe token validation", () => {
  it("accepts a well-formed UUID and canonicalises case", () => {
    expect(normalizeUnsubscribeToken(TOKEN)).toBe(TOKEN);
    expect(normalizeUnsubscribeToken(TOKEN.toUpperCase())).toBe(TOKEN);
    expect(normalizeUnsubscribeToken(`  ${TOKEN}  `)).toBe(TOKEN);
  });

  it("rejects everything that is not a UUID", () => {
    // An email address must never work as a token — that would turn the
    // endpoint into an unsubscribe-anyone weapon and an address oracle.
    expect(normalizeUnsubscribeToken("someone@example.com")).toBeNull();
    expect(normalizeUnsubscribeToken("")).toBeNull();
    expect(normalizeUnsubscribeToken("   ")).toBeNull();
    expect(normalizeUnsubscribeToken(null)).toBeNull();
    expect(normalizeUnsubscribeToken(undefined)).toBeNull();
    expect(normalizeUnsubscribeToken(42)).toBeNull();
    expect(normalizeUnsubscribeToken(["a", "b"])).toBeNull();
    // Truncated / over-long / SQL-ish variants.
    expect(normalizeUnsubscribeToken(TOKEN.slice(0, 20))).toBeNull();
    expect(normalizeUnsubscribeToken(`${TOKEN}'--`)).toBeNull();
    expect(normalizeUnsubscribeToken("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("unsubscribe URLs", () => {
  it("builds page and one-click URLs on the documented paths", () => {
    expect(unsubscribeUrl("https://pickloads.com", TOKEN)).toBe(
      `https://pickloads.com${UNSUBSCRIBE_PATH}?token=${TOKEN}`,
    );
    expect(oneClickUnsubscribeUrl("https://pickloads.com/", TOKEN)).toBe(
      `https://pickloads.com${UNSUBSCRIBE_API_PATH}?token=${TOKEN}`,
    );
  });

  it("never puts an email address in the URL", () => {
    const url = unsubscribeUrl("https://pickloads.com", TOKEN);
    expect(url).not.toContain("@");
  });
});

describe("RFC 8058 headers", () => {
  it("emits the required pair, with the URI first and a mailto fallback", () => {
    const headers = marketingUnsubscribeHeaders({
      siteUrl: "https://pickloads.com",
      token: TOKEN,
      mailto: "support@pickloads.com",
    });
    expect(headers["List-Unsubscribe"]).toBe(
      `<https://pickloads.com${UNSUBSCRIBE_API_PATH}?token=${TOKEN}>, <mailto:support@pickloads.com?subject=unsubscribe>`,
    );
    // Without this header the URI is treated as an ordinary link and Gmail /
    // Yahoo bulk-sender one-click is NOT satisfied.
    expect(headers["List-Unsubscribe-Post"]).toBe(ONE_CLICK_POST_HEADER);
    expect(ONE_CLICK_BODY).toBe("List-Unsubscribe=One-Click");
  });
});

describe("outcome vocabulary", () => {
  it("treats an already-unsubscribed address as SUCCESS", () => {
    // Idempotency: providers and link scanners replay the POST. A repeat
    // must not look like a failed opt-out.
    expect(isUnsubscribeSuccess("unsubscribed")).toBe(true);
    expect(isUnsubscribeSuccess("already")).toBe(true);
    expect(isUnsubscribeSuccess("invalid")).toBe(false);
    expect(isUnsubscribeSuccess("unavailable")).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Idempotency + honest-degradation of the write path, with the admin
 * client stubbed. Proves: second apply → "already" (no second UPDATE),
 * unknown token → "invalid", no service-role key → "unavailable".
 * ------------------------------------------------------------------ */

interface FakeRow {
  id: string;
  email: string;
  unsubscribe_token: string;
  unsubscribed_at: string | null;
}

const state: { rows: FakeRow[]; hasAdmin: boolean; updates: number } = {
  rows: [],
  hasAdmin: true,
  updates: 0,
};

vi.mock("@/lib/supabase/admin", () => ({
  tryCreateAdminClient: () => {
    if (!state.hasAdmin) return null;
    return {
      from: () => {
        let matched: FakeRow | undefined;
        const builder = {
          select: () => builder,
          eq: (column: string, value: string) => {
            matched = state.rows.find(
              (r) =>
                (column === "unsubscribe_token" &&
                  r.unsubscribe_token === value) ||
                (column === "id" && r.id === value),
            );
            return builder;
          },
          maybeSingle: async () => ({ data: matched ?? null, error: null }),
          update: (patch: Partial<FakeRow>) => ({
            eq: async (_c: string, id: string) => {
              const row = state.rows.find((r) => r.id === id);
              if (row) {
                Object.assign(row, patch);
                state.updates += 1;
              }
              return { error: null };
            },
          }),
        };
        return builder;
      },
    };
  },
}));

const { applyUnsubscribe, lookupUnsubscribe, maskEmail } = await import(
  "@/lib/newsletter-unsubscribe"
);

describe("unsubscribe write path", () => {
  beforeEach(() => {
    state.rows = [
      {
        id: "row-1",
        email: "driver@fleet.example",
        unsubscribe_token: TOKEN,
        unsubscribed_at: null,
      },
    ];
    state.hasAdmin = true;
    state.updates = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("unsubscribes once, then reports `already` without writing again", async () => {
    expect(await applyUnsubscribe(TOKEN)).toBe("unsubscribed");
    expect(state.rows[0]?.unsubscribed_at).not.toBeNull();
    expect(state.updates).toBe(1);

    expect(await applyUnsubscribe(TOKEN)).toBe("already");
    expect(await applyUnsubscribe(TOKEN)).toBe("already");
    expect(state.updates).toBe(1); // no repeat UPDATE
  });

  it("returns `invalid` for an unknown or malformed token", async () => {
    expect(await applyUnsubscribe("11111111-2222-4333-8444-555555555555")).toBe(
      "invalid",
    );
    expect(await applyUnsubscribe("not-a-token")).toBe("invalid");
    expect(state.updates).toBe(0);
  });

  it("returns `unavailable` — never a fake success — without a service-role key", async () => {
    state.hasAdmin = false;
    expect(await applyUnsubscribe(TOKEN)).toBe("unavailable");
    expect(state.rows[0]?.unsubscribed_at).toBeNull();
  });

  it("lookup is READ-ONLY (the GET page must not unsubscribe)", async () => {
    const result = await lookupUnsubscribe(TOKEN);
    expect(result).not.toBe("invalid");
    expect(state.updates).toBe(0);
    expect(state.rows[0]?.unsubscribed_at).toBeNull();
    if (typeof result !== "string") {
      expect(result.alreadyUnsubscribed).toBe(false);
      // Masked, so a forwarded link does not disclose the full address.
      expect(result.maskedEmail).not.toBe("driver@fleet.example");
      expect(result.maskedEmail).toContain("@fleet.example");
    }
  });
});

describe("maskEmail", () => {
  it("keeps the domain and the shape, hides the local part", () => {
    expect(maskEmail("driver@fleet.example")).toBe("d••••r@fleet.example");
    expect(maskEmail("ab@x.test")).toBe("a•@x.test");
    expect(maskEmail("broken")).toBe("•••");
  });
});
