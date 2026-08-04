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
      /*
       * Phase 2/3 tables (carriers, documents, loads, lead_activities, posts,
       * webhook_events) are added here by their owning modules — or the whole
       * file is replaced by `supabase gen types` output once a project is linked.
       */
    };
    Views: Record<string, never>;
    Functions: {
      current_user_role: { Args: Record<string, never>; Returns: UserRole };
      is_staff: { Args: Record<string, never>; Returns: boolean };
    };
  };
}
