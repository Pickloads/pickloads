import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";

/**
 * Application-layer PII encryption (audit S-01: `carriers.ein` must never be
 * stored in plaintext; promised for M-21, the first module that writes it).
 *
 * AES-256-GCM with a random 12-byte IV per value. Stored format:
 *   "v1:<iv b64>:<authTag b64>:<ciphertext b64>"
 * Key: `PII_ENCRYPTION_KEY` env — any strong secret string; a 32-byte key is
 * derived via SHA-256 so ops can rotate to a proper random value later
 * without a format change (rotation = decrypt+re-encrypt job, documented in
 * docs/modules/M-20-21-onboarding-uploads.md).
 *
 * Graceful degradation: when the key is unset, `encryptPII` returns null —
 * callers must store NULL rather than plaintext. Decryption of an
 * unrecognized format returns null (never throws into a page render).
 */

function getKey(): Buffer | null {
  const secret = process.env.PII_ENCRYPTION_KEY;
  if (!secret) return null;
  return createHash("sha256").update(secret, "utf8").digest();
}

export function isPiiEncryptionConfigured(): boolean {
  return Boolean(process.env.PII_ENCRYPTION_KEY);
}

export function encryptPII(plaintext: string): string | null {
  const key = getKey();
  if (!key) {
    console.warn(
      "[crypto] PII_ENCRYPTION_KEY unset — refusing to store PII (value dropped)",
    );
    return null;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptPII(stored: string): string | null {
  const key = getKey();
  if (!key) return null;
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const iv = Buffer.from(parts[1] ?? "", "base64");
    const tag = Buffer.from(parts[2] ?? "", "base64");
    const ciphertext = Buffer.from(parts[3] ?? "", "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
