# M-20/M-21 — Become-a-Carrier Wizard & Secure Uploads

**Status:** ✅ Complete · **Phase:** 2 · **Date:** 2026-08-04

## What was built
`/become-a-carrier` — the 4-step onboarding wizard (audit U-10's biggest
net-new surface, composed strictly from V4 vocabulary: `.steps` as the
progress indicator, `.bigform` fields, `.upload` dropzones; state styling
added to `v4.css` under a U-10/U-03 citation, no new raw hex).

### Flow & session model
1. **Company info** — Zod (`src/lib/validation/onboarding.ts`), Turnstile +
   rate limit via the shared M-14 guard. `startOnboarding` creates the
   `carriers` row (unclaimed: `profile_id` null, `active` false) and returns
   its UUID to the client — the wizard's unguessable bearer handle. It also
   inserts a `carrier_leads` row (`source: become_a_carrier`) so an
   **abandoned wizard still surfaces in the M-23 CRM** with a callable phone
   number, and notifies the dispatch desk by email.
2. **Documents** — four `.upload` dropzones (mc_authority, coi, w9,
   voided_check), drag & drop + keyboard accessible, per-document
   uploading/done/error states and a **retry button** that resends the held
   file. `uploadCarrierDocument` (server action): 10 MB cap and **magic-byte
   sniffing** (`src/lib/uploads.ts` — %PDF/JPEG/PNG/HEIC ftyp brands; client
   MIME and extension are never trusted, S-03), sanitized filename, path
   `{carrierId}/{uuid}-{name}` in the private `carrier-docs` bucket via the
   admin client, `documents` row status `pending`. Per-IP limiter widened to
   30/10min for this action (4 files + retries; `checkRateLimit` gained an
   optional limit arg). A claimed carrier (profile linked) only accepts
   uploads from its owning session — M-25 reuses this action for
   replacements. Max 24 documents per carrier.
3. **Agreement** — honest e-sign panel: with `DROPBOX_SIGN_API_KEY` +
   `DROPBOX_SIGN_TEMPLATE_ID` set the agreement is emailed for signature at
   step 4 (`src/lib/esign.ts`, `send_with_template`, `metadata.carrier_id`
   ties the M-22 webhook back to the row); otherwise the panel says the
   agreement is completing legal review (true — U-09). **ESIGN consent
   checkbox is required** to proceed and is schema-enforced server-side.
4. **Account** — `completeOnboarding`: `auth.admin.createUser`
   (auto-confirmed — judgment call below), profile enriched (phone/company),
   `carriers.profile_id` linked, agreement sent when live, step-1 lead
   advanced to `agreement` + a `lead_activities` note auditing the ESIGN
   consent, internal notification email. Success panel links to `/login`.

### PII encryption (S-01)
`src/lib/crypto.ts` — AES-256-GCM (`v1:<iv>:<tag>:<ct>` format), key derived
by SHA-256 from `PII_ENCRYPTION_KEY`. EIN is stored as ciphertext or NULL —
**never plaintext**; with the key unset the value is dropped with a warning.

## Judgment calls
- **Auto-confirmed accounts** (`email_confirm: true`): the wizard already
  holds the email in-flow, the account is worthless without RLS-scoped portal
  data, and a confirmation dead-end at the final step kills onboarding
  conversion. Revisit if abuse appears (Turnstile + rate limit already gate
  step 1).
- **EIN optional** — many owner-operators onboard with W-9 only.
- **All four documents skippable** — new authorities may not have an MC
  letter yet; the portal (M-25) accepts the rest later. The dispatch desk
  gets the "started" email either way.
- **ESIGN consent audit trail** lives in `lead_activities` (schema is final;
  carriers has no consent column).
- Packet section's upload card now routes to `/become-a-carrier` (was a
  "coming soon" toast); footer "Become a Carrier" links the page; page added
  to the sitemap.

## DB changes
None (schema final). Writes: `carriers`, `documents`, `carrier_leads`,
`lead_activities`, storage `carrier-docs`.

## Endpoints
Server actions: `startOnboarding`, `uploadCarrierDocument`,
`completeOnboarding`.

## Env vars
`PII_ENCRYPTION_KEY` (S-01) · `DROPBOX_SIGN_API_KEY` ·
`DROPBOX_SIGN_TEMPLATE_ID` · `DROPBOX_SIGN_TEST_MODE` (all optional —
everything degrades to honest pending states; secretless builds fully
walkable end-to-end).

## Deployment
Set `PII_ENCRYPTION_KEY` before launch (EINs are dropped, not stored, without
it). Create the Dropbox Sign template from the lawyer-approved agreement with
a signer role named **Carrier**, then set the template id.

## Verification
typecheck ✓ · lint ✓ · build ✓ (112 pages) · secretless walkthrough: wizard
completes all 4 steps with dev-mode warnings, no crashes ✓

## Extension points
- `WIZARD_DOCS` list drives step 2 — add `noa` etc. there.
- `sendAgreementSignatureRequest` is the single e-sign entry point (M-24 can
  re-send from admin).
- Wizard state is in-memory per visit; a resumable server-persisted wizard
  (email link) is a Phase 2+ enhancement.
