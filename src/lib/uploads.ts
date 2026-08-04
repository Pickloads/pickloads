import "server-only";

/**
 * Server-side file validation for carrier document uploads (audit S-03:
 * size caps + MIME allow-list verified by MAGIC BYTES, never by extension
 * or client-declared content type). Mirrors the `carrier-docs` bucket
 * constraints from migration 0004 (10 MB, pdf/jpeg/png/heic).
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB — bucket cap

export type AllowedMime =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/heic";

const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);

/** Sniffs the real file type from magic bytes. Returns null when not allowed. */
export function sniffMime(bytes: Uint8Array): AllowedMime | null {
  if (bytes.length < 12) return null;
  // %PDF
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) {
    return "application/pdf";
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // HEIC (ISO-BMFF): "ftyp" at offset 4, brand at offset 8
  if (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(
      bytes[8] ?? 0,
      bytes[9] ?? 0,
      bytes[10] ?? 0,
      bytes[11] ?? 0,
    ).toLowerCase();
    if (HEIC_BRANDS.has(brand)) return "image/heic";
  }
  return null;
}

/** Storage-safe file name: strips paths & risky characters, caps length. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  const clean = base.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return (clean || "document").slice(0, 80);
}
