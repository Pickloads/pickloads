// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { toRenderableQrSrc, looksLikeSvg } from "@/lib/mfa-qr";

/**
 * M-96 — staff TOTP enrollment.
 *
 * ── THE BUG THIS FILE EXISTS TO PIN DOWN ─────────────────────────────────
 *
 * "The Generate QR code button does nothing." It wasn't the button, and it
 * wasn't the API. Enrollment succeeded every time; the QR was a blank frame.
 *
 * `supabase.auth.mfa.enroll()` returns `totp.qr_code` as a `data:` URL whose
 * body is a RAW, unencoded SVG document — measured against the live project:
 * 321,600 characters, zero percent-escapes, 25,367 literal spaces, 42,260
 * literal double quotes — behind the header `data:image/svg+xml;utf-8`, which
 * is not a valid media type parameter either (`charset=utf-8` is). A browser
 * cannot decode that, so the `<img>` painted nothing, on a card the same
 * colour as the empty frame.
 *
 * The old helper guaranteed it:
 *
 *     if (raw.startsWith("data:")) return raw;   // always taken
 *     return `data:...,${encodeURIComponent(raw)}`;  // dead code
 *
 * So the tests below are in two halves: the ENCODER, against the exact shape
 * the provider really sends, and the COMPONENT, which must never again leave
 * a person staring at a blank square with no way forward.
 */

/**
 * Source with comments removed. These files DOCUMENT the mistakes they fix —
 * a scanner that reads prose flags the explanation as the defect, which is
 * exactly what happened the first time these assertions were written.
 */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ 	]*\/\/.*$/gm, " ");
}

/* ── The encoder ────────────────────────────────────────────────────────── */

/** A faithful miniature of what Supabase actually returns. */
const RAW_SUPABASE_QR =
  'data:image/svg+xml;utf-8,<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect x="0" y="0" width="256" height="256" fill="#ffffff"/><path d="M0 0h8v8H0z" fill="#000000"/></svg>';

describe("the QR payload is made renderable", () => {
  it("percent-encodes the provider's raw SVG body", () => {
    const src = toRenderableQrSrc(RAW_SUPABASE_QR);
    expect(src).toBeTruthy();
    // The three characters that make a data: URL undecodable.
    const body = src!.slice(src!.indexOf(",") + 1);
    expect(body).not.toContain(" ");
    expect(body).not.toContain('"');
    expect(body).not.toContain("<");
    expect(body).toContain("%3C"); // '<' survived, encoded
  });

  it("replaces the invalid media type with charset=utf-8", () => {
    const src = toRenderableQrSrc(RAW_SUPABASE_QR)!;
    expect(src.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    // The provider's malformed parameter must not survive anywhere.
    expect(src).not.toContain(";utf-8,");
  });

  it("round-trips back to the original SVG", () => {
    // The proof that encoding did not corrupt the picture: decode it again
    // and it is the same document the provider sent.
    const src = toRenderableQrSrc(RAW_SUPABASE_QR)!;
    const decoded = decodeURIComponent(src.slice(src.indexOf(",") + 1));
    const original = RAW_SUPABASE_QR.slice(RAW_SUPABASE_QR.indexOf(",") + 1);
    expect(decoded).toBe(original);
    expect(looksLikeSvg(decoded)).toBe(true);
  });

  it("tolerates the trailing newline the live provider actually sends", () => {
    // Measured: the real payload is 321,600 chars ending in "\n", and the
    // decoded output is the same 321,599 characters without it. All 4,225
    // <rect> elements survive. Trimming whitespace around an SVG document
    // changes nothing that renders, and this pins that it is the ONLY
    // difference the normalizer introduces.
    const withNewline = `${RAW_SUPABASE_QR}\n`;
    const src = toRenderableQrSrc(withNewline)!;
    const decoded = decodeURIComponent(src.slice(src.indexOf(",") + 1));
    const body = RAW_SUPABASE_QR.slice(RAW_SUPABASE_QR.indexOf(",") + 1);
    expect(decoded).toBe(body.trim());
    expect((decoded.match(/<rect/g) ?? []).length).toBe(
      (body.match(/<rect/g) ?? []).length,
    );
  });

  it("accepts a bare SVG document with no data: prefix", () => {
    const src = toRenderableQrSrc('<svg xmlns="x"><rect fill="#000"/></svg>')!;
    expect(src.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(src).not.toContain("<");
  });

  it("leaves an ALREADY-encoded payload alone rather than double-escaping", () => {
    const already = "data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22x%22%2F%3E";
    const src = toRenderableQrSrc(already)!;
    expect(src).not.toContain("%253C"); // '%' would have been re-encoded
    expect(decodeURIComponent(src.slice(src.indexOf(",") + 1))).toContain("<svg");
  });

  it("passes a base64 payload through untouched", () => {
    const b64 = "data:image/svg+xml;base64,PHN2Zy8+";
    expect(toRenderableQrSrc(b64)).toBe(b64);
  });

  it("returns null when there is nothing to render", () => {
    for (const bad of [null, undefined, "", "   ", "data:image/svg+xml"]) {
      expect(toRenderableQrSrc(bad as string | null), String(bad)).toBeNull();
    }
  });

  it("NON-VACUITY: the OLD helper really did produce an undecodable URL", () => {
    // Guards against somebody "simplifying" the encoder back to a pass-through.
    const old = (raw: string) =>
      raw.startsWith("data:")
        ? raw
        : `data:image/svg+xml;utf-8,${encodeURIComponent(raw)}`;
    const oldResult = old(RAW_SUPABASE_QR);
    expect(oldResult).toContain(" ");
    expect(oldResult).toContain('"');
    expect(oldResult).not.toBe(toRenderableQrSrc(RAW_SUPABASE_QR));
  });
});

/* ── The component ──────────────────────────────────────────────────────── */

interface MfaStub {
  listFactors: ReturnType<typeof vi.fn>;
  enroll: ReturnType<typeof vi.fn>;
  challenge: ReturnType<typeof vi.fn>;
  verify: ReturnType<typeof vi.fn>;
  unenroll: ReturnType<typeof vi.fn>;
}

let mfa: MfaStub;

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { mfa } }),
}));

/**
 * M-97: the journal is a ROUTE HANDLER now, not a server action, so the test
 * double is `fetch` rather than a module mock. That difference is the fix —
 * see the "the journal cannot log anybody out" block below.
 */
let journalRequests: Array<{ url: string; method: string; body: unknown }> = [];
let journalFails = false;

function installFetchDouble() {
  journalRequests = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    journalRequests.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (journalFails) throw new Error("network down");
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
}

/** The kinds journalled, in order — the shape the old assertions used. */
const auditKinds = () =>
  journalRequests.map((r) => (r.body as { kind?: string } | null)?.kind);

const { MfaEnrollment } = await import("@/components/portal/MfaEnrollment");

function renderEnrollment(over: Partial<{ hasVerifiedFactor: boolean }> = {}) {
  return render(
    <MfaEnrollment
      configured
      hasVerifiedFactor={over.hasVerifiedFactor ?? false}
      friendlyName="PickLoads — admin@pickloads.com"
      returnTo="/portal/admin"
    />,
  );
}

const clickGenerate = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /generate qr code/i }));
  });
};

beforeEach(() => {
  journalFails = false;
  installFetchDouble();
  mfa = {
    listFactors: vi.fn(async () => ({ data: { all: [], totp: [] }, error: null })),
    enroll: vi.fn(async () => ({
      data: {
        id: "factor-1",
        type: "totp",
        totp: { qr_code: RAW_SUPABASE_QR, secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://x" },
      },
      error: null,
    })),
    challenge: vi.fn(async () => ({ data: { id: "chal-1" }, error: null })),
    verify: vi.fn(async () => ({ data: {}, error: null })),
    unenroll: vi.fn(async () => ({ data: {}, error: null })),
  };
  // jsdom has no navigation; the component hard-navigates on success.
  Object.defineProperty(window, "location", {
    value: { assign: vi.fn() },
    writable: true,
  });
});

afterEach(cleanup);

describe("clicking Generate QR code", () => {
  it("actually invokes Supabase enrollment", async () => {
    renderEnrollment();
    await clickGenerate();
    expect(mfa.enroll).toHaveBeenCalledTimes(1);
    expect(mfa.enroll).toHaveBeenCalledWith(
      expect.objectContaining({ factorType: "totp" }),
    );
  });

  it("renders the QR as a DECODABLE data URL", async () => {
    renderEnrollment();
    await clickGenerate();
    const img = screen.getByRole("img", { name: /qr code/i }) as HTMLImageElement;
    expect(img.src.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    // The regression, stated as the assertion: no raw space, quote or angle
    // bracket may reach the src attribute.
    const body = img.src.slice(img.src.indexOf(",") + 1);
    expect(body).not.toMatch(/[ "<>]/);
  });

  it("shows the 6-digit input once enrolled", async () => {
    renderEnrollment();
    await clickGenerate();
    expect(screen.getByLabelText(/6-digit code/i)).toBeTruthy();
  });

  it("offers the manual setup key alongside the QR", async () => {
    renderEnrollment();
    await clickGenerate();
    expect(screen.getByText(/JBSWY3DPEHPK3PXP/)).toBeTruthy();
  });

  it("clears abandoned unverified factors before enrolling again", async () => {
    mfa.listFactors = vi.fn(async () => ({
      data: {
        all: [
          { id: "old-unverified", status: "unverified" },
          { id: "keep-me", status: "verified" },
        ],
        totp: [],
      },
      error: null,
    }));
    renderEnrollment();
    await clickGenerate();
    expect(mfa.unenroll).toHaveBeenCalledTimes(1);
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: "old-unverified" });
  });

  it("NEVER leaves the user with a blank frame — a broken image says so", async () => {
    // The heart of the reported symptom. If the picture cannot paint, the
    // surface must announce it and fall back to the key, not sit silent.
    renderEnrollment();
    await clickGenerate();
    const img = screen.getByRole("img", { name: /qr code/i });
    await act(async () => {
      fireEvent.error(img);
    });
    expect(screen.getByText(/couldn't be displayed/i)).toBeTruthy();
    expect(screen.getByText(/JBSWY3DPEHPK3PXP/)).toBeTruthy();
  });

  it("falls back to the key when the provider sends no QR at all", async () => {
    mfa.enroll = vi.fn(async () => ({
      data: {
        id: "factor-1",
        type: "totp",
        totp: { qr_code: "", secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://x" },
      },
      error: null,
    }));
    renderEnrollment();
    await clickGenerate();
    expect(screen.getByText(/couldn't be displayed/i)).toBeTruthy();
    expect(screen.getByLabelText(/6-digit code/i)).toBeTruthy();
  });
});

describe("failures are visible, never silent", () => {
  it("shows an error when enrollment is refused", async () => {
    mfa.enroll = vi.fn(async () => ({
      data: null,
      error: { message: "MFA enroll is disabled", status: 422 },
    }));
    renderEnrollment();
    await clickGenerate();
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't start enrollment/i);
    expect(screen.queryByRole("img", { name: /qr code/i })).toBeNull();
  });

  it("shows an error when the auth service is unreachable", async () => {
    mfa.enroll = vi.fn(async () => {
      throw new Error("network down");
    });
    renderEnrollment();
    await clickGenerate();
    expect(screen.getByRole("alert").textContent).toMatch(/couldn't reach/i);
  });

  it("handles a response with no totp payload without crashing", async () => {
    mfa.enroll = vi.fn(async () => ({ data: { id: "f", type: "phone" }, error: null }));
    renderEnrollment();
    await clickGenerate();
    expect(screen.getByRole("alert").textContent).toMatch(/can't display/i);
  });

  it("never echoes the provider's message to the user", async () => {
    mfa.enroll = vi.fn(async () => ({
      data: null,
      error: { message: "factor 9f3c-secret-hint already exists", status: 422 },
    }));
    renderEnrollment();
    await clickGenerate();
    expect(screen.getByRole("alert").textContent).not.toContain("9f3c-secret-hint");
  });
});

describe("verifying the code", () => {
  it("rejects a non-6-digit code without calling Supabase", async () => {
    renderEnrollment();
    await clickGenerate();
    mfa.challenge.mockClear();
    for (const bad of ["12345", "abcdef", "1234567", ""]) {
      const input = screen.getByLabelText(/6-digit code/i) as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: bad } });
        fireEvent.submit(input.closest("form")!);
      });
      expect(mfa.challenge, bad).not.toHaveBeenCalled();
    }
    expect(screen.getByRole("alert").textContent).toMatch(/6-digit code/i);
  });

  it("challenges and verifies the factor it just enrolled", async () => {
    renderEnrollment();
    await clickGenerate();
    const input = screen.getByLabelText(/6-digit code/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "123456" } });
      fireEvent.submit(input.closest("form")!);
    });
    expect(mfa.challenge).toHaveBeenCalledWith({ factorId: "factor-1" });
    expect(mfa.verify).toHaveBeenCalledWith({
      factorId: "factor-1",
      challengeId: "chal-1",
      code: "123456",
    });
  });

  it("an invalid code fails safely and creates no extra factor", async () => {
    mfa.verify = vi.fn(async () => ({
      data: null,
      error: { message: "Invalid TOTP code entered", status: 422 },
    }));
    renderEnrollment();
    await clickGenerate();
    const enrollCalls = mfa.enroll.mock.calls.length;
    const input = screen.getByLabelText(/6-digit code/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "000000" } });
      fireEvent.submit(input.closest("form")!);
    });
    expect(screen.getByRole("alert").textContent).toMatch(/didn't match/i);
    expect(mfa.enroll.mock.calls.length).toBe(enrollCalls);
    expect(window.location.assign).not.toHaveBeenCalled();
  });

  it("a REPLAYED verification does not enroll a second factor", async () => {
    renderEnrollment();
    await clickGenerate();
    const input = screen.getByLabelText(/6-digit code/i) as HTMLInputElement;
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        fireEvent.change(input, { target: { value: "123456" } });
        fireEvent.submit(input.closest("form")!);
      });
    }
    expect(mfa.enroll).toHaveBeenCalledTimes(1);
  });

  it("on success it journals and hard-navigates so the server re-reads AAL2", async () => {
    renderEnrollment();
    await clickGenerate();
    const input = screen.getByLabelText(/6-digit code/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "123456" } });
      fireEvent.submit(input.closest("form")!);
    });
    // The AAL2 token is minted by verify() into this browser's session; the
    // full navigation is what makes the server re-read it and open the gate.
    expect(window.location.assign).toHaveBeenCalledWith("/portal/admin");
    expect(auditKinds()).toContain("enrolled");
  });

  it("step-up: a verified factor is challenged without enrolling a new one", async () => {
    mfa.listFactors = vi.fn(async () => ({
      data: { all: [{ id: "v1", status: "verified" }], totp: [{ id: "v1", status: "verified" }] },
      error: null,
    }));
    renderEnrollment({ hasVerifiedFactor: true });
    const input = screen.getByLabelText(/6-digit code/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "123456" } });
      fireEvent.submit(input.closest("form")!);
    });
    expect(mfa.enroll).not.toHaveBeenCalled();
    expect(mfa.challenge).toHaveBeenCalledWith({ factorId: "v1" });
    expect(auditKinds()).toContain("verified");
  });
});

/* ── M-97: the journal cannot log anybody out ───────────────────────────── */

describe("the post-verify journal", () => {
  it("posts to the ROUTE HANDLER, not to the current page", async () => {
    // The regression, stated directly. A Server Action POSTs to the current
    // route and makes Next re-render it; that route is gated by
    // requireStaffNoMfa, which redirects to /login when the request lands
    // mid-cookie-rotation. 303 → /login, immediately after a correct MFA.
    renderEnrollment();
    await clickGenerate();
    const input = screen.getByLabelText(/6-digit code/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "123456" } });
      fireEvent.submit(input.closest("form")!);
    });
    expect(journalRequests).toHaveLength(1);
    expect(journalRequests[0]!.url).toBe("/api/portal/mfa-journal");
    expect(journalRequests[0]!.method).toBe("POST");
    // Nothing addressed at the page itself, which is what could redirect.
    for (const r of journalRequests) {
      expect(r.url).not.toMatch(/\/portal\/admin\/mfa$/);
    }
  });

  it("still navigates when the journal fails outright", async () => {
    // A best-effort audit row must never cost somebody their session upgrade.
    journalFails = true;
    renderEnrollment();
    await clickGenerate();
    const input = screen.getByLabelText(/6-digit code/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "123456" } });
      fireEvent.submit(input.closest("form")!);
    });
    expect(window.location.assign).toHaveBeenCalledWith("/portal/admin");
  });

  it("sends only a kind — never a factor id, code or secret", async () => {
    renderEnrollment();
    await clickGenerate();
    const input = screen.getByLabelText(/6-digit code/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "123456" } });
      fireEvent.submit(input.closest("form")!);
    });
    const body = journalRequests[0]!.body as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["kind"]);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("JBSWY3DPEHPK3PXP");
    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("factor-1");
  });

  it("a wrong code journals nothing and does not navigate", async () => {
    // Stays authenticated at AAL1, with an error — no logout, no upgrade.
    mfa.verify = vi.fn(async () => ({
      data: null,
      error: { message: "Invalid TOTP code entered", status: 422 },
    }));
    renderEnrollment();
    await clickGenerate();
    const input = screen.getByLabelText(/6-digit code/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "000000" } });
      fireEvent.submit(input.closest("form")!);
    });
    expect(journalRequests).toEqual([]);
    expect(window.location.assign).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/didn't match/i);
  });

  it("no server action is imported by the enrollment surface at all", () => {
    // Comments stripped: this file DOCUMENTS the action it replaced, and a
    // scanner that reads prose flags the explanation as the defect.
    const src = code("src/components/portal/MfaEnrollment.tsx");
    expect(src).not.toContain("@/app/actions/security");
    expect(src).not.toContain("recordMfaEnrollment");
    expect(src).toContain("/api/portal/mfa-journal");
  });

  it("the journal route is outside the middleware matcher", () => {
    // If it were inside, an unauthenticated POST would be answered with a
    // redirect — reintroducing exactly the failure this moved away from.
    const mw = readFileSync("src/middleware.ts", "utf8");
    expect(mw).toMatch(/\(\?!api\|/);
  });
});

/* ── M-97: the AAL decision is made about an AUTHENTICATED session ──────── */

describe("MFA state is derived from a validated session", () => {
  const src = code("src/lib/mfa.ts");

  it("calls getUser() before reading factors or the assurance level", () => {
    const authIndex = src.indexOf("supabase.auth.getUser()");
    const aalIndex = src.indexOf("getAuthenticatorAssuranceLevel()");
    expect(authIndex).toBeGreaterThan(-1);
    expect(aalIndex).toBeGreaterThan(-1);
    expect(authIndex).toBeLessThan(aalIndex);
  });

  it("never reads the user off getSession()", () => {
    expect(src).not.toContain("getSession()");
  });

  it("fails CLOSED when the session cannot be authenticated", () => {
    // `unconfigured()` reports satisfied:true, which is right only when there
    // is no auth service to ask. A configured project that cannot authenticate
    // the caller must not report MFA as satisfied.
    const branch = src.slice(
      src.indexOf("if (authError || !authed.user)"),
      src.indexOf("const [factors, aal]"),
    );
    expect(branch).toContain("configured: true");
    expect(branch).toContain('satisfied: fallback.requirement === "none"');
    expect(branch).not.toContain("return unconfigured()");
  });
});

/* ── Security ───────────────────────────────────────────────────────────── */

describe("the secret stays where it belongs", () => {
  it("is never written to the console", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    renderEnrollment();
    await clickGenerate();
    for (const s of [spy, warn, err]) {
      for (const call of s.mock.calls) {
        expect(JSON.stringify(call)).not.toContain("JBSWY3DPEHPK3PXP");
      }
    }
    spy.mockRestore();
    warn.mockRestore();
    err.mockRestore();
  });

  it("is never sent to analytics or a server action", async () => {
    renderEnrollment();
    await clickGenerate();
    const input = screen.getByLabelText(/6-digit code/i) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "123456" } });
      fireEvent.submit(input.closest("form")!);
    });
    // The only server call carries a kind, never the factor or its secret.
    expect(auditKinds()).toEqual(["enrolled"]);
  });

  /** The shared comment-stripping reader from the top of this file. */
  const source = code;

  it("no code path logs or persists the enrollment payload", () => {
    const src = source("src/components/portal/MfaEnrollment.tsx");
    expect(src).not.toMatch(/console\.(log|info|debug|warn|error)/);
    expect(src).not.toContain("track(");
    expect(src).not.toContain("localStorage");
    expect(src).not.toContain("sessionStorage");
  });

  it("the journal endpoint never accepts a secret from the client", () => {
    // It takes one value from a two-item enum; identity is re-derived
    // server-side. There is no parameter a secret could ride in.
    const src = source("src/app/api/portal/mfa-journal/route.ts");
    expect(src).toContain('z.enum(["enrolled", "verified"])');
    expect(src).toContain("getSessionProfile()");
    expect(src).toContain("isStaffRole(session.role)");
    // And it can never answer with a redirect, which is the whole point.
    expect(src).not.toContain("redirect");
  });

  it("enrollment is not a route to staff authorization", () => {
    // A carrier can enroll a factor on their own account all day; it grants
    // nothing, because every staff surface gates on profiles.role first.
    const auth = source("src/lib/auth.ts");
    expect(auth).toMatch(/session\.role !== "admin" && session\.role !== "dispatcher"/);
    const journal = source("src/app/api/portal/mfa-journal/route.ts");
    expect(journal).toMatch(/!session \|\| !isStaffRole\(session\.role\)/);
  });
});
