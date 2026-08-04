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

type ProfileRow = {
  id: string;
  role: UserRole;
  full_name: string | null;
  phone: string | null;
  company_name: string | null;
  preferred_language: string;
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
      /*
       * Phase 3 tables (loads, posts) are added here by their owning modules —
       * or the whole file is replaced by `supabase gen types` output once a
       * project is linked.
       */
    };
    Views: Record<string, never>;
    Functions: {
      current_user_role: { Args: Record<string, never>; Returns: UserRole };
      is_staff: { Args: Record<string, never>; Returns: boolean };
    };
  };
}
