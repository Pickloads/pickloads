/**
 * M-84 — §27 of `docs/DIRECTIVE-tracking.md`, as data.
 *
 * ── THE PROBLEM THIS SOLVES ───────────────────────────────────────────────
 *
 * §27 names 8 unit tests, 11 integration tests, 5 end-to-end flows (with 31
 * named steps between them) and 6 pages × 5 viewports of responsive checks.
 * By M-83 all of them had been written, spread across four lanes and twenty
 * files. What did NOT exist was any machine-checkable link between the
 * directive's words and the assertions that honour them.
 *
 * That gap is where test suites rot. A renamed `it(...)`, a deleted case, a
 * file split in two — each is individually harmless and collectively turns
 * "§27 is covered" into a claim nobody can check without re-reading the
 * directive against twenty files. A module doc that says "see the test suite"
 * is not evidence; it is a promise that ages badly.
 *
 * So the mapping lives here, in code, and `tests/unit/section-27-coverage.
 * test.ts` proves every binding still resolves to a test that exists. Rename
 * a test and the build fails with the requirement it was covering — which is
 * the moment to decide whether the coverage moved or was lost.
 *
 * ── WHAT A BINDING CLAIMS, AND WHAT IT DOES NOT ───────────────────────────
 *
 * A binding claims: *this file contains a test with exactly this title, and
 * that test is where this requirement is honoured*. It does not claim the
 * test is correct — no index can. The non-vacuity discipline for that lives
 * inside the tests themselves (injection controls, sentinel sweeps, key-set
 * equality), and the coverage test proves only that the index is not lying
 * about what exists.
 *
 * `caveat` is load-bearing and deliberately not optional-by-convention: where
 * the covering test proves something NARROWER than the directive's sentence,
 * the difference is written down. An index whose entries all claimed perfect
 * coverage would be the more comfortable artefact and the less honest one.
 */

export interface CoverageBinding {
  /** The directive's own words, verbatim where they are short enough. */
  requirement: string;
  /** Repo-relative path of the file that proves it. */
  file: string;
  /**
   * The exact `it(...)` / `test(...)` / `describe(...)` title in that file.
   * Matched literally by `tests/unit/section-27-coverage.test.ts`.
   */
  title: string;
  /** Where the proof is narrower than the sentence, say so here. */
  caveat?: string;
}

export interface CoverageFlow {
  /** §27's name for the flow. */
  flow: string;
  /** Its named steps, in the directive's order. */
  steps: CoverageBinding[];
}

/* ================================================================== *
 * §27 · Unit tests — the eight the directive names
 * ================================================================== */

export const SECTION_27_UNIT: readonly CoverageBinding[] = [
  {
    requirement: "tracking-number generation",
    file: "tests/unit/shipment-tracking-number.test.ts",
    title: "throws rather than minting a number the CHECK constraint would reject",
  },
  {
    requirement: "public DTO serializer",
    file: "tests/unit/shipment-dto.test.ts",
    title: "equals the approved allow-list exactly",
  },
  {
    requirement: "status transitions",
    file: "tests/unit/shipment-transitions.test.ts",
    title: "refuses EVERY edge the graph does not declare",
  },
  {
    requirement: "ETA formatting",
    file: "tests/unit/shipment-eta-estimate.test.ts",
    title: "reports every assumption as data, so no surface has to spell it twice",
    caveat:
      "§27 says 'formatting'; what is proved is the ESTIMATOR and the assumption " +
      "record it publishes. §30 forbids an ETA whose method is not stated, so the " +
      "method is the part worth pinning — the rendering is covered by the a11y " +
      "suites, which read the label out of the DOM.",
  },
  {
    requirement: "event visibility",
    file: "tests/unit/shipment-dto.test.ts",
    title: "matches the audience matrix for every band",
  },
  {
    requirement: "permission helpers",
    file: "tests/unit/shipment-broker-permissions.test.ts",
    title: "covers EVERY ShipmentRow column — a new column cannot be undecided",
  },
  {
    requirement: "access-code verification",
    file: "tests/unit/shipment-access-code.test.ts",
    title: "is KEYED — the same value under a different secret is a different hash",
  },
  {
    requirement: "notification deduplication",
    file: "tests/unit/shipment-notifications.test.tsx",
    title: "narrows the two ambiguous producers by metadata containment",
    caveat:
      "The TypeScript half. The dedupe that actually protects a customer's inbox " +
      "is the idempotency key in the database, proved in " +
      "tests/integration/shipment-notifications.test.ts ('re-running the harvest " +
      "over the same events enqueues NOTHING new').",
  },
] as const;

/* ================================================================== *
 * §27 · Integration tests — the eleven the directive names
 * ================================================================== */

export const SECTION_27_INTEGRATION: readonly CoverageBinding[] = [
  {
    requirement: "create shipment",
    file: "tests/integration/dispatcher-operations.test.ts",
    title: "writes the shipment AND its shipment_created event in one call",
  },
  {
    requirement: "assign carrier",
    file: "tests/integration/dispatcher-operations.test.ts",
    title: "2 · assigns a carrier, a driver and a truck — atomically",
  },
  {
    requirement: "create shipment event",
    file: "tests/integration/dispatcher-operations.test.ts",
    title: "keeps a public update and an internal note in DIFFERENT bands and columns",
  },
  {
    requirement: "update status",
    file: "tests/integration/dispatcher-operations.test.ts",
    title: "3 · walks the pickup statuses through the engine",
  },
  {
    requirement: "public tracking lookup",
    file: "tests/integration/public-tracking.test.ts",
    title: "returns the strict public DTO for a correct number + ZIP",
  },
  {
    requirement: "shipper portal lookup",
    file: "tests/integration/shipper-shipments.test.ts",
    title: "the real list query runs against the real schema and returns the tenant's rows",
  },
  {
    requirement: "carrier update",
    file: "tests/integration/carrier-driver-updates.test.ts",
    title: "walks §13's action list from dispatch to delivered, through the engine",
  },
  {
    requirement: "document upload",
    file: "tests/integration/shipment-documents.test.ts",
    title: "files a document AND its §7 event in one call",
  },
  {
    requirement: "POD upload",
    file: "tests/integration/shipment-documents.test.ts",
    title: "REGRESSION TO GREEN: approve the POD and `pod_uploaded` SUCCEEDS",
  },
  {
    requirement: "notification generation",
    file: "tests/integration/shipment-notifications.test.ts",
    title: "harvests a milestone status change into BOTH channels",
  },
  {
    requirement: "exception creation and resolution",
    file: "tests/integration/shipment-eta-exceptions.test.ts",
    title: "opens the ROW and the EVENT in one call, and links them",
  },
] as const;

/* ================================================================== *
 * §27 · E2E flows — five flows, thirty-one named steps
 * ================================================================== */

export const SECTION_27_FLOWS: readonly CoverageFlow[] = [
  {
    flow: "Shipper flow",
    steps: [
      {
        requirement: "Login",
        file: "tests/integration/tracking-flows.test.ts",
        title: "1 · LOGIN — the session resolves to exactly one shipper organization",
        caveat:
          "The DB half — `my_shipper_ids()` resolving from a real JWT claim. " +
          "Supabase Auth itself (GoTrue) is not in any lane; the browser half " +
          "is the login bounce asserted in tests/e2e/tracking-flows.spec.ts.",
      },
      {
        requirement: "View shipments",
        file: "tests/integration/tracking-flows.test.ts",
        title: "2 · VIEW SHIPMENTS — the list returns the tenant's freight and its ids",
      },
      {
        requirement: "Open shipment",
        file: "tests/integration/tracking-flows.test.ts",
        title: "3 · OPEN SHIPMENT — the id from step 2 opens a detail the page can render",
      },
      {
        requirement: "View timeline",
        file: "tests/integration/tracking-flows.test.ts",
        title: "4 · VIEW TIMELINE — the shipment's own history, in the shipper's two bands",
      },
      {
        requirement: "Download POD",
        file: "tests/integration/tracking-flows.test.ts",
        title:
          "5 · DOWNLOAD POD — the approved POD is reachable, journalled, and the URL is not",
        caveat:
          "Supabase Storage's URL signer is stubbed (the lane has no Storage). " +
          "Both permission gates and the §15 audit write are real; the stub " +
          "plants a sentinel so 'the signed URL is not journalled' is asserted " +
          "rather than assumed.",
      },
      {
        requirement: "Submit support message",
        file: "tests/integration/tracking-flows.test.ts",
        title:
          "6 · SUBMIT SUPPORT MESSAGE — written under the customer policies, staff flag forced false",
      },
    ],
  },
  {
    flow: "Public tracking flow",
    steps: [
      {
        requirement: "Enter tracking number",
        file: "tests/e2e/tracking-flows.spec.ts",
        title: "step 1+2 — the page asks for BOTH factors and requires both",
      },
      {
        requirement: "Enter secondary verification",
        file: "tests/e2e/track.spec.ts",
        title: "the /track page offers a TWO-factor lookup (§4)",
      },
      {
        requirement: "View approved public shipment data",
        file: "tests/integration/public-tracking.test.ts",
        title: "returns the strict public DTO for a correct number + ZIP",
        caveat:
          "Proved against the real database, not in the browser. The e2e lane " +
          "runs on placeholder credentials, and seeding a shipment for it would " +
          "be the fabricated shipment §30 forbids.",
      },
      {
        requirement: "Invalid access fails safely",
        file: "tests/e2e/tracking-flows.spec.ts",
        title: "step 4 — an invalid lookup fails safely IN THE RENDERED PAGE",
      },
    ],
  },
  {
    flow: "Dispatcher flow",
    steps: [
      {
        requirement: "Create shipment",
        file: "tests/integration/dispatcher-operations.test.ts",
        title: "1 · creates the shipment",
      },
      {
        requirement: "Assign carrier",
        file: "tests/integration/dispatcher-operations.test.ts",
        title: "2 · assigns a carrier, a driver and a truck — atomically",
      },
      {
        requirement: "Update pickup status",
        file: "tests/integration/dispatcher-operations.test.ts",
        title: "3 · walks the pickup statuses through the engine",
      },
      {
        requirement: "Record delay",
        file: "tests/integration/dispatcher-operations.test.ts",
        title: "4 · records a delay, and the board's Delayed column finds it",
      },
      {
        requirement: "Update ETA",
        file: "tests/integration/dispatcher-operations.test.ts",
        title: "5 · updates the ETA, preserving the previous value in the event",
      },
      {
        requirement: "Mark delivered",
        file: "tests/integration/dispatcher-operations.test.ts",
        title: "6 · marks delivered",
      },
      {
        requirement: "Request POD",
        file: "tests/integration/dispatcher-operations.test.ts",
        title: "7 · requests the POD as a carrier-band event",
      },
      {
        requirement: "Complete shipment",
        file: "tests/integration/dispatcher-operations.test.ts",
        title: "8 · completes ONLY with the human closeout assertion (§20)",
      },
    ],
  },
  {
    flow: "Carrier flow",
    steps: [
      {
        requirement: "Login",
        file: "tests/e2e/tracking-flows.spec.ts",
        title: "the carrier portal walk bounces to login",
      },
      {
        requirement: "View assigned shipment",
        file: "tests/integration/carrier-driver-updates.test.ts",
        title: "walks §13's action list from dispatch to delivered, through the engine",
      },
      {
        requirement: "Update en route",
        file: "tests/integration/carrier-driver-updates.test.ts",
        title: "walks §13's action list from dispatch to delivered, through the engine",
      },
      {
        requirement: "Confirm pickup",
        file: "tests/integration/carrier-driver-updates.test.ts",
        title: "walks §13's action list from dispatch to delivered, through the engine",
      },
      {
        requirement: "Upload BOL",
        file: "tests/integration/shipment-documents.test.ts",
        title: "files a document AND its §7 event in one call",
      },
      {
        requirement: "Mark delivered",
        file: "tests/integration/carrier-driver-updates.test.ts",
        title: "walks §13's action list from dispatch to delivered, through the engine",
      },
      {
        requirement: "Upload POD",
        file: "tests/integration/shipment-documents.test.ts",
        title: "REGRESSION TO GREEN: approve the POD and `pod_uploaded` SUCCEEDS",
      },
    ],
  },
  {
    flow: "Security flow",
    steps: [
      {
        requirement: "Shipper A cannot access Shipper B",
        file: "tests/integration/tracking-flows.test.ts",
        title: "1 · shipper A cannot access shipper B — proved by the POLICY, not the predicate",
      },
      {
        requirement: "Carrier A cannot access Carrier B",
        file: "tests/integration/tracking-flows.test.ts",
        title: "2 · carrier A cannot access carrier B — including the documents",
      },
      {
        requirement: "Public tracking cannot expose financial fields",
        file: "tests/integration/tracking-flows.test.ts",
        title: "3 · public tracking exposes no financial field — on the shipment that HAS them",
      },
      {
        requirement: "Expired driver token fails",
        file: "tests/integration/tracking-flows.test.ts",
        title: "4 · an EXPIRED driver token fails — and fails like an unknown one",
      },
      {
        requirement: "Unauthorized status transition fails",
        file: "tests/integration/tracking-flows.test.ts",
        title: "5 · an UNAUTHORIZED status transition fails — actor first, then facts",
      },
      {
        requirement: "Revoked tracking code fails",
        file: "tests/integration/tracking-flows.test.ts",
        title: "6 · a REVOKED tracking code fails — rotation and suspension, both",
      },
    ],
  },
] as const;

/* ================================================================== *
 * §27 · Responsive tests — six surfaces, five viewports
 * ================================================================== */

/** The five viewports §27 names, as `width × height`. */
export const SECTION_27_VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

/**
 * The six surfaces §27 names, and the M-82 harness fixture(s) each is measured
 * as. Fixture ids are checked against `FIXTURES` in
 * `tests/e2e/tracking-responsive-a11y.spec.ts`, so deleting a fixture that a
 * §27 surface depends on fails the coverage test rather than silently
 * shrinking the matrix.
 */
export const SECTION_27_RESPONSIVE_SURFACES: readonly {
  surface: string;
  fixtures: readonly string[];
}[] = [
  {
    surface: "public /track",
    fixtures: ["track-result-populated", "track-result-empty"],
  },
  {
    surface: "authenticated shipment list",
    fixtures: ["shipper-list-populated", "shipper-list-empty"],
  },
  { surface: "shipment detail", fixtures: ["shipper-detail-populated"] },
  {
    surface: "dispatcher board",
    fixtures: ["dispatcher-board", "dispatcher-column"],
  },
  {
    surface: "status-update form",
    fixtures: ["carrier-detail", "driver-granted"],
  },
  {
    surface: "mobile timeline",
    fixtures: ["track-result-delayed", "shipper-detail-exception"],
  },
] as const;

export const SECTION_27_RESPONSIVE: CoverageBinding = {
  requirement:
    "Playwright on six surfaces at 375×812, 390×844, 768×1024, 1024×768, 1440×900",
  file: "tests/e2e/tracking-responsive-a11y.spec.ts",
  title: "the harness emitted every named surface state",
  caveat:
    "The per-surface tests are generated (`§22 · ${id} · twelve breakpoints`), " +
    "so the binding points at the literal-titled guard that fails when a " +
    "fixture stops being produced — the failure mode that would otherwise " +
    "shrink the matrix silently. M-82 measures TWELVE widths (320…1920), a " +
    "superset of §27's five, in real Chromium behind the compiled stylesheets. " +
    "Three differences are real and stated rather than glossed: (1) height is " +
    "held constant at 900 — the failure the suite hunts is horizontal overflow " +
    "and clipped targets, which is a width phenomenon; (2) most surfaces are " +
    "HARNESS FIXTURES rendered from the same components rather than live " +
    "routes, because the routes need a session the lane cannot mint (`/track` " +
    "and the driver link ARE measured live); (3) §27 says 'screenshots', and " +
    "the suite asserts geometry instead — a screenshot needs a human to look " +
    "at it, and twelve modules of nobody looking is how M-82 found 12 defects " +
    "that six previous scans had missed.",
};
