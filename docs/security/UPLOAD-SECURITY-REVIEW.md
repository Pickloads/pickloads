# PickLoads — Upload Security Review

PickLoads receives W-9s, insurance certificates, authority letters, PODs,
invoices and voided cheques. This is the highest-value PII surface in the
product.

## Controls, and where each lives

| Control           | Value                                                      | Enforced at                                                                 |
| ----------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| Bucket visibility | **private**                                                | `storage.buckets.public = false` (migration 0004)                           |
| Size cap          | 10 MB                                                      | bucket `file_size_limit` **and** `MAX_UPLOAD_BYTES` in `src/lib/uploads.ts` |
| Type allow-list   | `application/pdf`, `image/jpeg`, `image/png`, `image/heic` | bucket `allowed_mime_types` **and** `sniffMime()`                           |
| Type detection    | **magic bytes**                                            | `sniffMime()` — never the extension, never the browser's `Content-Type`     |
| Filename          | path-stripped, `[^a-zA-Z0-9._-]` collapsed, 80-char cap    | `sanitizeFileName()`                                                        |
| Signed URL TTL    | **300 s**                                                  | `SIGNED_URL_TTL_SECONDS`, single exported constant                          |
| Object access     | staff, or owning carrier                                   | `storage.objects` RLS (migration 0004)                                      |

Two independent layers agree on size and type: the bucket rejects
independently of the application, so an application bug does not open the
bucket, and a direct-to-storage path does not bypass the application's rules.

## Why the type check is trustworthy

`sniffMime()` reads the actual header bytes — `%PDF`, `FF D8 FF`, the PNG
8-byte signature, `ftyp` + a known HEIC brand at offset 4/8. It returns `null`
for anything else, and `null` is a rejection.

Consequences worth stating explicitly:

- **A `.pdf` that is really an HTML file is rejected.** Extension is not
  consulted.
- **SVG is not in the allow-list.** This is the single most common stored-XSS
  vector in document upload features: SVG is an XML document that executes
  script, and a "harmless image type" allow-list that includes it is a stored
  XSS. It is absent by design.
- **Executables are rejected** — no magic-byte branch matches them.

## Signed URLs

Every download is a 300-second signed URL for a private object. There is no
code path that makes an object public and none that issues a longer TTL —
`tests/unit/security.test.ts` pins both the constant's value and the absence
of longer literals at call sites.

300 seconds is short enough that a URL leaked into a `Referer` header, a chat
log or a proxy log is very likely already dead, and long enough for a real
download on a phone.

## Path traversal

`sanitizeFileName()` takes the last path segment (`split(/[\\/]/).pop()`) and
then collapses everything outside `[a-zA-Z0-9._-]`. `../` cannot survive
either step. Storage keys are additionally namespaced per carrier.

## Residual risks — accepted, and named

1. **No malware scanning.** An uploaded PDF is a real PDF; it is not checked
   for a malicious payload. Staff open these documents. Mitigation today is
   the type allow-list and that documents are never served to the public.
   A scanning step (e.g. ClamAV in an edge function) is the natural next
   control if the volume justifies it.
2. **No content-level PII validation.** A carrier can upload the wrong
   document; nothing verifies a W-9 is a W-9.
3. **Storage-layer RLS was reviewed by reading migration 0004**, not probed
   in this audit the way the public-schema policies were. Worth including in
   a penetration test.
4. **Overwrite/delete semantics** were not exercised adversarially — whether a
   carrier can clobber their own previously-approved document, and whether
   that is desirable, is an open question for the compliance workflow rather
   than a finding.

## Verdict

No finding. This surface is the strongest part of the application's security
posture: two enforcement layers, magic-byte typing, no SVG, private bucket,
short-lived signed URLs, and a constant pinned by test.
