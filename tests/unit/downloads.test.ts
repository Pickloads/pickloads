import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DOWNLOAD_SECTIONS,
  NEVER_PUBLIC,
  obtainableResources,
} from "@/content/downloads";

/**
 * Downloads Center — the boundaries, proved.
 *
 * This page is one edit away from being a document-disclosure incident. The
 * edit is not malicious: it is somebody adding "Carrier Packet — download" to
 * the public tier because a sales conversation needed it, at which point a
 * W-9, an insurance certificate and a Dispatch Agreement that counsel has
 * never seen become public URLs.
 *
 * These tests make that edit fail the build.
 */

describe("no private artefact can be listed as a public resource", () => {
  const publicResources = DOWNLOAD_SECTIONS.filter(
    (s) => s.tier === "public",
  ).flatMap((s) => s.resources);

  for (const term of NEVER_PUBLIC) {
    it(`no public resource is named "${term}"`, () => {
      for (const resource of publicResources) {
        expect(
          resource.label.toLowerCase(),
          `"${resource.label}" is listed publicly`,
        ).not.toContain(term);
      }
    });
  }

  it("NON-VACUITY: the check WOULD catch a forbidden public entry", () => {
    const hypothetical = { label: "W-9 Form", tier: "public" as const };
    expect(
      NEVER_PUBLIC.some((t) => hypothetical.label.toLowerCase().includes(t)),
    ).toBe(true);
  });

  it("and there IS a public section to check — not vacuous by absence", () => {
    expect(publicResources.length).toBeGreaterThan(0);
  });
});

describe("this page grants nothing", () => {
  it("every obtainable resource is a portal ROUTE, never a storage path", () => {
    for (const resource of obtainableResources()) {
      expect(resource.href).toMatch(/^\/portal\//);
      // No bucket, no object key, no token, no absolute storage host.
      expect(resource.href).not.toMatch(/supabase|storage|sign|token|\.pdf$/i);
      expect(resource.href).not.toMatch(/^https?:/);
    }
  });

  it("every obtainable resource is authenticated-tier — nothing public is clickable yet", () => {
    for (const resource of obtainableResources()) {
      expect(resource.tier).toBe("authenticated");
    }
  });

  it("PRIVATE resources carry no href at all", () => {
    const priv = DOWNLOAD_SECTIONS.filter((s) => s.tier === "private").flatMap(
      (s) => s.resources,
    );
    expect(priv.length).toBeGreaterThan(0);
    for (const resource of priv) {
      expect(resource.href, `${resource.label} must not be linkable`).toBeNull();
    }
  });

  it("an unobtainable resource always says WHY", () => {
    for (const section of DOWNLOAD_SECTIONS) {
      for (const resource of section.resources) {
        if (resource.href === null) {
          expect(
            resource.unavailable,
            `${resource.label} is unavailable with no reason`,
          ).toBeTruthy();
        }
      }
    }
  });
});

/**
 * The page source WITH COMMENTS STRIPPED.
 *
 * The page's own header explains at length why it touches no storage path and
 * no packet flag — and the first version of these scans failed on that
 * explanation. A doctrine that fails on its own documentation teaches people
 * to delete the documentation, which is the opposite of what it is for. Same
 * treatment as the response-promise guard.
 */
function pageCode(): string {
  return readFileSync(
    path.join(
      process.cwd(),
      "src",
      "app",
      "[locale]",
      "(site)",
      "downloads",
      "page.tsx",
    ),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

describe("no dead controls", () => {
  const page = pageCode();

  it('the page contains no href="#"', () => {
    expect(page).not.toContain('href="#"');
  });

  it("the page never renders a `download` attribute — it hosts no file", () => {
    expect(page).not.toMatch(/\sdownload[\s=>]/);
  });

  it("the page names no storage bucket or signed-URL helper", () => {
    for (const forbidden of [
      "createSignedUrl",
      "storage",
      "PACKET_DOC_PATH",
      "/packet/",
      "service_role",
    ]) {
      expect(page, `page references ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("the packet gate is not bypassed", () => {
  it("the Downloads Center does not read or flip packet_downloads_live", () => {
    const page = pageCode();
    // It does not need the flag: it offers no packet download in either
    // state. Reading it would imply the page changes behaviour when the flag
    // flips, which would be a second place to get that decision wrong.
    expect(page).not.toContain("packet_downloads_live");
  });

  it("the seeded default is still false", () => {
    const seed = readFileSync(
      path.join(process.cwd(), "supabase", "seed.sql"),
      "utf8",
    );
    const line = seed
      .split("\n")
      .find((l) => l.includes("packet_downloads_live"));
    expect(line, "packet_downloads_live missing from seed").toBeTruthy();
    expect(line!.toLowerCase()).toContain("false");
  });
});
