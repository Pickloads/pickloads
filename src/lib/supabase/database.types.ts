/**
 * Database types — hand-authored to match supabase/migrations exactly.
 *
 * ⚠ Once a Supabase project is linked, replace this file with the generated
 * version and diff against it:
 *   supabase gen types typescript --linked > src/lib/supabase/database.types.ts
 * (See docs/modules/M-02-auth-core.md.)
 */

/**
 * `broker` added by migration 0028 (M-81).
 *
 * It is a ROUTING and INVITATION fact, never an authorization one: no policy
 * in the chain reads `profiles.role = 'broker'`, and a broker profile with no
 * `broker_partner_memberships` row reads exactly what an outsider reads.
 * `docs/modules/M-81-broker-partner-access.md` argues it; §16 of the RLS suite
 * asserts it.
 */
export type UserRole =
  "admin" | "dispatcher" | "carrier" | "shipper" | "broker";

export type LeadStatus =
  | "new"
  | "call"
  | "qualified"
  | "appointment"
  | "agreement"
  | "waiting_documents"
  | "active"
  | "inactive"
  | "lost";

export type ActivityType =
  | "note"
  | "call"
  | "sms"
  | "email"
  | "status_change"
  | "callback"
  | "appointment";

export type PriorityLevel = "low" | "normal" | "high" | "urgent";

export type DocType =
  | "mc_authority"
  | "coi"
  | "w9"
  | "voided_check"
  | "noa"
  | "dispatch_agreement"
  | "other";

export type DocStatus = "pending" | "approved" | "rejected" | "expired";
export type LeadType = "dispatch" | "new_authority";
export type LoadStatus =
  "booked" | "in_transit" | "delivered" | "invoiced" | "paid" | "cancelled";

export type Locale = "en" | "es" | "fr" | "ru" | "ht";

/* ---------- M-50 enums (migrations 0005–0008) ---------- */
export type MembershipRole = "owner" | "member";
export type AccountStatus = "pending" | "active" | "suspended";
export type SupportStatus = "open" | "answered" | "closed";
export type InvoiceStatus =
  "draft" | "open" | "paid" | "void" | "uncollectible";

type ProfileRow = {
  id: string;
  role: UserRole;
  full_name: string | null;
  phone: string | null;
  company_name: string | null;
  preferred_language: string;
  /** M-50 (0005): approve/suspend state — enforced centrally in requireProfile. */
  status: AccountStatus;
  created_at: string;
  updated_at: string;
};

type CarrierLeadRow = {
  id: string;
  lead_type: LeadType;
  truck_type: string | null;
  trailer_type: string | null;
  home_state: string | null;
  truck_count: string | null;
  phone: string;
  full_name: string | null;
  email: string | null;
  mc_number: string | null;
  source: string;
  locale: string;
  status: LeadStatus;
  assigned_to: string | null;
  priority: PriorityLevel;
  tags: string[];
  callback_at: string | null;
  last_activity_at: string | null;
  first_contacted_at: string | null;
  created_at: string;
  updated_at: string;
};

type FreightQuoteRow = {
  id: string;
  pickup_zip: string | null;
  delivery_zip: string | null;
  pickup_date: string | null;
  commodity: string | null;
  weight_lbs: number | null;
  pallets: string | null;
  equipment: string | null;
  frequency: string | null;
  company_name: string | null;
  email: string;
  phone: string | null;
  locale: string;
  status: LeadStatus;
  quoted_rate: number | null;
  /** M-50 (0008): the M-32 Phase-4 owner FK — RLS "member read own quotes". */
  shipper_id: string | null;
  hazmat: boolean | null;
  temp_controlled: boolean | null;
  temp_min_f: number | null;
  temp_max_f: number | null;
  dims_l_in: number | null;
  dims_w_in: number | null;
  dims_h_in: number | null;
  pickup_address: string | null;
  pickup_city: string | null;
  pickup_state: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  /** M-56 (0011): remaining professional quote-form fields. */
  pickup_company: string | null;
  delivery_company: string | null;
  delivery_deadline: string | null;
  special_instructions: string | null;
  contact_name: string | null;
  created_at: string;
  updated_at: string;
};

type ContactMessageRow = {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  subject: string | null;
  body: string;
  locale: string;
  handled: boolean;
  handled_by: string | null;
  created_at: string;
};

type SubscriberRow = {
  id: string;
  email: string;
  locale: string;
  confirm_token: string;
  /**
   * M-69/P-1 (0014): single-purpose unsubscribe credential. Deliberately
   * separate from confirm_token — this value is printed in every marketing
   * send and handed to mailbox providers via List-Unsubscribe.
   */
  unsubscribe_token: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  created_at: string;
};

type CompanySettingRow = {
  key: string;
  value: unknown;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
};

type EmailLogRow = {
  id: string;
  to_email: string;
  template: string;
  subject: string;
  provider_message_id: string | null;
  status: "sent" | "failed";
  error: string | null;
  lead_id: string | null;
  quote_id: string | null;
  created_at: string;
};

/* ---------- Phase 2 rows (M-02b — carriers/documents/CRM/webhooks) ---------- */

type CarrierRow = {
  id: string;
  profile_id: string | null;
  company_name: string;
  mc_number: string | null;
  dot_number: string | null;
  /** S-01: AES-256-GCM ciphertext (src/lib/crypto.ts) — never plaintext. */
  ein: string | null;
  home_state: string | null;
  factoring_company: string | null;
  insurance_expiry: string | null;
  dispatch_fee_pct: number;
  agreement_signed_at: string | null;
  active: boolean;
  /** M-55 (0010): self-serve dispatch preference (decision D5). */
  preferred_lanes: string | null;
  /** M-55 (0010): self-serve dispatch preference (decision D5). */
  home_time_notes: string | null;
  /** M-55 (0010): staff-assigned dispatcher (M-58 admin UI writes it). */
  assigned_dispatcher_id: string | null;
  /** M-92 (0031): "doing business as" — distinct from the legal entity name. */
  dba: string | null;
  /** M-92 (0031): title of the signing representative ("Owner", "President"). */
  rep_title: string | null;
  /** M-92 (0031): mailing address for the dispatch agreement. */
  address_line1: string | null;
  city: string | null;
  postal_code: string | null;
  /**
   * M-92 (0031): mailing-address state. NOT `home_state`, which is the
   * operating state used for dispatch.
   */
  mailing_state: string | null;
  created_at: string;
  updated_at: string;
};

type DocumentRow = {
  id: string;
  carrier_id: string;
  type: DocType;
  storage_path: string;
  file_name: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  status: DocStatus;
  reviewed_by: string | null;
  review_note: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type LeadActivityRow = {
  id: string;
  lead_id: string | null;
  quote_id: string | null;
  type: ActivityType;
  body: string | null;
  old_status: LeadStatus | null;
  new_status: LeadStatus | null;
  created_by: string | null;
  created_at: string;
};

type WebhookEventRow = {
  id: string;
  provider: string;
  event_id: string;
  event_type: string;
  payload: unknown;
  status: string;
  error: string | null;
  processed_at: string | null;
  created_at: string;
};

/** M-92 (0031). `not_sent` is the ABSENCE of a row, never a stored value. */
export type SignatureRequestStatus =
  | "sent"
  | "viewed"
  | "carrier_signed"
  | "awaiting_countersignature"
  | "completed"
  | "declined"
  | "expired";

type SignatureRequestRow = {
  id: string;
  carrier_id: string;
  provider: string;
  provider_document_id: string;
  agreement_type: string;
  status: SignatureRequestStatus;
  /** Whether the provider treated this as a TEST document — not executed. */
  test_mode: boolean;
  sent_by: string | null;
  sent_at: string;
  viewed_at: string | null;
  carrier_signed_at: string | null;
  completed_at: string | null;
  declined_at: string | null;
  expired_at: string | null;
  decline_reason: string | null;
  created_at: string;
  updated_at: string;
};

/* ---------- Phase 3 rows (M-30 loads, M-33 posts) ---------- */

type LoadRow = {
  id: string;
  carrier_id: string;
  /** F-09: dispatcher attribution for the Dispatch dashboard module. */
  dispatcher_id: string | null;
  broker_name: string | null;
  broker_mc: string | null;
  origin_city: string | null;
  origin_state: string | null;
  dest_city: string | null;
  dest_state: string | null;
  pickup_date: string | null;
  delivery_date: string | null;
  equipment: string | null;
  gross_rate: number | null;
  /** LOADED miles (pickup → delivery). See deadhead_miles for the empty leg. */
  miles: number | null;
  /**
   * M-69/P-7 (0016): empty miles driven to the pickup. NULL = not captured
   * (renders "—"), never 0-by-default — true RPM is
   * gross_rate / (deadhead_miles + miles).
   */
  deadhead_miles: number | null;
  /**
   * F-03: snapshotted from carriers.dispatch_fee_pct by the BEFORE INSERT
   * trigger when omitted. Nullable in DDL (trigger fills it), always set
   * after insert (CHECK loads_fee_pct_applied_present).
   */
  fee_pct_applied: number | null;
  /** Computed by trigger: round(gross_rate * fee_pct_applied / 100, 2). */
  dispatch_fee: number;
  status: LoadStatus;
  rate_con_path: string | null;
  bol_path: string | null;
  pod_path: string | null;
  created_at: string;
  updated_at: string;
};

type PostRow = {
  id: string;
  slug: string;
  locale: string;
  title: string;
  excerpt: string | null;
  category: string | null;
  body_md: string;
  /** V4 blog cover gradient: c1 | c2 | c3 | c4. */
  cover_style: string | null;
  published: boolean;
  published_at: string | null;
  author_id: string | null;
  created_at: string;
  updated_at: string;
};

/* ---------- M-50 rows (migrations 0005–0008) ---------- */

type ShipperRow = {
  id: string;
  company_name: string;
  industry: string | null;
  shipping_frequency: string | null;
  regions: string[] | null;
  phone: string | null;
  billing_email: string | null;
  created_at: string;
  updated_at: string;
};

type CarrierMembershipRow = {
  carrier_id: string;
  profile_id: string;
  role: MembershipRole;
  created_at: string;
};

type ShipperMembershipRow = {
  shipper_id: string;
  profile_id: string;
  role: MembershipRole;
  created_at: string;
};

type AccountStatusHistoryRow = {
  id: string;
  profile_id: string;
  old_status: AccountStatus | null;
  new_status: AccountStatus;
  reason: string | null;
  changed_by: string | null;
  created_at: string;
};

type AuditEventRow = {
  id: string;
  actor_id: string | null;
  /** e.g. 'user.suspend', 'settings.update', 'account.signup'. */
  action: string;
  target_table: string | null;
  target_id: string | null;
  detail: unknown;
  ip: string | null;
  created_at: string;
};

type UserPreferencesRow = {
  profile_id: string;
  email_load_updates: boolean;
  email_document_reviews: boolean;
  email_marketing: boolean;
  /** M-79 (0026) — §17 per-channel opt-out for shipment notifications. */
  email_shipment_updates: boolean;
  inapp_shipment_updates: boolean;
  /** M-79 (0026) — single-purpose credential for /notifications/unsubscribe. */
  notification_token: string;
  updated_at: string;
};

/* ---------- M-79 (0026) — shipment notifications ---------- */

/** §17's eleven customer notifications. Mirrors `notification-rules.ts`. */
type ShipmentNotificationEventDb =
  | "quote_accepted"
  | "carrier_assigned"
  | "driver_dispatched"
  | "picked_up"
  | "in_transit"
  | "delay_reported"
  | "delivery_eta_updated"
  | "arrived_at_delivery"
  | "delivered"
  | "pod_available"
  | "invoice_available";

type NotificationChannelDb = "email" | "in_app";

type NotificationDeliveryStateDb =
  "pending" | "sending" | "sent" | "suppressed" | "dead";

type ShipmentNotificationRuleRow = {
  id: string;
  notification_event: ShipmentNotificationEventDb;
  source_event_type: ShipmentEventType;
  match_status: ShipmentStatus | null;
  match_metadata: Record<string, unknown>;
  require_customer_visible: boolean;
  dedupe_scope: "per_shipment" | "per_source";
  created_at: string;
};

type ShipmentNotificationQueueRow = {
  id: string;
  shipment_id: string;
  notification_event: ShipmentNotificationEventDb;
  channel: NotificationChannelDb;
  recipient_profile_id: string;
  idempotency_key: string;
  source_event_id: string | null;
  payload: Record<string, unknown>;
  state: NotificationDeliveryStateDb;
  attempts: number;
  max_attempts: number;
  available_at: string;
  locked_at: string | null;
  sent_at: string | null;
  last_error: string | null;
  provider_message_id: string | null;
  created_at: string;
  updated_at: string;
};

type ShipmentNotificationAttemptRow = {
  id: string;
  queue_id: string;
  attempt_no: number;
  outcome: "sent" | "failed" | "suppressed" | "skipped";
  provider_message_id: string | null;
  error: string | null;
  created_at: string;
};

type NotificationSuppressionRow = {
  email: string;
  scope: "shipment";
  reason: string | null;
  created_at: string;
};

type ShipmentNotificationWatermarkRow = {
  id: boolean;
  harvested_through: string;
  last_run_at: string | null;
  updated_at: string;
};

type TruckRow = {
  id: string;
  carrier_id: string;
  unit_number: string | null;
  /** Keep in sync with the 8 equipment slugs (src/content). */
  equipment: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  plate: string | null;
  plate_state: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type DriverRow = {
  id: string;
  carrier_id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  cdl_number: string | null;
  cdl_state: string | null;
  cdl_expiry: string | null;
  medical_card_expiry: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type SupportThreadRow = {
  id: string;
  profile_id: string;
  carrier_id: string | null;
  shipper_id: string | null;
  subject: string;
  status: SupportStatus;
  created_at: string;
  updated_at: string;
};

type SupportMessageRow = {
  id: string;
  thread_id: string;
  author_id: string;
  /** ≤ 5000 chars (DB check) — render escape-first (M-33 discipline). */
  body: string;
  is_staff: boolean;
  created_at: string;
};

type NotificationRow = {
  id: string;
  profile_id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

/** M-58 (0012): in-app staff invites (S-04 made self-service). */
type StaffInviteRow = {
  id: string;
  email: string;
  role: UserRole;
  /** SHA-256 hex of the raw token — the token itself is never stored. */
  token_hash: string;
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

type InvoiceRow = {
  id: string;
  /* M-74 (0021): NULLABLE. A shipper invoice names no carrier — 0009's
   * `"member read invoices"` policy is keyed on `carrier_id`, so naming the
   * hauling carrier would disclose the shipper gross (and therefore the
   * margin) to them. `invoices_party_present` keeps the real invariant:
   * every invoice names a carrier or a shipper. */
  carrier_id: string | null;
  load_id: string | null;
  /* M-74 (0021): the §11 shipper-facing linkage. Both null on every
   * pre-0021 (carrier dispatch-fee) invoice. */
  shipment_id: string | null;
  shipper_id: string | null;
  stripe_invoice_id: string | null;
  amount_cents: number;
  currency: string;
  status: InvoiceStatus;
  hosted_url: string | null;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

/* ---------- M-71 rows (migrations 0017–0018) ----------
 *
 * The three shipment row types are IMPORTED, not re-declared. `src/lib/
 * shipments/types.ts` is the source of truth M-71's DDL was written from
 * (M-70's "What M-71 must match" table); a second copy here would be a
 * duplicate DTO of exactly the kind the executive directive forbids, and the
 * first `ALTER` would silently make one of them wrong. The shipment ENUM
 * types live there too — import them from `@/lib/shipments/types`, not from
 * this file.
 *
 * `broker_partners` / `broker_partner_memberships` have no M-70 counterpart
 * (M-70 predates the decision to give `ShipmentRow.broker_partner_id` a real
 * referent), so they are declared here alongside the other 0005-era
 * membership rows they mirror. */
import type {
  ShipmentRow,
  ShipmentPartyRow,
  ShipmentAssignmentRow,
  ShipmentEventRow,
  ShipmentTrackingAccessRow,
  /** M-76 (0023) — the §13 driver update link and its access ledger. */
  ShipmentDriverTokenRow,
  ShipmentDriverTokenAccessRow,
  DriverTokenIssuerRole,
  /** M-77 (0024) — §16 documents and the audience matrix. */
  ShipmentDocumentRow,
  ShipmentDocumentType,
  ShipmentDocumentVisibility,
  ShipmentEventSource,
  ShipmentEventType,
  ShipmentEventVisibility,
  ShipmentStatus,
  EtaKind,
  /** M-75 (0022) — `set_shipment_eta`'s two §10 enums. */
  EtaSource,
  EtaConfidence,
  /** M-78 (0025) — §10's ETA history and §21's exception lifecycle. */
  ShipmentEtaHistoryRow,
  ShipmentExceptionRow,
  ShipmentExceptionSeverity,
  ShipmentExceptionType,
  /** M-80 (0027) — §9's location series and Mode B/C provider connections. */
  ShipmentLocationRow,
  ShipmentLocationVisibility,
  TrackingProvider,
  TrackingConsentStatus,
  TrackingProviderConnectionRow,
} from "@/lib/shipments/types";

/**
 * `src/lib/shipments/types.ts` declares its rows as `interface`, which in
 * TypeScript does NOT carry the implicit index signature that supabase-js's
 * `GenericTable` constraint (`Row: Record<string, unknown>`) requires — a
 * mismatch that silently collapses EVERY table in this file to `never`, not
 * just the new ones. This homomorphic mapped type is the standard adapter: it
 * derives each property from the source type, so it restates nothing and
 * cannot drift. Changing an interface to a type alias upstream would work
 * too, but M-70's file is the published specification M-71's DDL was written
 * against and is better left byte-identical.
 */
type AsRow<T> = { [K in keyof T]: T[K] };

/**
 * M-81 (0029) — §12's verification state.
 *
 * `verified` is the ONLY value `my_broker_partner_ids()` accepts, so the
 * other three are all "reads nothing", distinguished so the LEDGER can tell
 * "not looked at yet" from "looked at and refused" from "was fine, isn't now".
 */
export type BrokerVerificationStatus =
  "pending" | "verified" | "rejected" | "suspended";

type BrokerPartnerRow = {
  id: string;
  company_name: string;
  mc_number: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  /** §12: FALSE until an admin approves. `my_broker_partner_ids()` filters on
   * it, so an unapproved organization grants access to nothing. */
  active: boolean;
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  /** M-81 (0029) — §12 "verified". Required by `my_broker_partner_ids()`. */
  verification_status: BrokerVerificationStatus;
  verified_by: string | null;
  verified_at: string | null;
  /* M-81 (0029) — plan §9.3's vetting field list. Records of what an admin
   * checked; nothing in the schema or in `src/` scores them (§30). */
  dot_number: string | null;
  bond_provider: string | null;
  bond_amount_usd: number | null;
  authority_since: string | null;
  days_to_pay: number | null;
};

/**
 * M-81 (0029) — §12's *"invited by an admin"*, in M-58's idiom.
 *
 * `token_hash` is declared because the SERVER ACTION writes and matches on it;
 * no browser-reachable read exists (0029 grants `authenticated` nothing at all
 * on this table, and there is no member policy).
 */
type BrokerPartnerInviteRow = {
  id: string;
  broker_partner_id: string;
  email: string;
  membership_role: MembershipRole;
  token_hash: string;
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  created_at: string;
};

/** M-81 (0029) — §12 "granted access shipment by shipment". */
type BrokerShipmentGrantRow = {
  id: string;
  shipment_id: string;
  broker_partner_id: string;
  granted_by: string;
  granted_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
  note: string | null;
  created_at: string;
};

/** M-81 (0029) — §12 "or account agreement", bounded by its own window. */
type BrokerAccountAgreementRow = {
  id: string;
  broker_partner_id: string;
  shipper_id: string;
  agreement_reference: string | null;
  starts_at: string;
  ends_at: string | null;
  granted_by: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
  created_at: string;
  updated_at: string;
};

type BrokerPartnerMembershipRow = {
  broker_partner_id: string;
  profile_id: string;
  role: MembershipRole;
  created_at: string;
};

type Insertable<Row, Required extends keyof Row> = Pick<Row, Required> &
  Partial<Omit<Row, Required>>;

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Insertable<ProfileRow, "id">;
        Update: Partial<ProfileRow>;
        Relationships: [];
      };
      carrier_leads: {
        Row: CarrierLeadRow;
        Insert: Insertable<CarrierLeadRow, "phone">;
        Update: Partial<CarrierLeadRow>;
        Relationships: [];
      };
      freight_quotes: {
        Row: FreightQuoteRow;
        Insert: Insertable<FreightQuoteRow, "email">;
        Update: Partial<FreightQuoteRow>;
        Relationships: [];
      };
      contact_messages: {
        Row: ContactMessageRow;
        Insert: Insertable<ContactMessageRow, "email" | "body">;
        Update: Partial<ContactMessageRow>;
        Relationships: [];
      };
      subscribers: {
        Row: SubscriberRow;
        Insert: Insertable<SubscriberRow, "email">;
        Update: Partial<SubscriberRow>;
        Relationships: [];
      };
      company_settings: {
        Row: CompanySettingRow;
        Insert: Insertable<CompanySettingRow, "key" | "value">;
        Update: Partial<CompanySettingRow>;
        Relationships: [];
      };
      email_log: {
        Row: EmailLogRow;
        Insert: Insertable<EmailLogRow, "to_email" | "template" | "subject">;
        Update: Partial<EmailLogRow>;
        Relationships: [];
      };
      carriers: {
        Row: CarrierRow;
        Insert: Insertable<CarrierRow, "company_name">;
        Update: Partial<CarrierRow>;
        Relationships: [];
      };
      documents: {
        Row: DocumentRow;
        Insert: Insertable<DocumentRow, "carrier_id" | "type" | "storage_path">;
        Update: Partial<DocumentRow>;
        Relationships: [];
      };
      lead_activities: {
        Row: LeadActivityRow;
        Insert: Insertable<LeadActivityRow, "type">;
        Update: Partial<LeadActivityRow>;
        Relationships: [];
      };
      signature_requests: {
        Row: SignatureRequestRow;
        Insert: Insertable<
          SignatureRequestRow,
          "carrier_id" | "provider_document_id"
        >;
        Update: Partial<SignatureRequestRow>;
        Relationships: [];
      };
      webhook_events: {
        Row: WebhookEventRow;
        Insert: Insertable<
          WebhookEventRow,
          "provider" | "event_id" | "event_type" | "payload"
        >;
        Update: Partial<WebhookEventRow>;
        Relationships: [];
      };
      loads: {
        // fee_pct_applied/dispatch_fee are trigger-computed (F-03) — inserts
        // omit them unless an admin explicitly overrides the snapshot pct.
        Row: LoadRow;
        Insert: Insertable<LoadRow, "carrier_id">;
        Update: Partial<LoadRow>;
        Relationships: [];
      };
      posts: {
        Row: PostRow;
        Insert: Insertable<PostRow, "slug" | "title" | "body_md">;
        Update: Partial<PostRow>;
        Relationships: [];
      };
      shippers: {
        Row: ShipperRow;
        Insert: Insertable<ShipperRow, "company_name">;
        Update: Partial<ShipperRow>;
        Relationships: [];
      };
      carrier_memberships: {
        Row: CarrierMembershipRow;
        Insert: Insertable<CarrierMembershipRow, "carrier_id" | "profile_id">;
        Update: Partial<CarrierMembershipRow>;
        Relationships: [];
      };
      shipper_memberships: {
        Row: ShipperMembershipRow;
        Insert: Insertable<ShipperMembershipRow, "shipper_id" | "profile_id">;
        Update: Partial<ShipperMembershipRow>;
        Relationships: [];
      };
      account_status_history: {
        Row: AccountStatusHistoryRow;
        Insert: Insertable<
          AccountStatusHistoryRow,
          "profile_id" | "new_status"
        >;
        Update: Partial<AccountStatusHistoryRow>;
        Relationships: [];
      };
      audit_events: {
        Row: AuditEventRow;
        Insert: Insertable<AuditEventRow, "action">;
        Update: Partial<AuditEventRow>;
        Relationships: [];
      };
      user_preferences: {
        Row: UserPreferencesRow;
        Insert: Insertable<UserPreferencesRow, "profile_id">;
        Update: Partial<UserPreferencesRow>;
        Relationships: [];
      };
      trucks: {
        Row: TruckRow;
        Insert: Insertable<TruckRow, "carrier_id" | "equipment">;
        Update: Partial<TruckRow>;
        Relationships: [];
      };
      drivers: {
        Row: DriverRow;
        Insert: Insertable<DriverRow, "carrier_id" | "full_name">;
        Update: Partial<DriverRow>;
        Relationships: [];
      };
      support_threads: {
        Row: SupportThreadRow;
        Insert: Insertable<SupportThreadRow, "profile_id" | "subject">;
        Update: Partial<SupportThreadRow>;
        Relationships: [];
      };
      support_messages: {
        Row: SupportMessageRow;
        Insert: Insertable<
          SupportMessageRow,
          "thread_id" | "author_id" | "body"
        >;
        Update: Partial<SupportMessageRow>;
        Relationships: [];
      };
      notifications: {
        Row: NotificationRow;
        Insert: Insertable<NotificationRow, "profile_id" | "kind" | "title">;
        Update: Partial<NotificationRow>;
        Relationships: [];
      };
      invoices: {
        Row: InvoiceRow;
        Insert: Insertable<InvoiceRow, "carrier_id" | "amount_cents">;
        Update: Partial<InvoiceRow>;
        Relationships: [];
      };
      staff_invites: {
        Row: StaffInviteRow;
        Insert: Insertable<
          StaffInviteRow,
          "email" | "role" | "token_hash" | "invited_by" | "expires_at"
        >;
        Update: Partial<StaffInviteRow>;
        Relationships: [];
      };
      /* ---------- M-71 (0017–0018) ---------- */
      shipments: {
        Row: AsRow<ShipmentRow>;
        /* Everything else is nullable or defaulted in 0017. `tracking_number`
         * is required because it is server-generated (never a DB default) and
         * `id` is not, because `gen_random_uuid()` supplies it. */
        Insert: Insertable<
          AsRow<ShipmentRow>,
          | "tracking_number"
          | "shipper_id"
          | "origin_city"
          | "origin_state"
          | "destination_city"
          | "destination_state"
          | "equipment"
        >;
        Update: Partial<AsRow<ShipmentRow>>;
        Relationships: [];
      };
      shipment_parties: {
        Row: AsRow<ShipmentPartyRow>;
        Insert: Insertable<
          AsRow<ShipmentPartyRow>,
          "shipment_id" | "party_role"
        >;
        Update: Partial<AsRow<ShipmentPartyRow>>;
        Relationships: [];
      };
      shipment_assignments: {
        Row: AsRow<ShipmentAssignmentRow>;
        Insert: Insertable<
          AsRow<ShipmentAssignmentRow>,
          "shipment_id" | "carrier_id"
        >;
        Update: Partial<AsRow<ShipmentAssignmentRow>>;
        Relationships: [];
      };
      /* ---------- M-72 (0019) ----------
       *
       * `Insert` and `Update` are declared for shape completeness only.
       * NOTHING in `src/` writes this table directly: 0019 grants no customer
       * write policy and an append-only trigger refuses every UPDATE and
       * DELETE, for every role including the service role. Writes go through
       * the five SECURITY DEFINER functions below, called from
       * `src/lib/shipments/apply-transition.ts`. */
      shipment_events: {
        Row: AsRow<ShipmentEventRow>;
        Insert: Insertable<
          AsRow<ShipmentEventRow>,
          "shipment_id" | "event_type" | "source"
        >;
        Update: Partial<AsRow<ShipmentEventRow>>;
        Relationships: [];
      };
      /* ---------- M-73 (0020) ----------
       *
       * Append-only §19 access ledger. `Insert` is the only member `src/`
       * uses (`src/lib/shipments/public-lookup.ts`, via the service-role
       * client); `Update` is declared for shape completeness and is
       * unreachable — 0020's trigger refuses every UPDATE and DELETE for
       * every role, service role included.
       *
       * NOTE WHAT IS ABSENT FROM THE ROW TYPE: any field able to carry the
       * attempted SECONDARY VALUE. M-70's interface has none, 0020's table has
       * no column, and the insert helper takes no parameter — three
       * independent constructions of the same guarantee. */
      shipment_tracking_access: {
        Row: AsRow<ShipmentTrackingAccessRow>;
        Insert: Insertable<
          AsRow<ShipmentTrackingAccessRow>,
          "tracking_number_attempted" | "outcome"
        >;
        Update: Partial<AsRow<ShipmentTrackingAccessRow>>;
        Relationships: [];
      };
      /* M-76 (0023) — `shipment_driver_tokens`.
       *
       * `Insert` and `Update` are declared for shape completeness and are
       * UNREACHABLE from `src/`: every write goes through 0023's four
       * `security definer` functions, which are the only things granted
       * EXECUTE to `service_role`. `token_hash` is additionally revoked at
       * COLUMN level from `authenticated` and `anon`, so the browser-facing
       * projection (`DRIVER_TOKEN_VIEW_COLUMNS`) is enforced by the database
       * and not only by the string. */
      shipment_driver_tokens: {
        Row: AsRow<ShipmentDriverTokenRow>;
        Insert: Insertable<
          AsRow<ShipmentDriverTokenRow>,
          | "shipment_id"
          | "carrier_id"
          | "token_hash"
          | "issued_by_role"
          | "expires_at"
        >;
        Update: Partial<AsRow<ShipmentDriverTokenRow>>;
        Relationships: [];
      };
      /* M-76 (0023) — the append-only §13 audit ledger. `Insert` is the one
       * member `src/` uses (`driver-access.ts`, for the `update_rejected`
       * outcome the SQL function cannot know about); `Update` is unreachable
       * — 0023's trigger refuses every UPDATE and DELETE for every role,
       * service role included. */
      shipment_driver_token_access: {
        Row: AsRow<ShipmentDriverTokenAccessRow>;
        Insert: Insertable<AsRow<ShipmentDriverTokenAccessRow>, "outcome">;
        Update: Partial<AsRow<ShipmentDriverTokenAccessRow>>;
        Relationships: [];
      };
      /* M-77 (0024) — §16 shipment documents.
       *
       * `Insert` and `Update` are declared for shape completeness and are
       * UNREACHABLE from `src/`: 0024 grants no customer write policy and
       * revokes everything but SELECT from `authenticated`. Every write goes
       * through `add_shipment_document()` / `review_shipment_document()`,
       * granted to `service_role` only — which is what makes the per-uploader
       * doc-type allow-list (`UPLOADABLE_DOC_TYPES`) unbypassable rather than
       * merely conventional.
       *
       * NOTE WHAT CUSTOMER SURFACES NEVER PROJECT: `storage_path`. It is the
       * argument a signed URL is minted from; `CustomerDocumentDto` in
       * `src/lib/shipments/documents.ts` does not carry it, so a page cannot
       * ask for a URL to a path it was never shown. */
      shipment_documents: {
        Row: AsRow<ShipmentDocumentRow>;
        Insert: Insertable<
          AsRow<ShipmentDocumentRow>,
          | "shipment_id"
          | "doc_type"
          | "visibility"
          | "storage_path"
          | "file_name"
        >;
        Update: Partial<AsRow<ShipmentDocumentRow>>;
        Relationships: [];
      };
      /* M-77 (0024) — the §16 MATRIX itself, as rows. Read-only to every
       * role: the seed in 0024 is the only writer, and changing who may see a
       * POD is a migration, not an UPDATE. */
      shipment_document_audiences: {
        Row: {
          doc_type: ShipmentDocumentType;
          audience: ShipmentDocumentVisibility;
        };
        Insert: {
          doc_type: ShipmentDocumentType;
          audience: ShipmentDocumentVisibility;
        };
        Update: Partial<{
          doc_type: ShipmentDocumentType;
          audience: ShipmentDocumentVisibility;
        }>;
        Relationships: [];
      };
      /* M-78 (0025) — §10's ETA history.
       *
       * `Insert` and `Update` are declared for shape completeness and are
       * UNREACHABLE from `src/`: 0025 grants `authenticated`/`anon` nothing,
       * an append-only trigger refuses every UPDATE and DELETE for every role
       * including the service role, and the only writer is
       * `set_shipment_eta()` — which writes the history row in the SAME
       * transaction as the column change, so an ETA whose previous value was
       * not preserved is not a state the system can reach. */
      shipment_eta_history: {
        Row: AsRow<ShipmentEtaHistoryRow>;
        Insert: Insertable<
          AsRow<ShipmentEtaHistoryRow>,
          "shipment_id" | "eta_kind" | "eta_source"
        >;
        Update: Partial<AsRow<ShipmentEtaHistoryRow>>;
        Relationships: [];
      };
      /* M-78 (0025) — §21's exception lifecycle.
       *
       * STAFF-ONLY at the table level, and that is the security design rather
       * than an omission: §21 forbids exposing `internal_description` and
       * `resolution`, a ROW policy cannot restrict a COLUMN, and staff share
       * the `authenticated` role with customers so a column REVOKE would blind
       * dispatch. Customers read `my_shipment_exceptions()` instead, whose
       * RETURN TYPE is the allow-list.
       *
       * `Insert`/`Update` are unreachable from `src/`: every write goes
       * through `open_shipment_exception()` / `resolve_shipment_exception()` /
       * `update_shipment_exception()`, granted to `service_role` only. */
      shipment_exceptions: {
        Row: AsRow<ShipmentExceptionRow>;
        Insert: Insertable<
          AsRow<ShipmentExceptionRow>,
          "shipment_id" | "exception_type"
        >;
        Update: Partial<AsRow<ShipmentExceptionRow>>;
        Relationships: [];
      };
      /* M-79 (0026) — §17's notification infrastructure.
       *
       * All five are STAFF-READ at the table level and have NO write policy
       * for any role: every write goes through the four `security definer`
       * functions below, granted to `service_role` alone. The `Insert`/
       * `Update` shapes are declared for completeness and are unreachable
       * from `src/` — except `notification_suppressions`, which the tokenized
       * opt-out writes through the admin client (it is the customer's own
       * request, and it must work with no session at all). */
      shipment_notification_rules: {
        Row: ShipmentNotificationRuleRow;
        Insert: Insertable<
          ShipmentNotificationRuleRow,
          "notification_event" | "source_event_type" | "dedupe_scope"
        >;
        Update: Partial<ShipmentNotificationRuleRow>;
        Relationships: [];
      };
      shipment_notification_queue: {
        Row: ShipmentNotificationQueueRow;
        Insert: Insertable<
          ShipmentNotificationQueueRow,
          | "shipment_id"
          | "notification_event"
          | "channel"
          | "recipient_profile_id"
          | "idempotency_key"
        >;
        Update: Partial<ShipmentNotificationQueueRow>;
        Relationships: [];
      };
      shipment_notification_attempts: {
        Row: ShipmentNotificationAttemptRow;
        Insert: Insertable<
          ShipmentNotificationAttemptRow,
          "queue_id" | "attempt_no" | "outcome"
        >;
        Update: Partial<ShipmentNotificationAttemptRow>;
        Relationships: [];
      };
      shipment_notification_watermark: {
        Row: ShipmentNotificationWatermarkRow;
        Insert: Insertable<ShipmentNotificationWatermarkRow, "id">;
        Update: Partial<ShipmentNotificationWatermarkRow>;
        Relationships: [];
      };
      notification_suppressions: {
        Row: NotificationSuppressionRow;
        Insert: Insertable<NotificationSuppressionRow, "email">;
        Update: Partial<NotificationSuppressionRow>;
        Relationships: [];
      };
      /* M-80 (0027) — §9's PURGEABLE position series.
       *
       * STAFF-ONLY at the table level, for the same reason `shipment_
       * exceptions` is: a ROW policy cannot restrict a COLUMN, `raw_metadata`
       * is a third party's payload, and staff share `authenticated` with
       * customers so a column REVOKE would blind dispatch. Customers read
       * `my_shipment_locations()` instead, whose RETURN TYPE is the
       * allow-list and which applies §9's four privacy levels in SQL.
       *
       * `Insert`/`Update` are unreachable from `src/`: the only writers are
       * `record_shipment_location()` (service_role) and 0027's
       * `shipment_events` mirror trigger, and UPDATE is refused outright by
       * `trg_shipment_locations_no_update`. DELETE belongs to
       * `purge_expired_shipment_locations()` alone. */
      shipment_locations: {
        Row: AsRow<ShipmentLocationRow>;
        Insert: Insertable<
          AsRow<ShipmentLocationRow>,
          "shipment_id" | "source"
        >;
        Update: Partial<AsRow<ShipmentLocationRow>>;
        Relationships: [];
      };
      /* M-80 (0027) — §9 Mode B's per-shipment tracking link and Mode C
       * groundwork. STAFF ONLY: no customer policy exists, and `tracking_url`
       * reaches no customer DTO at any audience. Holds NO integration
       * credential (§15) — a CHECK refuses credential-shaped URLs. */
      tracking_provider_connections: {
        Row: AsRow<TrackingProviderConnectionRow>;
        Insert: Insertable<
          AsRow<TrackingProviderConnectionRow>,
          "shipment_id" | "provider"
        >;
        Update: Partial<AsRow<TrackingProviderConnectionRow>>;
        Relationships: [];
      };
      broker_partners: {
        Row: BrokerPartnerRow;
        Insert: Insertable<BrokerPartnerRow, "company_name">;
        Update: Partial<BrokerPartnerRow>;
        Relationships: [];
      };
      broker_partner_memberships: {
        Row: BrokerPartnerMembershipRow;
        Insert: Insertable<
          BrokerPartnerMembershipRow,
          "broker_partner_id" | "profile_id"
        >;
        Update: Partial<BrokerPartnerMembershipRow>;
        Relationships: [];
      };
      /* M-81 (0029) — §12's invitation, and its two grant shapes. All three
       * are STAFF-WRITE ONLY: 0029 creates no customer INSERT/UPDATE/DELETE
       * policy on any of them, so a broker can neither invite themselves nor
       * grant themselves a shipment. */
      broker_partner_invites: {
        Row: BrokerPartnerInviteRow;
        Insert: Insertable<
          BrokerPartnerInviteRow,
          | "broker_partner_id"
          | "email"
          | "token_hash"
          | "invited_by"
          | "expires_at"
        >;
        Update: Partial<BrokerPartnerInviteRow>;
        Relationships: [];
      };
      broker_shipment_grants: {
        Row: BrokerShipmentGrantRow;
        Insert: Insertable<
          BrokerShipmentGrantRow,
          "shipment_id" | "broker_partner_id" | "granted_by"
        >;
        Update: Partial<BrokerShipmentGrantRow>;
        Relationships: [];
      };
      broker_account_agreements: {
        Row: BrokerAccountAgreementRow;
        Insert: Insertable<
          BrokerAccountAgreementRow,
          "broker_partner_id" | "shipper_id" | "granted_by"
        >;
        Update: Partial<BrokerAccountAgreementRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      current_user_role: { Args: Record<string, never>; Returns: UserRole };
      is_staff: { Args: Record<string, never>; Returns: boolean };
      my_carrier_ids: { Args: Record<string, never>; Returns: string[] };
      my_shipper_ids: { Args: Record<string, never>; Returns: string[] };
      /** M-71 (0018), NARROWED by M-81 (0029) — active AND `verified`, so an
       * unapproved OR unverified broker org yields nothing (§12). */
      my_broker_partner_ids: { Args: Record<string, never>; Returns: string[] };
      /** M-81 (0029) — the ONE definition of "this broker may read this
       * shipment": party link OR live per-shipment grant OR live account
       * agreement. Granted to `authenticated`; used only from policy USING
       * clauses. */
      broker_can_read_shipment: {
        Args: { p_shipment_id: string };
        Returns: boolean;
      };
      /** M-81 (0029) — §12's verification act, `service_role` only. */
      verify_broker_partner: {
        Args: {
          p_broker_partner_id: string;
          p_actor_id: string;
          p_verified: boolean;
          p_note?: string | null;
        };
        Returns: unknown;
      };

      /* ---------- M-72 (0019) — the shipment write path ----------
       *
       * All five are SECURITY DEFINER with EXECUTE granted to `service_role`
       * ONLY, so they are reachable exclusively from server code holding the
       * service-role key (`src/lib/shipments/apply-transition.ts`). Every
       * `Returns` is `unknown` for the same reason `webhook_events.payload`
       * is: the function returns `jsonb`, and a hand-written interface here
       * would be a second contract to keep in step with the SQL. The caller
       * narrows once, in one file. */
      shipment_transition_facts: {
        Args: { p_shipment_id: string };
        Returns: unknown;
      };
      apply_shipment_transition: {
        Args: {
          p_shipment_id: string;
          p_expected_status: ShipmentStatus;
          p_new_status: ShipmentStatus;
          p_source: ShipmentEventSource;
          p_actor?: string | null;
          p_visibility?: ShipmentEventVisibility;
          p_event_time?: string;
          p_public_message?: string | null;
          p_internal_message?: string | null;
          p_city?: string | null;
          p_state?: string | null;
          p_latitude?: number | null;
          p_longitude?: number | null;
          p_metadata?: unknown;
          p_external_event_id?: string | null;
          p_idempotency_key?: string | null;
          p_cancellation_reason?: string | null;
          p_event_type?: ShipmentEventType;
        };
        Returns: unknown;
      };
      append_shipment_event: {
        Args: {
          p_shipment_id: string;
          p_event_type: ShipmentEventType;
          p_source: ShipmentEventSource;
          p_actor?: string | null;
          p_visibility?: ShipmentEventVisibility;
          p_event_time?: string;
          p_public_message?: string | null;
          p_internal_message?: string | null;
          p_city?: string | null;
          p_state?: string | null;
          p_latitude?: number | null;
          p_longitude?: number | null;
          p_metadata?: unknown;
          p_external_event_id?: string | null;
          p_idempotency_key?: string | null;
          p_status?: ShipmentStatus | null;
        };
        Returns: unknown;
      };
      set_shipment_appointment: {
        Args: {
          p_shipment_id: string;
          p_kind: EtaKind;
          p_new_at: string | null;
          p_source: ShipmentEventSource;
          p_actor?: string | null;
          p_visibility?: ShipmentEventVisibility;
          p_reason?: string | null;
          p_public_message?: string | null;
          p_internal_message?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: unknown;
      };
      apply_shipment_correction: {
        Args: {
          p_shipment_id: string;
          p_expected_status: ShipmentStatus;
          p_corrected_status: ShipmentStatus;
          p_reason: string;
          p_actor?: string | null;
          p_visibility?: ShipmentEventVisibility;
          p_public_message?: string | null;
          p_event_time?: string;
          p_metadata?: unknown;
          p_idempotency_key?: string | null;
        };
        Returns: unknown;
      };

      /* ---------- M-75 (0022) — the dispatcher write path ----------
       *
       * Same contract as 0019's five: SECURITY DEFINER, EXECUTE to
       * `service_role` only, `jsonb` in and out, narrowed once by the caller
       * (`src/lib/shipments/{create,assignments,eta}.ts`). Each exists
       * because its operation is two-to-three writes that must be one
       * transaction — see the migration header for the argument. */
      create_shipment: {
        Args: {
          p_payload: unknown;
          p_actor?: string | null;
          p_source?: ShipmentEventSource;
          p_public_message?: string | null;
          p_internal_message?: string | null;
        };
        Returns: unknown;
      };
      assign_shipment_carrier: {
        Args: {
          p_shipment_id: string;
          p_carrier_id: string;
          p_driver_id?: string | null;
          p_truck_id?: string | null;
          p_dispatcher_id?: string | null;
          p_actor?: string | null;
          p_source?: ShipmentEventSource;
          p_visibility?: ShipmentEventVisibility;
          p_public_message?: string | null;
          p_internal_message?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: unknown;
      };
      release_shipment_assignment: {
        Args: {
          p_shipment_id: string;
          p_reason?: string | null;
          p_actor?: string | null;
          p_source?: ShipmentEventSource;
          p_visibility?: ShipmentEventVisibility;
          p_public_message?: string | null;
          p_internal_message?: string | null;
          p_clear_carrier?: boolean;
          p_idempotency_key?: string | null;
        };
        Returns: unknown;
      };
      set_shipment_eta: {
        Args: {
          p_shipment_id: string;
          p_kind: EtaKind;
          p_new_eta_at: string | null;
          p_eta_source: EtaSource;
          p_eta_confidence?: EtaConfidence | null;
          p_delay_minutes?: number | null;
          p_reason_public?: string | null;
          p_reason_internal?: string | null;
          p_actor?: string | null;
          p_source?: ShipmentEventSource;
          p_visibility?: ShipmentEventVisibility;
          p_idempotency_key?: string | null;
          p_public_message?: string | null;
        };
        Returns: unknown;
      };

      /* ---------- M-76 (0023) — the driver-link write path ----------
       *
       * Same contract as 0019's five and 0022's four: SECURITY DEFINER,
       * EXECUTE to `service_role` only, `jsonb` in and out, narrowed once by
       * the caller (`src/lib/shipments/driver-access.ts`).
       *
       * `redeem_shipment_driver_token` takes the HASH, never the token — the
       * plaintext exists only in the URL the driver holds and in the one
       * response that issued it. */
      issue_shipment_driver_token: {
        Args: {
          p_shipment_id: string;
          p_carrier_id: string;
          p_token_hash: string;
          p_expires_at: string;
          p_driver_id?: string | null;
          p_driver_name?: string | null;
          p_issued_by_role?: DriverTokenIssuerRole;
          p_issued_by?: string | null;
          p_label?: string | null;
          p_source?: ShipmentEventSource;
        };
        Returns: unknown;
      };
      revoke_shipment_driver_token: {
        Args: {
          p_token_id: string;
          p_reason?: string | null;
          p_actor?: string | null;
          p_source?: ShipmentEventSource;
        };
        Returns: unknown;
      };
      redeem_shipment_driver_token: {
        Args: {
          p_token_hash: string;
          p_ip?: string | null;
          p_user_agent?: string | null;
          p_window_minutes?: number;
          p_fail_limit?: number;
          p_total_limit?: number;
        };
        Returns: unknown;
      };
      set_driver_token_consent: {
        Args: {
          p_token_hash: string;
          p_granted: boolean;
          p_ip?: string | null;
          p_user_agent?: string | null;
        };
        Returns: unknown;
      };

      /* ---------- M-77 (0024) — the §16 document write path ----------
       *
       * Same contract as every shipment function before them: SECURITY
       * DEFINER, EXECUTE to `service_role` only, `jsonb` in and out, narrowed
       * once by the caller (`src/lib/shipments/document-store.ts`). Each
       * exists because its operation is a row write AND a §7 event that must
       * be one transaction — a document with no `document_uploaded` event is
       * a file nobody can explain, and an event with no document is a
       * timeline entry that lies. */
      add_shipment_document: {
        Args: {
          p_shipment_id: string;
          p_doc_type: ShipmentDocumentType;
          p_storage_path: string;
          p_file_name: string;
          p_mime_type?: string | null;
          p_size_bytes?: number | null;
          p_actor?: string | null;
          p_source?: ShipmentEventSource;
          p_visibility?: ShipmentDocumentVisibility | null;
          p_idempotency_key?: string | null;
        };
        Returns: unknown;
      };
      review_shipment_document: {
        Args: {
          p_document_id: string;
          p_decision: DocStatus;
          p_actor?: string | null;
          p_note?: string | null;
          p_source?: ShipmentEventSource;
          p_public_message?: string | null;
        };
        Returns: unknown;
      };
      /** M-77 (0024) — §11's ninth shipper tile. Returns a COUNT and nothing
       * else: §16 keeps unapproved documents out of customer hands, so a
       * `count: exact` under a shipper session would report 0 for a queue of
       * five. Scope comes from `my_shipper_ids()` inside the function, never
       * from an argument. */
      count_shipment_documents_awaiting_review: {
        Args: Record<string, never>;
        Returns: number;
      };
      /** M-77 (0024) — the §16 matrix predicate, exposed for the RLS proofs.
       * `authenticated` may execute it; it decides about a TYPE, never about
       * a row, so it discloses policy and not data. */
      shipment_document_reaches_audience: {
        Args: {
          p_doc_type: ShipmentDocumentType;
          p_visibility: ShipmentDocumentVisibility;
          p_status: DocStatus;
          p_audience: ShipmentDocumentVisibility;
        };
        Returns: boolean;
      };

      /* ---------- M-78 (0025) — the §21 exception write path ----------
       *
       * Same contract as every shipment function before them: SECURITY
       * DEFINER, EXECUTE to `service_role` only, `jsonb` in and out, narrowed
       * once by the caller (`src/lib/shipments/exceptions.ts`). Each exists
       * because its operation is a row write AND a §7 event that must be one
       * transaction — an exception with no `exception_opened` event is
       * invisible on the timeline it is supposed to explain, and an event
       * with no row has no lifecycle to close. */
      open_shipment_exception: {
        Args: {
          p_shipment_id: string;
          p_exception_type: ShipmentExceptionType;
          p_severity?: ShipmentExceptionSeverity;
          p_public_description?: string | null;
          p_internal_description?: string | null;
          p_opened_by?: string | null;
          p_assigned_to?: string | null;
          p_source?: ShipmentEventSource;
          p_idempotency_key?: string | null;
          p_metadata?: unknown;
        };
        Returns: unknown;
      };
      resolve_shipment_exception: {
        Args: {
          p_exception_id: string;
          p_resolution: string;
          p_actor?: string | null;
          p_source?: ShipmentEventSource;
          p_public_message?: string | null;
          p_internal_message?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: unknown;
      };
      /** Triage only, and only while OPEN. No timeline event: re-assigning an
       * exception is internal routing, not customer history. */
      update_shipment_exception: {
        Args: {
          p_exception_id: string;
          p_assigned_to?: string | null;
          p_mark_customer_notified?: boolean;
          p_severity?: ShipmentExceptionSeverity | null;
          p_public_description?: string | null;
          p_actor?: string | null;
        };
        Returns: unknown;
      };
      /** M-78 (0025) — the CALM projection, for shipper/carrier/broker
       * surfaces. `authenticated` may execute it; the audience is resolved
       * from the caller's own memberships INSIDE the function, never from an
       * argument, and the return type carries no `internal_description` and
       * no `resolution` — which is what makes §21's non-exposure rule a
       * property of the database rather than of a projection string. */
      my_shipment_exceptions: {
        Args: { p_shipment_id: string };
        Returns: {
          id: string;
          shipment_id: string;
          exception_type: ShipmentExceptionType;
          severity: ShipmentExceptionSeverity;
          public_description: string | null;
          opened_at: string;
          resolved_at: string | null;
        }[];
      };
      /** M-78 (0025) — migrate M-75/M-76 event-only exceptions into rows.
       * Idempotent, non-destructive, returns the number inserted. Called once
       * by the migration; re-runnable by an operator (see the runbook). */
      backfill_shipment_exceptions: {
        Args: Record<string, never>;
        Returns: number;
      };

      /* ---------- M-79 (0026) — §17's background notification path ----------
       *
       * All four are SECURITY DEFINER with EXECUTE granted to `service_role`
       * only, and `src/lib/shipments/notification-queue.ts` is the ONLY caller
       * in `src/`. Each exists because the operation is two-to-three writes
       * that must be one transaction — the same argument M-72 made for the
       * transition engine. */

      /** Map new shipment_events (and shipper invoices) onto queue rows.
       *  Idempotent: every insert conflicts against the unique idempotency
       *  key. Returns `{scanned, enqueued, from, through}`. */
      harvest_shipment_notifications: {
        Args: { p_limit?: number; p_overlap?: string };
        Returns: {
          scanned: number;
          enqueued: number;
          from: string;
          through: string;
        };
      };
      /** Idempotent single enqueue. Returns `{id, deduped}` — §17's dedupe is
       *  OBSERVABLE, the same doctrine as 0019's `replayed`. */
      enqueue_shipment_notification: {
        Args: {
          p_shipment_id: string;
          p_event: ShipmentNotificationEventDb;
          p_channel: NotificationChannelDb;
          p_recipient_profile_id: string;
          p_idempotency_key: string;
          p_payload?: Record<string, unknown>;
          p_source_event_id?: string | null;
        };
        Returns: { id: string; deduped: boolean };
      };
      /** Claim due rows with `for update skip locked`, marking them `sending`
       *  and counting the attempt. Two concurrent workers split the batch
       *  rather than double-sending it. */
      claim_shipment_notifications: {
        Args: { p_limit?: number; p_lock_ttl?: string };
        Returns: ShipmentNotificationQueueRow[];
      };
      /** Close one attempt: append the ledger row and move the queue row
       *  (sent / suppressed / retry-with-backoff / dead) in ONE transaction. */
      settle_shipment_notification: {
        Args: {
          p_id: string;
          p_outcome: "sent" | "failed" | "suppressed" | "skipped";
          p_provider_message_id?: string | null;
          p_error?: string | null;
          p_retry_after_seconds?: number | null;
        };
        Returns: {
          id: string;
          state: NotificationDeliveryStateDb;
          attempts: number;
          available_at: string;
        };
      };

      /* ---------- M-80 (0027) — §9's locations, providers and retention ----
       *
       * Five are SECURITY DEFINER with EXECUTE granted to `service_role`
       * alone (`src/lib/shipments/locations.ts` is the only caller in
       * `src/`); `my_shipment_locations` is the ONE granted to
       * `authenticated`, because it is a READ whose projection and audience
       * resolution are the security control. */

      /** The customer location history. Audience resolved from the caller's
       *  own memberships INSIDE the function; §9's four privacy levels
       *  applied in SQL; the return type carries no `raw_metadata`, no
       *  `external_event_id` and no `provider`. */
      my_shipment_locations: {
        Args: { p_shipment_id: string; p_limit?: number };
        Returns: {
          recorded_at: string;
          city: string | null;
          state: string | null;
          latitude: number | null;
          longitude: number | null;
          speed_mph: number | null;
          source: ShipmentEventSource;
        }[];
      };
      /** Ingest one reading. Dedupes on the partial unique index and reports
       *  which happened; advances `shipments.current_*` only when the reading
       *  is NEWER than what is on the row. */
      record_shipment_location: {
        Args: {
          p_shipment_id: string;
          p_recorded_at?: string | null;
          p_latitude?: number | null;
          p_longitude?: number | null;
          p_city?: string | null;
          p_state?: string | null;
          p_speed_mph?: number | null;
          p_heading_degrees?: number | null;
          p_source?: ShipmentEventSource;
          p_provider?: TrackingProvider | null;
          p_external_event_id?: string | null;
          p_raw_metadata?: Record<string, unknown>;
        };
        Returns: { deduped: boolean; location_id: string | null };
      };
      /** §9's four levels, write side. Narrowing is a dispatcher action;
       *  WIDENING is admin only (PL403) — see
       *  `src/lib/shipments/location-visibility.ts`. */
      set_shipment_location_visibility: {
        Args: {
          p_shipment_id: string;
          p_level: ShipmentLocationVisibility;
          p_actor_id: string | null;
          p_actor_role: string;
        };
        Returns: unknown;
      };
      /** Attach a Mode B link, revoking any active one in the same
       *  statement. */
      attach_tracking_provider_connection: {
        Args: {
          p_shipment_id: string;
          p_provider: TrackingProvider;
          p_external_tracking_id?: string | null;
          p_tracking_url?: string | null;
          p_expires_at?: string | null;
          p_consent_status?: TrackingConsentStatus;
          p_actor_id?: string | null;
        };
        Returns: unknown;
      };
      revoke_tracking_provider_connection: {
        Args: {
          p_connection_id: string;
          p_actor_id?: string | null;
          p_reason?: string | null;
        };
        Returns: unknown;
      };
      /** THE RETENTION EXECUTOR (§9). Bounded per call; returns the window
       *  used, the cutoff, the number deleted and whether more remain.
       *  Called nightly by `/api/cron/daily`. */
      purge_expired_shipment_locations: {
        Args: { p_retention_days?: number | null; p_limit?: number | null };
        Returns: unknown;
      };
      /** The configured window in days. Fails safe to 90 — never to
       *  "keep forever". */
      location_retention_days: {
        Args: Record<string, never>;
        Returns: number;
      };

      /* ---------- M-83 (0030) — §19's two structural gaps ---------------- */

      /** The §18 staff-only columns, which 0030 §4 revoked from every browser
       *  role. Returns AT MOST ONE ROW, and no row at all to a caller who may
       *  not see the shipment — a row of nulls would have been an existence
       *  oracle. Staff (in scope) get all four; the hauling carrier gets
       *  `carrier_pay` and three nulls; everybody else gets nothing. */
      shipment_restricted_fields: {
        Args: { p_shipment_id: string };
        Returns: {
          gross_shipper_amount: number | null;
          carrier_pay: number | null;
          margin: number | null;
          delay_reason_internal: string | null;
        }[];
      };
    };
  };
};
