-- ============================================================================
-- PickLoads — Migration 0014: newsletter unsubscribe token (M-69 / P-1).
--
-- WHY: `subscribers` has carried `unsubscribed_at` since 0001, but nothing in
-- src/ ever wrote it — there was no unsubscribe route at all, while
-- src/emails/NewsletterConfirmationEmail.tsx promises "unsubscribe anytime".
-- That is a CAN-SPAM exposure on the first marketing send (a working,
-- no-login unsubscribe mechanism is mandatory) and an RFC 8058 one-click
-- gap that hurts deliverability at Gmail/Yahoo.
--
-- WHY A DEDICATED COLUMN instead of reusing `confirm_token`:
--   1. Capability separation. `confirm_token` is the double-opt-in credential
--      (0001 + /api/newsletter/confirm). An unsubscribe link is printed in
--      EVERY marketing send and is deliberately handed to mailbox providers
--      via List-Unsubscribe, so it leaks by design — corporate link scanners,
--      forwarded mail, mail archives. Reusing confirm_token would make every
--      forwarded newsletter a credential that can CONFIRM a pending
--      subscription (opt-in laundering), not just cancel one.
--   2. Lifecycle. src/app/actions/newsletter.tsx resets confirmed_at on
--      re-subscribe and re-sends the same confirm_token; the unsubscribe
--      token must stay stable and independent of that cycle so links printed
--      in older issues keep working.
--   3. Revocability. A future abuse response can rotate ONE of the two
--      tokens without breaking the other flow.
-- Cost: one uuid column. This is the cheap side of the trade.
--
-- The token is unguessable (gen_random_uuid, 122 bits) and is the ONLY
-- credential the unsubscribe route accepts — no email address in the URL, so
-- the endpoint is not an address-enumeration oracle.
--
-- No RLS change: `subscribers` still has exactly one policy ("staff read
-- subscribers", 0002) and zero anon grants. The unsubscribe endpoints run
-- server-side on the service-role client, like every other public write
-- (decision Q3).
--
-- ROLLBACK:
--   alter table subscribers drop column if exists unsubscribe_token;
--   -- (drops idx_subscribers_unsubscribe_token with the column)
--   Safe and lossless: no other object depends on it. Unsubscribe links
--   already mailed stop resolving — the /newsletter/unsubscribe page shows
--   its honest "this link is no longer valid" state and points at
--   support@pickloads.com, so the CAN-SPAM opt-out path degrades to the
--   manual one rather than disappearing.
-- ============================================================================

alter table subscribers
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

-- Existing rows are backfilled by the column default (PG11+ rewrites nothing;
-- the default is volatile so each row gets its own value).

create unique index if not exists idx_subscribers_unsubscribe_token
  on subscribers (unsubscribe_token);

comment on column subscribers.unsubscribe_token is
  'M-69/P-1: single-purpose credential for /newsletter/unsubscribe and the '
  'RFC 8058 List-Unsubscribe one-click POST. Deliberately NOT confirm_token: '
  'this value is printed in every marketing send and handed to mailbox '
  'providers, so it must not be able to confirm a pending subscription.';
