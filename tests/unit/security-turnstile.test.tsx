// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useTurnstileReset } from "@/components/forms/TurnstileWidget";

/**
 * SEC-P1-01 — every Turnstile call site mints a fresh token per submission.
 *
 * ── THE FINDING ──────────────────────────────────────────────────────────
 *
 * A Turnstile token is single-use and expires after 300 seconds. The widget
 * solves once on mount and then holds that one token, so a form that survives
 * its own submission re-sends a SPENT token on the next attempt. Cloudflare
 * answers `timeout-or-duplicate`, the guard renders "we couldn't verify your
 * submission — please refresh the page", and every retry from then on fails
 * identically. The form is wedged until a full page reload.
 *
 * `resetKey` was introduced to fix this at the carrier wizard and shipped as
 * an OPT-IN with a default of 0. This audit found the predictable outcome:
 * **one of eleven call sites had opted in.** The other ten were both
 * account-creation forms, contact, the freight quote, the home-page quick
 * quote, the New Authority lead, the newsletter, the driver update, the
 * tracking support form, and the public `/track` lookup.
 *
 * ── WHY THE STRUCTURAL TEST IS THE IMPORTANT HALF ────────────────────────
 *
 * The behavioural test below proves the hook counts correctly. It would have
 * passed happily on the broken tree, because the hook was never the problem —
 * ten call sites simply never called it. A safety default that each caller
 * has to remember is not a default, and the only durable guard is one that
 * fails when a NEW call site forgets. That is the first test here.
 */

function callSites(): Array<{ file: string; tag: string }> {
  const files = execSync('git ls-files "src/**/*.tsx"', { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  const out: Array<{ file: string; tag: string }> = [];
  for (const file of files) {
    // The component's own definition is not a call site.
    if (file.endsWith("components/forms/TurnstileWidget.tsx")) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/<TurnstileWidget\b[^>]*\/>/g)) {
      out.push({ file, tag: m[0].replace(/\s+/g, " ") });
    }
  }
  return out;
}

describe("SEC-P1-01 · Turnstile token freshness", () => {
  // There are no setupFiles in vitest.config.ts, so testing-library's
  // auto-cleanup is not registered. Without this, each render leaves its
  // container in document.body and the next getByTestId matches several.
  afterEach(cleanup);

  it("every <TurnstileWidget/> in the codebase is given a resetKey", () => {
    const offenders = callSites()
      .filter((s) => !/\bresetKey=/.test(s.tag))
      .map((s) => `${s.file}: ${s.tag}`);
    expect(
      offenders,
      "A widget without a resetKey never remounts, so the second submission " +
        "on this form re-sends a spent token and the form wedges until the " +
        "page is reloaded. Wire it to useTurnstileReset(state).",
    ).toEqual([]);
  });

  it("NON-VACUITY — the scan actually finds the site's call sites", () => {
    // If the regex broke, the assertion above would pass on an empty list.
    const sites = callSites();
    expect(sites.length).toBeGreaterThanOrEqual(11);
    expect(sites.map((s) => s.file)).toContain(
      "src/components/tracking/TrackingLookup.tsx",
    );
  });

  function Probe({ state }: { state: { status: string } }) {
    const attempt = useTurnstileReset(state);
    return <span data-testid="attempt">{attempt}</span>;
  }

  const attemptOf = (el: HTMLElement) => el.textContent;

  it("does not remount while the form is untouched", () => {
    const { getByTestId } = render(<Probe state={{ status: "idle" }} />);
    expect(attemptOf(getByTestId("attempt"))).toBe("0");
  });

  it("mints a fresh token after a FAILED submission", () => {
    const { getByTestId, rerender } = render(
      <Probe state={{ status: "idle" }} />,
    );
    act(() => rerender(<Probe state={{ status: "error" }} />));
    expect(attemptOf(getByTestId("attempt"))).toBe("1");
  });

  it("mints a fresh token after a SUCCESSFUL submission too", () => {
    // The token is spent by the submission, not by the outcome. /track keeps
    // its form mounted after a successful lookup and invites a second one —
    // that second lookup was being refused on a live customer-facing page.
    const { getByTestId, rerender } = render(
      <Probe state={{ status: "idle" }} />,
    );
    act(() => rerender(<Probe state={{ status: "success" }} />));
    expect(attemptOf(getByTestId("attempt"))).toBe("1");
  });

  it("counts every settled submission, so repeated retries keep working", () => {
    // The wedge was not "the first retry fails" — it was "every retry fails,
    // forever". A counter that increments once would still leave attempt 3
    // re-sending attempt 2's token.
    const { getByTestId, rerender } = render(
      <Probe state={{ status: "idle" }} />,
    );
    for (const status of ["error", "error", "success", "error"]) {
      // A new object each time: useActionState hands back a fresh state per
      // submission, which is exactly what makes this count submissions.
      act(() => rerender(<Probe state={{ status }} />));
    }
    expect(attemptOf(getByTestId("attempt"))).toBe("4");
  });
});
