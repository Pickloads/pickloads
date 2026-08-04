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
  miles: number | null;
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
  carrier_id: string;
  load_id: string | null;
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
    };
    Views: Record<string, never>;
    Functions: {
      current_user_role: { Args: Record<string, never>; Returns: UserRole };
      is_staff: { Args: Record<string, never>; Returns: boolean };
      my_carrier_ids: { Args: Record<string, never>; Returns: string[] };
      my_shipper_ids: { Args: Record<string, never>; Returns: string[] };
    };
  };
}
