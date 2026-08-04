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
