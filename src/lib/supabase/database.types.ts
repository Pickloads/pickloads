/**
 * Database types — hand-authored to match supabase/migrations exactly.
 *
 * ⚠ Once a Supabase project is linked, replace this file with the generated
 * version and diff against it:
 *   supabase gen types typescript --linked > src/lib/supabase/database.types.ts
 * (See docs/modules/M-02-auth-core.md.)
 */

export type UserRole = "admin" | "dispatcher" | "carrier" | "shipper";

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
  | "booked"
  | "in_transit"
  | "delivered"
  | "invoiced"
  | "paid"
  | "cancelled";

export type Locale = "en" | "es" | "fr" | "ru" | "ht";

/* ---------- M-50 enums (migrations 0005–0008) ---------- */
export type MembershipRole = "owner" | "member";
export type AccountStatus = "pending" | "active" | "suspended";
export type SupportStatus = "open" | "answered" | "closed";
export type InvoiceStatus = "draft" | "open" | "paid" | "void" | "uncollectible";

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
}

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
}

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
}

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
}

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
}

type CompanySettingRow = {
  key: string;
  value: unknown;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
}

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
}

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
  created_at: string;
  updated_at: string;
}

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
}

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
}

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
}

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
}

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
}

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
}

type CarrierMembershipRow = {
  carrier_id: string;
  profile_id: string;
  role: MembershipRole;
  created_at: string;
}

type ShipperMembershipRow = {
  shipper_id: string;
  profile_id: string;
  role: MembershipRole;
  created_at: string;
}

type AccountStatusHistoryRow = {
  id: string;
  profile_id: string;
  old_status: AccountStatus | null;
  new_status: AccountStatus;
  reason: string | null;
  changed_by: string | null;
  created_at: string;
}

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
}

type UserPreferencesRow = {
  profile_id: string;
  email_load_updates: boolean;
  email_document_reviews: boolean;
  email_marketing: boolean;
  updated_at: string;
}

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
}

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
}

type SupportThreadRow = {
  id: string;
  profile_id: string;
  carrier_id: string | null;
  shipper_id: string | null;
  subject: string;
  status: SupportStatus;
  created_at: string;
  updated_at: string;
}

type SupportMessageRow = {
  id: string;
  thread_id: string;
  author_id: string;
  /** ≤ 5000 chars (DB check) — render escape-first (M-33 discipline). */
  body: string;
  is_staff: boolean;
  created_at: string;
}

type NotificationRow = {
  id: string;
  profile_id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
}

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
}

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
}

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
  ShipmentEventSource,
  ShipmentEventType,
  ShipmentEventVisibility,
  ShipmentStatus,
  EtaKind,
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
}

type BrokerPartnerMembershipRow = {
  broker_partner_id: string;
  profile_id: string;
  role: MembershipRole;
  created_at: string;
}

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
        Insert: Insertable<AccountStatusHistoryRow, "profile_id" | "new_status">;
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
        Insert: Insertable<SupportMessageRow, "thread_id" | "author_id" | "body">;
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
        Insert: Insertable<AsRow<ShipmentPartyRow>, "shipment_id" | "party_role">;
        Update: Partial<AsRow<ShipmentPartyRow>>;
        Relationships: [];
      };
      shipment_assignments: {
        Row: AsRow<ShipmentAssignmentRow>;
        Insert: Insertable<AsRow<ShipmentAssignmentRow>, "shipment_id" | "carrier_id">;
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
    };
    Views: Record<string, never>;
    Functions: {
      current_user_role: { Args: Record<string, never>; Returns: UserRole };
      is_staff: { Args: Record<string, never>; Returns: boolean };
      my_carrier_ids: { Args: Record<string, never>; Returns: string[] };
      my_shipper_ids: { Args: Record<string, never>; Returns: string[] };
      /** M-71 (0018) — active-filtered, so an unapproved broker org yields
       * nothing (§12). */
      my_broker_partner_ids: { Args: Record<string, never>; Returns: string[] };

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
    };
  };
}
