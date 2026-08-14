# PickLoads — Incident Response Plan

Small team, no on-call rotation. This plan is written for one person at
7am with a phone, not for a SOC.

**Every incident:** detect → contain → revoke → rotate → investigate → notify →
recover. Containment beats diagnosis. Rotate first, understand later.

**Owner:** PickLoads Logistics Group LLC (`support@pickloads.com`,
(908) 404-5373).

**Evidence rule:** before revoking anything, screenshot or export the logs you
are about to invalidate. Rotation destroys evidence.

---

## 1. Leaked API key (Resend, Upstash, Stripe, Dropbox Sign, Turnstile)

**Detect:** GitHub secret scanning, provider alert, unexpected usage/billing.

1. Rotate in the provider console **first**. Do not wait to confirm the leak.
2. Update Vercel Production → redeploy.
3. Verify the dependent path works (send a test mail; replay a webhook).
4. Purge the value from history if committed (`git filter-repo`), then force-push
   and tell every clone holder. Rotation still comes first — assume the old
   value is public forever.
5. Review provider logs for use you did not initiate.

## 2. Leaked `SUPABASE_SERVICE_ROLE_KEY` — **treat as full database breach**

1. Rotate the key in Supabase immediately.
2. Update Vercel Production → redeploy.
3. Expect cron and webhooks to fail in the window; they retry.
4. Review Supabase logs for queries not originating from Vercel egress.
5. **Assume every row was readable.** Scope the notification decision (§8) to
   the whole customer base until logs prove otherwise.

## 3. Compromised customer account

1. `profiles.status = 'suspended'` — enforced by `requireProfile` on every
   portal page and resolved at sign-in before redirect.
2. Revoke sessions (Supabase Auth → sign out user).
3. Force password reset.
4. Review `audit_events` and `shipment_tracking_access` for what was reached.
5. Notify the account owner by phone, not only email — their mailbox may be
   the compromised thing.

## 4. Compromised staff/admin account

As above, plus:

1. Revoke **all** staff sessions, not just the suspected one.
2. Review `audit_events` for role changes, document approvals, carrier
   activations, brokerage-gate changes and staff invites in the window.
3. Revoke any `staff_invites` issued during it.
4. Rotate the service-role key if there is any chance the account could reach
   deployment configuration.

## 5. Stolen session token

1. Sign the user out server-side (destroys the session; a client-side cookie
   delete is not sufficient).
2. Rotate credentials for that user.
3. If cookie theft is suspected via XSS, treat it as §6 as well.

## 6. Exposed carrier document

1. Signed URLs expire in 300 s — confirm the exposure window.
2. If a URL leaked, it has very likely already expired; confirm rather than
   assume.
3. If the **bucket** was made public: set it private, rotate the service-role
   key, list every object accessed.
4. W-9 / banking exposure → notify the carrier promptly; this is PII and
   financial data, and US state breach-notification rules may apply. Get legal
   advice before deciding not to notify.

## 7. Malicious upload

1. Delete the object; preserve a hash and the metadata first.
2. Identify the uploading carrier and every staff member who downloaded it.
3. Type allow-list + magic-byte sniffing means executables and SVG never
   entered — verify that held rather than assuming it.

## 8. Database credential leak (pooler / direct Postgres)

1. Rotate the database password in Supabase.
2. Check Supabase network restrictions.
3. Review connection logs for non-Vercel sources.
4. Note: `supabase/.temp/pooler-url` contains a username but **no password**.

## 9. GitHub token leak

1. Revoke the token; audit Actions runs and pushes in the window.
2. Verify `main` history is unmodified (`git log --oneline origin/main`).
3. Rotate every secret the token could read.
4. Enable push protection if it is not already on.

## 10. Fraudulent signature webhook

1. Check `webhook_events` for the event and its signature status.
2. Verify `carriers.agreement_signed_at` against the provider's own record —
   the provider is authoritative, not our row.
3. **Note SEC-P2-02:** the Dropbox Sign signature does not cover the payload.
   If a forged agreement stamp is suspected, this is the first place to look,
   and remediating that finding becomes urgent rather than scheduled.

## 11. Fraudulent Stripe webhook

Signature verification makes forgery impractical. If suspected: confirm the
event in the Stripe dashboard, compare against `webhook_events`, and rotate
`STRIPE_WEBHOOK_SECRET`.

## 12. Supabase outage

Not a security incident — but degradation must not become one.

1. Confirm at `status.supabase.com`.
2. The public marketing site is statically prerendered and stays up.
3. Portals will fail; sign-in returns the honest "couldn't reach the sign-in
   service" message rather than a stack trace.
4. **Do not disable security controls to restore service.** Rate limiting
   already fails open; nothing else should be loosened under pressure.

---

## Notification

Decide with counsel, not alone. Bias toward telling people. Consider notifying
when PII (name, phone, email, address, EIN, banking) or documents may have
been accessed by an unauthorised party — regardless of whether a specific
statute is triggered.

Record for every incident: what happened, when detected, what was accessed,
what was rotated, who was told, what changed so it cannot recur.

## Post-incident

Every incident closes with a regression test or a control change. An incident
that produces only a document repeats.
