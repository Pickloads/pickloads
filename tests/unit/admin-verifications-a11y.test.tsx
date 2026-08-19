// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import axe from "axe-core";

import messages from "../../messages/en.json";
import { emitHarness, harnessWritten } from "../harness/emit";
import {
  CarrierVerificationQueueView,
  type LegacyRow,
  type QueueRow,
} from "@/components/portal/CarrierVerificationQueueView";
import {
  CarrierVerificationDetailView,
  type VerificationCheck,
  type VerificationDetail,
} from "@/components/portal/CarrierVerificationDetailView";

/**
 * M-99 — the admin verification surfaces, structurally.
 *
 * ── WHAT THIS FILE PROVES, AND WHAT IT DELIBERATELY DOES NOT ─────────────
 *
 * jsdom applies no stylesheet, so nothing here can see a divider, a margin or
 * an overflow. What it CAN prove is the markup: that labels are associated
 * with values, that headings nest, that axe finds no violation, and that the
 * layout vocabulary the CSS keys off is actually present — `.pdl` for
 * label/value pairs rather than `.ptable`, `.pcard` rather than
 * `.ptable-wrap`, `.phelp` for helper text, `.pactions` for button rows.
 *
 * The GEOMETRY — no text on a divider, no horizontal overflow, long values
 * wrapping, the action row usable at 320px — is measured in a real layout
 * engine by `tests/e2e/admin-responsive-a11y.spec.ts`, from the fixtures this
 * file emits. That split is M-82's, and its reasoning holds here: six modules
 * once shipped "accessible" surfaces proven only in jsdom, and the first time
 * they met a real stylesheet they were full of overflow.
 */

/* The review form binds to a server action, and that module pulls
 * `server-only` transitively through the auth path. Stubbing the ACTION keeps
 * the real markup — which is what axe scans and what the harness emits. The
 * broker/carrier a11y suites do the same. */
/* next-intl navigation — the views use `Link`; jsdom has no router. Same stub
 * as the dispatcher and carrier a11y suites, so the rendered anchor is the
 * anchor axe scans and the harness emits. */
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => "/portal/admin/carrier-verifications",
  getPathname: ({ href }: { href: string }) => href,
}));

vi.mock("@/app/actions/carrier-review", () => ({
  reviewCarrierPreRegistration: () =>
    Promise.resolve({ status: "idle" as const }),
}));
vi.mock("@/app/actions/carrier-legacy", () => ({
  adoptLegacyCarrier: () => Promise.resolve({ status: "idle" as const }),
}));

/** A fixed clock, so a fixture renders identically on every run. */
const NOW = Date.parse("2026-08-20T12:00:00.000Z");
const iso = (offsetDays: number) =>
  new Date(NOW + offsetDays * 24 * 60 * 60 * 1000).toISOString();

/**
 * Deliberately awkward data. A short name proves nothing about wrapping; the
 * values below are the ones that actually break layouts — a 64-character
 * legal name, a full SHA-256 digest, an email longer than its column.
 */
const LONG_NAME =
  "Transcontinental Heavy Haul & Specialized Logistics Group Holdings LLC";
const LONG_EMAIL = "compliance.department.operations@transcontinental-heavy-haul.example";

const QUEUE_ROWS: QueueRow[] = [
  {
    id: "11111111-2222-4333-8444-555555555555",
    createdAt: iso(-2),
    legalNameEntered: LONG_NAME,
    usdotNumberEntered: "3300001",
    mcNumberEntered: "660001",
    email: LONG_EMAIL,
    decision: "manual_review",
    verificationStatus: "provider_unavailable",
    reasonCodes: [
      "PROVIDER_UNAVAILABLE",
      "INSURANCE_REVIEW_REQUIRED",
      "MC_DOT_RELATIONSHIP_UNVERIFIED",
    ],
    expiresAt: iso(28),
    claimedCarrierId: null,
  },
  {
    id: "22222222-2222-4333-8444-555555555555",
    createdAt: iso(-9),
    legalNameEntered: "Storatech",
    usdotNumberEntered: "6573345",
    mcNumberEntered: null,
    email: "ops@storatech.example",
    decision: "manual_review",
    verificationStatus: "manual_review",
    reasonCodes: ["LEGAL_NAME_MISMATCH", "MC_NOT_PROVIDED"],
    expiresAt: iso(-1),
    claimedCarrierId: null,
  },
];

const LEGACY_ROWS: LegacyRow[] = [
  {
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    companyName: "Old Applicant Freight Company Of Northern New Jersey LLC",
    mcNumber: null,
    dotNumber: null,
    createdAt: iso(-120),
  },
];

const DETAIL: VerificationDetail = {
  id: "11111111-2222-4333-8444-555555555555",
  createdAt: iso(-2),
  expiresAt: iso(28),
  legalNameEntered: LONG_NAME,
  usdotNumberEntered: "3300001",
  mcNumberEntered: "660001",
  email: LONG_EMAIL,
  phone: "(908) 555-0142",
  decision: "manual_review",
  verificationStatus: "provider_unavailable",
  riskTier: "manual_review",
  reasonCodes: [
    "PROVIDER_UNAVAILABLE",
    "INSURANCE_REVIEW_REQUIRED",
    "CREDIT_CHECK_NOT_CONFIGURED",
    "MC_DOT_RELATIONSHIP_UNVERIFIED",
  ],
  paymentStatus: "unpaid",
  claimedCarrierId: null,
  claimedAt: null,
  reviewedAt: null,
  reviewNote: null,
  reviewerName: null,
};

const CHECK: VerificationCheck = {
  legalName: "TRANSCONTINENTAL HEAVY HAUL & SPECIALIZED LOGISTICS GROUP LLC",
  dbaName: null,
  usdotNumber: "3300001",
  mcNumber: "660001",
  allowedToOperate: null,
  outOfService: null,
  outOfServiceDate: null,
  nameMatch: "mismatch",
  mcMatch: "unavailable",
  dotMatch: "exact",
  rawResponseSha256: "a3f1".repeat(16),
  checkedAt: iso(-2),
  sourceRetrievedAt: iso(-2),
};

function renderWith(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <div className="portal">
        <div className="pmain">{ui}</div>
      </div>
    </NextIntlClientProvider>,
  );
}

const renderQueue = (over: Partial<React.ComponentProps<typeof CarrierVerificationQueueView>> = {}) =>
  renderWith(
    <CarrierVerificationQueueView
      rows={QUEUE_ROWS}
      legacy={LEGACY_ROWS}
      showAll={false}
      failed={false}
      now={NOW}
      {...over}
    />,
  );

const renderDetail = (
  over: Partial<React.ComponentProps<typeof CarrierVerificationDetailView>> = {},
) =>
  renderWith(
    <CarrierVerificationDetailView
      pre={DETAIL}
      latest={CHECK}
      now={NOW}
      {...over}
    />,
  );

async function violations(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
  });
  return results.violations.map((v) => `${v.id}: ${v.nodes.length}`);
}

afterEach(cleanup);

/* ── The layout vocabulary is actually present ──────────────────────────── */

describe("the surfaces use the portal's layout vocabulary", () => {
  it("every label/value pair is a row that owns its own divider", () => {
    // M-100. The old markup put `border-top` on the `dt` AND on the `dd` of a
    // grid with `align-items:baseline` — two boxes at two different Y values,
    // so each row drew two rules a few pixels apart and the columns visibly
    // disagreed. The fix is structural: one wrapper per pair, and the CSS
    // draws `.drow + .drow`. This asserts the structure that makes that
    // possible, because without it the stylesheet has nothing to hang a
    // single full-width divider on.
    const { container } = renderDetail();
    const lists = container.querySelectorAll("dl.dlist");
    expect(lists.length).toBeGreaterThanOrEqual(3);
    for (const dl of lists) {
      for (const child of dl.children) {
        expect(child.tagName, "a dl.dlist child is not a .drow").toBe("DIV");
        expect(child.className).toContain("drow");
        const kids = [...child.children].map((c) => c.tagName);
        expect(kids, "a .drow is not exactly one dt + one dd").toEqual([
          "DT",
          "DD",
        ]);
      }
    }
    // No dt or dd may sit loose in a list: that is the shape that produced
    // the misaligned pair of rules.
    for (const el of container.querySelectorAll("dl.dlist > dt, dl.dlist > dd")) {
      throw new Error(`loose ${el.tagName} directly inside a dl.dlist`);
    }
  });

  it("never uses .ptable for non-tabular detail rows", () => {
    // The defect this replaced: a data grid gives each row a border-bottom
    // sized for one line, so a wrapped value crowds the divider.
    const { container } = renderDetail();
    expect(container.querySelectorAll("table.ptable")).toHaveLength(0);
  });

  it("never uses .ptable-wrap as a generic card", () => {
    // `.ptable-wrap` is a scroller with padding:0. Anything but a table put
    // inside it sits flush against its border.
    for (const { container } of [renderDetail(), renderQueue()]) {
      for (const wrap of container.querySelectorAll(".ptable-wrap")) {
        const kids = [...wrap.children];
        expect(
          kids.every((k) => k.tagName === "TABLE"),
          ".ptable-wrap contains something other than a table",
        ).toBe(true);
      }
      cleanup();
    }
  });

  it("uses .a-hint for helper text and .a-actions for button rows", () => {
    const { container } = renderDetail();
    expect(container.querySelectorAll(".a-hint").length).toBeGreaterThan(0);
    expect(container.querySelectorAll(".a-actions").length).toBeGreaterThan(0);
    // The marketing display heading has no business in the portal.
    expect(container.querySelectorAll("h2.sec")).toHaveLength(0);
  });

  it("groups the page-bar badges so they can wrap as a unit", () => {
    const { container } = renderDetail();
    const bar = container.querySelector(".a-head")!;
    const badges = bar.querySelector(".a-badges")!;
    expect(badges).toBeTruthy();
    expect(badges.querySelectorAll(".a-badge").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps monospace for identifiers only", () => {
    const { container } = renderDetail();
    const mono = [...container.querySelectorAll("dd.is-id")].map(
      (n) => n.textContent ?? "",
    );
    // USDOT, MC, the two on-record numbers and the digest — never prose.
    expect(mono.length).toBeGreaterThanOrEqual(4);
    for (const text of mono) {
      expect(text.split(/\s+/).filter(Boolean).length).toBeLessThan(14);
    }
  });
});

/* ── Structure and semantics ────────────────────────────────────────────── */

describe("headings and landmarks", () => {
  it("the detail view has one h1 and no skipped level", () => {
    const { container } = renderDetail();
    const levels = [...container.querySelectorAll("h1,h2,h3")].map((h) =>
      Number(h.tagName[1]),
    );
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
    }
  });

  it("the queue's table has real column headers", () => {
    const { container } = renderQueue();
    const table = container.querySelector("table.ptable")!;
    const heads = [...table.querySelectorAll("thead th")];
    expect(heads.length).toBeGreaterThan(0);
    for (const th of heads) expect(th.getAttribute("scope")).toBe("col");
  });

  it("the reviewer note is labelled and describes its own requirement", () => {
    const { container } = renderDetail();
    const note = container.querySelector("#review-note") as HTMLTextAreaElement;
    expect(note).toBeTruthy();
    expect(container.querySelector('label[for="review-note"]')).toBeTruthy();
    // The permanent-record warning is the field's DESCRIPTION, so it is
    // announced with the field rather than floating near it.
    const describedBy = note.getAttribute("aria-describedby")!;
    const hint = container.querySelector(`#${describedBy}`)!;
    expect(hint.className).toContain("a-hint");
    expect(hint.textContent).toMatch(/permanent record/i);
  });

  it("the two decisions say what they do in words, not by colour", () => {
    renderDetail();
    const clear = screen.getByRole("button", { name: /clear to continue/i });
    const refuse = screen.getByRole("button", { name: /mark not eligible/i });
    expect(clear.getAttribute("value")).toBe("clear");
    expect(refuse.getAttribute("value")).toBe("refuse");
  });

  it("status badges carry text, so colour is never the only signal", () => {
    const { container } = renderQueue();
    for (const badge of container.querySelectorAll(".pbadge, .a-badge")) {
      expect((badge.textContent ?? "").trim().length).toBeGreaterThan(2);
    }
  });

  it("reason codes pair a sentence with the machine name", () => {
    const { container } = renderDetail();
    const items = [...container.querySelectorAll(".a-reasons li")];
    expect(items.length).toBe(DETAIL.reasonCodes.length);
    for (const li of items) {
      expect(within(li as HTMLElement).getByText(/[a-z]/)).toBeTruthy();
      expect(li.querySelector(".a-code")?.textContent).toMatch(/^[A-Z_]+$/);
    }
  });

  it("no information was dropped in the re-layout", () => {
    const { container } = renderDetail();
    const text = container.textContent ?? "";
    for (const expected of [
      DETAIL.legalNameEntered,
      DETAIL.usdotNumberEntered,
      "MC-660001",
      DETAIL.email,
      "(908) 555-0142",
      CHECK.legalName!,
      "MISMATCH",
      // M-100 renders the two enums through the badge maps in
      // `review-labels.ts` — `unpaid` -> "Unpaid", `manual_review` ->
      // "Manual review". The information is the same information; showing a
      // database enum verbatim was the defect. Asserting the LABEL keeps this
      // test doing its job, which is proving nothing vanished.
      "Unpaid",
      "Manual review",
    ]) {
      expect(text, `missing: ${expected}`).toContain(expected);
    }
    // And the digest is still truncated, never whole.
    expect(text).not.toContain(CHECK.rawResponseSha256);
  });
});

/* ── axe ────────────────────────────────────────────────────────────────── */

describe("axe finds no WCAG A/AA violation", () => {
  it("queue", async () => {
    const { container } = renderQueue();
    expect(await violations(container)).toEqual([]);
  });

  it("queue — empty", async () => {
    const { container } = renderQueue({ rows: [], legacy: [] });
    expect(await violations(container)).toEqual([]);
  });

  it("queue — failed read", async () => {
    const { container } = renderQueue({ rows: [], legacy: [], failed: true });
    expect(await violations(container)).toEqual([]);
  });

  it("detail", async () => {
    const { container } = renderDetail();
    expect(await violations(container)).toEqual([]);
  });

  it("detail — no FMCSA check on record", async () => {
    const { container } = renderDetail({ latest: null });
    expect(await violations(container)).toEqual([]);
  });

  it("detail — already reviewed and onboarded", async () => {
    const { container } = renderDetail({
      pre: {
        ...DETAIL,
        decision: "eligible_to_continue",
        claimedCarrierId: "carrier-1",
        claimedAt: iso(-1),
        reviewedAt: iso(-1),
        reviewNote: "Called FMCSA and confirmed the docket by hand.",
        reviewerName: "Dana",
      },
    });
    expect(await violations(container)).toEqual([]);
  });
});

/* ── Fixtures for the browser lane ──────────────────────────────────────── */

const FIXTURES = [
  "admin-verifications-queue",
  "admin-verifications-queue-empty",
  "admin-verifications-detail",
  "admin-verifications-detail-reviewed",
] as const;

describe("the browser harness", () => {
  it("emits every admin fixture the responsive lane measures", () => {
    emitHarness("admin-verifications-queue", "portal", renderQueue().container);
    cleanup();
    emitHarness(
      "admin-verifications-queue-empty",
      "portal",
      renderQueue({ rows: [], legacy: [] }).container,
    );
    cleanup();
    emitHarness("admin-verifications-detail", "portal", renderDetail().container);
    cleanup();
    emitHarness(
      "admin-verifications-detail-reviewed",
      "portal",
      renderDetail({
        pre: {
          ...DETAIL,
          decision: "eligible_to_continue",
          reviewedAt: iso(-1),
          reviewNote:
            "Checked the docket by hand against FMCSA and confirmed the operating authority is active.",
          reviewerName: "Dana Whitfield",
        },
      }).container,
    );
    cleanup();

    // A silently-skipped write must fail HERE, not three minutes later in the
    // browser lane with a confusing "file not found".
    expect(harnessWritten(FIXTURES)).toBe(true);
  });
});
