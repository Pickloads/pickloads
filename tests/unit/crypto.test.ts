import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptPII,
  encryptPII,
  isPiiEncryptionConfigured,
} from "@/lib/crypto";

const KEY = "unit-test-secret-please-rotate";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("PII encryption (S-01)", () => {
  it("refuses to encrypt without a key (never falls back to plaintext)", () => {
    vi.stubEnv("PII_ENCRYPTION_KEY", "");
    expect(isPiiEncryptionConfigured()).toBe(false);
    expect(encryptPII("12-3456789")).toBeNull();
    expect(decryptPII("v1:a:b:c")).toBeNull();
  });

  it("round-trips an EIN through encrypt → decrypt", () => {
    vi.stubEnv("PII_ENCRYPTION_KEY", KEY);
    const stored = encryptPII("12-3456789");
    expect(stored).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(stored).not.toContain("12-3456789");
    expect(decryptPII(stored as string)).toBe("12-3456789");
  });

  it("round-trips unicode payloads", () => {
    vi.stubEnv("PII_ENCRYPTION_KEY", KEY);
    const stored = encryptPII("Compañía número 1 — 08£");
    expect(decryptPII(stored as string)).toBe("Compañía número 1 — 08£");
  });

  it("uses a random IV — same plaintext, different ciphertext", () => {
    vi.stubEnv("PII_ENCRYPTION_KEY", KEY);
    expect(encryptPII("12-3456789")).not.toBe(encryptPII("12-3456789"));
  });

  it("detects ciphertext tampering (GCM auth tag)", () => {
    vi.stubEnv("PII_ENCRYPTION_KEY", KEY);
    const stored = encryptPII("12-3456789") as string;
    const parts = stored.split(":");
    const cipherBytes = Buffer.from(parts[3] as string, "base64");
    const firstByte = cipherBytes[0] ?? 0;
    cipherBytes[0] = firstByte ^ 0xff;
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${cipherBytes.toString("base64")}`;
    expect(decryptPII(tampered)).toBeNull();
  });

  it("detects auth-tag tampering", () => {
    vi.stubEnv("PII_ENCRYPTION_KEY", KEY);
    const stored = encryptPII("12-3456789") as string;
    const parts = stored.split(":");
    const flippedTag = Buffer.from(parts[2] as string, "base64");
    const firstByte = flippedTag[0] ?? 0;
    flippedTag[0] = firstByte ^ 0x01;
    const tampered = `${parts[0]}:${parts[1]}:${flippedTag.toString("base64")}:${parts[3]}`;
    expect(decryptPII(tampered)).toBeNull();
  });

  it("returns null (never throws) on unrecognized formats", () => {
    vi.stubEnv("PII_ENCRYPTION_KEY", KEY);
    expect(decryptPII("plaintext-ein")).toBeNull();
    expect(decryptPII("v2:a:b:c")).toBeNull();
    expect(decryptPII("v1:only-two:parts")).toBeNull();
    expect(decryptPII("v1:!!!:???:***")).toBeNull();
    expect(decryptPII("")).toBeNull();
  });

  it("fails decryption under a rotated (different) key", () => {
    vi.stubEnv("PII_ENCRYPTION_KEY", KEY);
    const stored = encryptPII("12-3456789") as string;
    vi.stubEnv("PII_ENCRYPTION_KEY", "a-different-key-entirely");
    expect(decryptPII(stored)).toBeNull();
  });
});
