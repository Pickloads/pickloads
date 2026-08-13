import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("rate limit — graceful degradation (S-03/Q4)", () => {
  it("allows requests when Upstash env is unset (dev no-op)", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    await expect(checkRateLimit("test-form-a", "1.2.3.4")).resolves.toBe(true);
    await expect(checkRateLimit("test-form-a", "1.2.3.4", 20)).resolves.toBe(
      true,
    );
  });

  it("fails open when Redis errors (outage must not kill lead capture)", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://unit-test.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "unit-test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("redis unreachable");
      }),
    );
    await expect(checkRateLimit("test-form-b", "1.2.3.4")).resolves.toBe(true);
  });
});

describe("turnstile — graceful degradation + fail-closed (S-03)", () => {
  it("skips verification when the secret is unset (dev no-op)", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    await expect(verifyTurnstile(null)).resolves.toBe(true);
    await expect(verifyTurnstile("any-token")).resolves.toBe(true);
  });

  it("rejects a missing token when the secret IS set", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(verifyTurnstile(null)).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts when siteverify returns success:true", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ success: true }), { status: 200 }),
      ),
    );
    await expect(verifyTurnstile("token", "1.2.3.4")).resolves.toBe(true);
  });

  it("rejects when siteverify returns success:false", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ success: false }), { status: 200 }),
      ),
    );
    await expect(verifyTurnstile("token")).resolves.toBe(false);
  });

  it("fails closed on non-200 responses and malformed bodies", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("oops", { status: 500 })),
    );
    await expect(verifyTurnstile("token")).resolves.toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ weird: 1 }), { status: 200 }),
      ),
    );
    await expect(verifyTurnstile("token")).resolves.toBe(false);
  });

  it("fails closed when the siteverify request throws", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(verifyTurnstile("token")).resolves.toBe(false);
  });
});

/**
 * The carrier step-1 report was "POST 200, and the UI says it couldn't verify
 * my submission" — with no way to find out why. Every refusal looked identical
 * from outside AND from the server log, because `error-codes` was parsed off
 * the response and dropped.
 *
 * These pin the asymmetry that fixes that: the OPERATOR learns the cause, the
 * USER learns nothing. Telling a bot which check it failed is how you help it
 * pass the next one.
 */
describe("turnstile — a refusal is diagnosable server-side (never client-side)", () => {
  function siteverify(body: unknown) {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
    );
  }

  it("logs the code AND what it means", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    siteverify({ success: false, "error-codes": ["timeout-or-duplicate"] });

    await expect(verifyTurnstile("spent-token")).resolves.toBe(false);

    const logged = err.mock.calls.flat().join(" ");
    expect(logged).toContain("timeout-or-duplicate");
    // The code alone sends people to the wrong place. The single-use property
    // is the whole explanation for a form that fails every retry.
    expect(logged).toMatch(/SINGLE-USE/i);
    err.mockRestore();
  });

  it("distinguishes a wrong secret from a rejected token", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    siteverify({ success: false, "error-codes": ["invalid-input-secret"] });
    await verifyTurnstile("t");
    expect(err.mock.calls.flat().join(" ")).toMatch(/TURNSTILE_SECRET_KEY/);
    err.mockClear();

    // `invalid-input-response` READS like a server problem and is usually a
    // hostname the widget is not allowed on. Saying so is the point.
    siteverify({ success: false, "error-codes": ["invalid-input-response"] });
    await verifyTurnstile("t");
    expect(err.mock.calls.flat().join(" ")).toMatch(/HOSTNAME/i);

    err.mockRestore();
  });

  it("explains a MISSING token differently from a rejected one", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubGlobal("fetch", vi.fn());

    await expect(verifyTurnstile(null)).resolves.toBe(false);

    const logged = err.mock.calls.flat().join(" ");
    expect(logged).toMatch(/no cf-turnstile-response/i);
    expect(logged).toMatch(/NEXT_PUBLIC_TURNSTILE_SITE_KEY/);
    err.mockRestore();
  });

  it("NON-VACUITY: a success logs nothing at all", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    siteverify({ success: true });
    await expect(verifyTurnstile("good")).resolves.toBe(true);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("the return value stays a bare boolean — no code can reach a caller", async () => {
    // The guard turns this into one approved sentence. If the codes ever
    // travelled in the return value they would be one `message:` away from
    // the user's screen.
    siteverify({ success: false, "error-codes": ["invalid-input-response"] });
    const result = await verifyTurnstile("t");
    expect(typeof result).toBe("boolean");
    expect(result).toBe(false);
  });
});
