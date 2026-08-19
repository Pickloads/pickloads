// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import axe from "axe-core";
import { emitHarness, harnessWritten } from "../harness/emit";

/**
 * M-100.1 — a rendered specimen of the MAPPED admin vocabulary.
 *
 * ── WHAT THIS IS, EXACTLY ────────────────────────────────────────────────
 *
 * M-100 rewrote two admin screens onto the design-system primitives and let
 * the other 19 adopt the system through the stylesheet: they carry
 * `className="a-page"`, and `.a-page`-scoped rules restyle the vocabulary
 * they already used — `.pbar`, `.psec`, `.ptiles`/`.ptile`, `.pcard`,
 * `.ptable-wrap`/`.ptable`, `.pbadge`, `.pempty`, `.timeline`, `.kfilters`.
 *
 * Those pages are async Server Components behind `requireStaff`, so they can
 * be rendered neither in jsdom nor by the secretless e2e lane. That left the
 * stylesheet changes with no visual coverage at all, and §19 asks for
 * screenshots of the dashboard and friends.
 *
 * So this renders a SPECIMEN: the same class vocabulary, in the same
 * arrangement the real pages use, with representative content. It is emitted
 * as a harness fixture so `admin-shots.spec.ts` can photograph it behind the
 * real compiled stylesheet at four widths.
 *
 * ── WHAT IT IS NOT ───────────────────────────────────────────────────────
 *
 * It is NOT a screenshot of `/portal/admin`. It proves what the stylesheet
 * does to this vocabulary; it cannot prove that the live dashboard uses
 * exactly this vocabulary in exactly this order. The class list above was
 * read off the real pages, and `admin-ui-vocabulary.test.ts` holds the
 * `.a-page` wrapper in place, but a reviewer should still open the live
 * routes before trusting the dashboard specifically.
 */

afterEach(cleanup);

function MappedSpecimen() {
  return (
    <main id="main" className="a-page">
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk</span>
          <h1>Dashboard</h1>
        </div>
        <a className="btn btn-amber btn-sm" href="#leads">
          Open leads pipeline →
        </a>
      </div>

      <p className="phelp">
        Scoped view (dispatcher): your assigned carriers (12) and your own +
        unassigned leads.
      </p>

      <span className="psec">Sales</span>
      <div className="ptiles">
        <div className="ptile">
          <b>18</b>
          <span>New leads · 24h</span>
        </div>
        <div className="ptile">
          <b>124</b>
          <span>New leads · 7d</span>
        </div>
        <div className="ptile">
          <b>31%</b>
          <span>Lead → active conversion</span>
          <span className="sub">42 active of 136 leads</span>
        </div>
        <div className="ptile good">
          <b>11m</b>
          <span>Avg first contact</span>
          <span className="sub">target ≤ 15 min</span>
        </div>
        <div className="ptile warn">
          <b>6</b>
          <span>Callbacks due today</span>
        </div>
      </div>

      <span className="psec">Pipeline funnel</span>
      <div className="ptiles compact">
        {[
          ["New", 34],
          ["Call", 21],
          ["Qualified", 17],
          ["Appointment", 9],
          ["Agreement", 6],
          ["Waiting docs", 4],
          ["Active", 42],
          ["Inactive", 3],
          ["Lost", 11],
        ].map(([label, n]) => (
          <div className="ptile" key={String(label)}>
            <b>{n}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="pgrid2 pgap">
        <div className="pcard">
          <h2>Active carriers by home state</h2>
          <div className="pbadges">
            <span className="pbadge amber">TX · 14</span>
            <span className="pbadge amber">GA · 9</span>
            <span className="pbadge amber">IL · 7</span>
            <span className="pbadge amber">NJ · 4</span>
          </div>
          <h2 className="psubhead">Load mix by equipment</h2>
          <div className="pbadges">
            <span className="pbadge amber">Dry van · 61</span>
            <span className="pbadge amber">Reefer · 28</span>
            <span className="pbadge amber">Flatbed · 12</span>
          </div>
          <p className="phelp">
            Equipment mix comes from booked loads — the carriers table
            deliberately has no equipment column (a fleet can run several).
          </p>
        </div>
        <div className="pcard">
          <h2>Per-dispatcher performance</h2>
          <div className="ptable-wrap" role="region" tabIndex={0} aria-label="Per-dispatcher performance">
          <table className="ptable">
            <thead>
              <tr>
                <th scope="col">Dispatcher</th>
                <th scope="col">Loads</th>
                <th scope="col">Revenue</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Dana Whitfield</td>
                <td>34</td>
                <td>$88,420</td>
              </tr>
              <tr>
                <td>Marcus Ellery</td>
                <td>29</td>
                <td>$71,905</td>
              </tr>
            </tbody>
          </table>
          </div>
        </div>
      </div>

      <span className="psec">Operations — documents pending review</span>
      <div className="ptable-wrap" role="region" tabIndex={0} aria-label="Table">
        <table className="ptable">
          <thead>
            <tr>
              <th scope="col">Carrier</th>
              <th scope="col">Type</th>
              <th scope="col">File</th>
              <th scope="col">Uploaded</th>
              <th scope="col">Review</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Transcontinental Heavy Haul &amp; Specialized Logistics LLC</td>
              <td>
                <span className="pbadge">COI</span>
              </td>
              <td>certificate-of-insurance-2026-renewal.pdf</td>
              <td>Aug 18, 2026</td>
              <td>
                <button className="btn btn-ghost btn-sm" type="button">
                  Review
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <span className="psec">Operations — insurance expiring ≤ 30 days</span>
      <div className="ptable-wrap" role="region" tabIndex={0} aria-label="Table">
        <p className="pempty">No certificates expiring in the next 30 days.</p>
      </div>

      <span className="psec">Accounts</span>
      <div className="ptable-wrap" role="region" tabIndex={0} aria-label="Table">
        <table className="ptable">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Role</th>
              <th scope="col">Carrier</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                Dana Whitfield
                <span className="tsub">
                  dana.whitfield@pickloads.example · (908) 555-0142
                </span>
                <span className="tsub">joined Mar 4, 2026</span>
              </td>
              <td>
                <span className="pbadge">admin</span>
              </td>
              <td>
                Storatech
                <span className="tsub">MC 789009 · onboarding 6/8 · ACTIVE</span>
              </td>
              <td>
                <span className="pbadge green">active</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="ppager">
        <a className="btn btn-ghost btn-sm" href="#prev">
          ← Prev
        </a>
        <span className="pcount">Page 2 of 7</span>
        <a className="btn btn-ghost btn-sm" href="#next">
          Next →
        </a>
      </p>

      <span className="psec">Security log</span>
      <div className="pcard">
        <h2>Recent email &amp; webhook activity</h2>
        <ul className="timeline">
          <li className="tl">
            <span className="tlt">Aug 19, 2026 · 06:57</span>
            <p>stripe · checkout.session.completed FAILED — signature mismatch</p>
          </li>
          <li className="tl">
            <span className="tlt">Aug 19, 2026 · 06:41</span>
            <p>resend · carrier_review_cleared delivered</p>
          </li>
        </ul>
      </div>

      <span className="psec">Settings</span>
      <div className="pcard narrow">
        <h2>Lead sources</h2>
        <p className="pempty flush">No leads yet.</p>
      </div>
    </main>
  );
}

describe("M-100.1 · the mapped admin vocabulary", () => {
  it("renders every class the .a-page rules restyle", () => {
    const { container } = render(<MappedSpecimen />);
    for (const cls of [
      "pbar",
      "psec",
      "ptiles",
      "ptile",
      "pcard",
      "ptable-wrap",
      "ptable",
      "pbadge",
      "pempty",
      "timeline",
      "phelp",
      "ppager",
      "pgrid2",
    ]) {
      expect(
        container.querySelectorAll(`.${cls}`).length,
        `the specimen no longer covers .${cls}`,
      ).toBeGreaterThan(0);
    }
  });

  it("is axe-clean, so the mapped pages' shared vocabulary is too", async () => {
    const { container } = render(<MappedSpecimen />);
    const results = await axe.run(container, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
    });
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.length}`),
    ).toEqual([]);
  });

  it("emits the fixture the screenshot harness photographs", () => {
    const { container } = render(<MappedSpecimen />);
    emitHarness("admin-mapped-vocabulary", "portal", container);
    expect(harnessWritten(["admin-mapped-vocabulary"])).toBe(true);
  });
});
