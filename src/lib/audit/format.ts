/**
 * M-101 — the presentation layer for `audit_events`.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * The security log rendered `JSON.stringify(event.detail)` straight into a
 * table cell. That is two problems wearing one coat.
 *
 * The visible one is that an administrator had to decode
 * `{"risk_tier":"manual_review"}` to learn that a carrier needs review.
 *
 * The other is a security problem, and it is the reason this module leads
 * with an ALLOWLIST rather than a denylist. `detail` is a free-form
 * `Record<string, unknown>` written by ~30 call sites across the codebase.
 * `JSON.stringify` renders whatever is in it — including any key a future
 * call site adds. `src/lib/audit.ts` documents "never carries secrets" as a
 * convention, and a convention is not an enforcement point. On the SECURITY
 * LOG in particular, the renderer must be the enforcement point: a key that
 * nobody has explicitly described here does not reach the screen.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────
 *
 * It does not touch storage. `formatAuditEvent` is pure: same row in, same
 * strings out, and the row it was given is returned unmodified. No action
 * constant is renamed, no `detail` key is rewritten, nothing is deleted from
 * the ledger. Everything here is a reading of a record that stays exactly as
 * it was written.
 */

export type AuditTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface AuditEventRow {
  id: string;
  actor_id: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  detail: unknown;
  ip: string | null;
  created_at: string;
}

export interface AuditActor {
  id: string;
  full_name: string | null;
  role: string;
}

export interface TechnicalField {
  label: string;
  value: string;
  /** True when the value was withheld rather than shown. */
  redacted?: boolean;
}

export interface FormattedAuditEvent {
  /** Human label for the action — "MFA enabled", not "staff.mfa_enrolled". */
  actionLabel: string;
  /** The raw constant, kept for technical inspection and for the filter. */
  actionRaw: string;
  tone: AuditTone;
  /** "What happened", in one line. */
  summary: string;
  /** Supporting line. Empty string when there is nothing worth adding. */
  secondary: string;
  actorLabel: string;
  actorSub: string;
  targetLabel: string;
  /** Truncated identifier, secondary to the target TYPE. */
  targetRef: string;
  ipLabel: string;
  ipSub: string;
  /** Allowlisted metadata, humanised, for the expanded view. */
  technical: TechnicalField[];
  /** True when at least one key was withheld by the redactor. */
  hasRedactions: boolean;
}

/* ── security: redaction ──────────────────────────────────────────────────
 *
 * Applied to every key before it is considered for display, including inside
 * the technical view and the raw-JSON view. It is deliberately broad and
 * matches on the KEY NAME: a value is never inspected to decide whether it
 * looks secret, because "looks secret" is not a property anyone can test.
 */
const SENSITIVE_KEY =
  /(^|_)(password|passwd|secret|token|totp|otp|qr|cookie|authorization|auth|bearer|credential|key|apikey|api_key|service_role|refresh|session|signature|jwt|hash|salt|nonce|pin|ssn|ein|tax_id)(_|$)/i;

/** Exempt: key names that trip the pattern but are plainly not secrets. */
const NOT_SENSITIVE = new Set([
  "key", // settings.update writes the SETTING key — e.g. "company_phone"
  "signature_request_id", // a SignWell request id, not a signature
]);

export function isSensitiveKey(key: string): boolean {
  if (NOT_SENSITIVE.has(key)) return false;
  return SENSITIVE_KEY.test(key);
}

/* ── humanising primitives ─────────────────────────────────────────────── */

/** `manual_review` → `Manual review`. Leaves already-prose values alone. */
export function humanizeValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (value === "") return "—";
    // Only reshape machine-looking values: lower_snake_case with no spaces.
    if (/^[a-z0-9]+(_[a-z0-9]+)*$/.test(value)) {
      const s = value.replace(/_/g, " ");
      return s.charAt(0).toUpperCase() + s.slice(1);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(humanizeValue).join(", ");
  return "—";
}

/** `note_length` → `Note length`. */
export function humanizeKey(key: string): string {
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Values that read better than the generic humaniser manages. */
const VALUE_LABEL: Readonly<Record<string, string>> = {
  fmcsa_qcmobile: "FMCSA QCMobile",
  provider_not_configured: "FMCSA provider not configured",
  provider_unavailable: "FMCSA provider unavailable",
  not_configured: "Not configured",
  eligible_to_continue: "Eligible to continue",
  not_eligible: "Not eligible",
  manual_review: "Manual review",
  staff_only: "Staff only",
  service_role_bootstrap: "Service-role bootstrap",
  signwell: "SignWell",
};

function label(value: unknown): string {
  if (typeof value === "string" && VALUE_LABEL[value]) return VALUE_LABEL[value]!;
  return humanizeValue(value);
}

/* ── action vocabulary ─────────────────────────────────────────────────────
 *
 * Every action `src/` writes, plus the two written by bootstrap scripts. Tone
 * is assigned by what the event MEANS, not by what looks lively: the vast
 * majority of an audit log is neutral, and marking everything amber — which
 * is what the page did — makes the amber worth nothing when it matters.
 */
interface ActionSpec {
  label: string;
  tone: AuditTone;
}

const ACTION: Readonly<Record<string, ActionSpec>> = {
  "account.signup": { label: "Account created", tone: "neutral" },
  "agreement.resend_requested": { label: "Agreement resend requested", tone: "neutral" },
  "agreement.send": { label: "Agreement sent", tone: "neutral" },
  "broker.agreement_create": { label: "Broker agreement created", tone: "neutral" },
  "broker.agreement_revoke": { label: "Broker agreement revoked", tone: "warning" },
  "broker.grant_shipment": { label: "Shipment access granted", tone: "neutral" },
  "broker.invite": { label: "Broker invited", tone: "neutral" },
  "broker.invite_accepted": { label: "Broker invite accepted", tone: "success" },
  "broker.invite_revoked": { label: "Broker invite revoked", tone: "warning" },
  "broker.partner_create": { label: "Broker partner created", tone: "neutral" },
  "broker.revoke_shipment": { label: "Shipment access revoked", tone: "warning" },
  "carrier.assign_dispatcher": { label: "Dispatcher assigned", tone: "neutral" },
  "carrier.change_request": { label: "Carrier change requested", tone: "neutral" },
  "document.download": { label: "Document downloaded", tone: "neutral" },
  "document.review": { label: "Document reviewed", tone: "neutral" },
  fmcsa_check_started: { label: "FMCSA check started", tone: "neutral" },
  fmcsa_check_completed: { label: "FMCSA check completed", tone: "neutral" },
  "invoice.generate": { label: "Invoice generated", tone: "neutral" },
  legacy_carrier_verification_bound: { label: "Legacy carrier verified", tone: "success" },
  legacy_carrier_verification_run: { label: "Legacy carrier check run", tone: "neutral" },
  manual_review_required: { label: "Manual review required", tone: "warning" },
  onboarding_gate_denied: { label: "Onboarding blocked", tone: "warning" },
  pre_registration_created: { label: "Carrier registration created", tone: "neutral" },
  pre_registration_staff_review: { label: "Staff review completed", tone: "success" },
  "quote.status_change": { label: "Quote status changed", tone: "neutral" },
  "settings.update": { label: "Setting changed", tone: "warning" },
  "shipment.call_logged": { label: "Call logged", tone: "neutral" },
  "shipment.carrier_assigned": { label: "Carrier assigned", tone: "neutral" },
  "shipment.carrier_released": { label: "Carrier released", tone: "neutral" },
  "shipment.created": { label: "Shipment created", tone: "neutral" },
  "shipment.dispatcher_assigned": { label: "Dispatcher assigned", tone: "neutral" },
  "shipment.driver_token_issued": { label: "Driver link issued", tone: "warning" },
  "shipment.driver_token_revoked": { label: "Driver link revoked", tone: "warning" },
  "shipment.email_logged": { label: "Email logged", tone: "neutral" },
  "shipment.eta_update": { label: "ETA updated", tone: "neutral" },
  "shipment.exception_opened": { label: "Exception opened", tone: "danger" },
  "shipment.exception_resolved": { label: "Exception resolved", tone: "success" },
  "shipment.exception_triaged": { label: "Exception triaged", tone: "warning" },
  "shipment.location_retention_purged": { label: "Location data purged", tone: "warning" },
  "shipment.location_visibility_changed": { label: "Location visibility changed", tone: "warning" },
  "shipment.notification_resent": { label: "Notification resent", tone: "neutral" },
  "shipment.pod_requested": { label: "Proof of delivery requested", tone: "neutral" },
  "shipment.provider_connection_attached": { label: "Tracking provider connected", tone: "neutral" },
  "shipment.provider_connection_revoked": { label: "Tracking provider disconnected", tone: "warning" },
  "shipment.status_change": { label: "Shipment status changed", tone: "neutral" },
  "shipment.status_correction": { label: "Shipment status corrected", tone: "warning" },
  "shipment_document.review": { label: "Shipment document reviewed", tone: "neutral" },
  "shipment_document.upload": { label: "Shipment document uploaded", tone: "neutral" },
  "staff.invite": { label: "Staff invited", tone: "warning" },
  "staff.invite_accepted": { label: "Staff invite accepted", tone: "success" },
  "staff.mfa_enrolled": { label: "MFA enabled", tone: "success" },
  "staff.role_assigned": { label: "Role assigned", tone: "warning" },
};

/**
 * Exported so the filter can resolve human terms back to raw constants.
 *
 * The fallback matters more than it looks: the ledger holds rows written by
 * bootstrap scripts and by earlier versions of the app, so an action this map
 * has never seen is a normal occurrence, not an error. It still has to read as
 * a sentence rather than as a constant.
 */
export function actionLabel(action: string): string {
  const known = ACTION[action];
  if (known) return known.label;
  const words = action.replace(/[._]+/g, " ").trim();
  return words === "" ? action : words.charAt(0).toUpperCase() + words.slice(1);
}

export function actionTone(action: string): AuditTone {
  return ACTION[action]?.tone ?? "neutral";
}

export function knownActions(): ReadonlyArray<{ action: string; label: string }> {
  return Object.entries(ACTION).map(([action, spec]) => ({
    action,
    label: spec.label,
  }));
}

/* ── target vocabulary ─────────────────────────────────────────────────── */

const TARGET: Readonly<Record<string, string>> = {
  documents: "Document",
  profiles: "User account",
  carriers: "Carrier",
  carrier_pre_registrations: "Carrier application",
  shipments: "Shipment",
  shipment_documents: "Shipment document",
  broker_partners: "Broker partner",
  broker_partner_invites: "Broker invite",
  staff_invites: "Staff invite",
  quotes: "Quote",
  invoices: "Invoice",
  company_settings: "Company settings",
  carrier_leads: "Lead",
  support_threads: "Support thread",
  agreements: "Agreement",
};

/* ── the summary allowlist ─────────────────────────────────────────────────
 *
 * Per action, which `detail` keys may inform the one-line summary and the
 * supporting line. A key that is not named here NEVER reaches the primary UI
 * — it can still appear under "Technical details", where it is humanised and
 * redacted, but it cannot leak into the at-a-glance view by being added to a
 * payload somewhere else in the codebase.
 */
type Detail = Record<string, unknown>;

const asDetail = (v: unknown): Detail =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Detail) : {};

const str = (d: Detail, k: string): string | null =>
  typeof d[k] === "string" ? (d[k] as string) : null;
const bool = (d: Detail, k: string): boolean | null =>
  typeof d[k] === "boolean" ? (d[k] as boolean) : null;
const num = (d: Detail, k: string): number | null =>
  typeof d[k] === "number" ? (d[k] as number) : null;

interface Summary {
  summary: string;
  secondary: string;
}

/**
 * Per-action summarisers. Each reads only the keys it names — that is the
 * allowlist in practice. Anything it cannot determine falls back to the
 * action label, never to a dump of the payload.
 */
const SUMMARISE: Readonly<Record<string, (d: Detail) => Summary>> = {
  "document.download": (d) => {
    const ttl = num(d, "ttl_seconds");
    return {
      summary: "Secure document link generated",
      secondary:
        ttl === null
          ? ""
          : `Link expires in ${ttl % 60 === 0 ? `${ttl / 60} minute${ttl / 60 === 1 ? "" : "s"}` : `${ttl} seconds`}`,
    };
  },

  pre_registration_staff_review: (d) => {
    const decision = str(d, "decision");
    const outcome = str(d, "outcome");
    const cleared = decision === "eligible_to_continue" || outcome === "clear";
    return {
      summary: cleared
        ? "Carrier cleared to continue"
        : decision === "not_eligible" || outcome === "refuse"
          ? "Carrier marked not eligible"
          : "Staff review recorded",
      secondary: "Manual staff review completed",
    };
  },

  "staff.mfa_enrolled": (d) => {
    const role = str(d, "role");
    return {
      summary: "Two-factor authentication enabled",
      secondary: role ? `${humanizeValue(role)} account` : "",
    };
  },

  "staff.role_assigned": (d) => {
    const to = str(d, "to");
    const from = str(d, "from");
    return {
      summary:
        to && from
          ? `Role changed from ${humanizeValue(from)} to ${humanizeValue(to)}`
          : to
            ? `Role set to ${humanizeValue(to)}`
            : "Role assigned",
      secondary: "Administrative role assignment",
    };
  },

  manual_review_required: (d) => {
    const tier = str(d, "risk_tier");
    return {
      summary: "Manual carrier review required",
      secondary: tier && tier !== "manual_review" ? `Risk tier: ${label(tier)}` : "",
    };
  },

  fmcsa_check_started: (d) => {
    const configured = bool(d, "configured");
    return {
      summary: "FMCSA verification started",
      secondary: configured === false ? "FMCSA integration not configured" : "",
    };
  },

  fmcsa_check_completed: (d) => {
    const verification = str(d, "verification_status");
    const decision = str(d, "decision");
    const lookup = str(d, "lookup_status");
    const failed =
      lookup === "provider_not_configured" || lookup === "provider_unavailable";
    return {
      summary: failed
        ? `FMCSA verification could not run — ${label(lookup)}`
        : "FMCSA verification completed",
      secondary: [
        verification ? label(verification) : "",
        decision ? label(decision) : "",
      ]
        .filter(Boolean)
        .join(" · "),
    };
  },

  pre_registration_created: (d) => {
    const hasMc = bool(d, "has_mc");
    return {
      summary: "Carrier pre-registration created",
      secondary:
        hasMc === null ? "" : hasMc ? "MC number provided" : "No MC number provided",
    };
  },

  "account.signup": (d) => {
    const kind = str(d, "kind");
    const industry = str(d, "industry");
    const frequency = str(d, "shipping_frequency");
    const authority = str(d, "authority_status");
    const bits = [
      industry ?? "",
      frequency ? `${humanizeValue(frequency)} shipping` : "",
      authority ? `Authority: ${humanizeValue(authority)}` : "",
    ].filter(Boolean);
    return {
      summary: kind ? `New ${kind} account created` : "New account created",
      secondary: bits.join(" · "),
    };
  },

  "settings.update": (d) => {
    const key = str(d, "key");
    return {
      summary: key ? `Company setting changed — ${humanizeKey(key)}` : "Company setting changed",
      secondary: "",
    };
  },

  onboarding_gate_denied: (d) => {
    const step = str(d, "step");
    const reason = str(d, "reason");
    return {
      summary: step ? `Onboarding blocked at ${humanizeValue(step).toLowerCase()}` : "Onboarding blocked",
      secondary: reason ? label(reason) : "",
    };
  },

  "staff.invite": (d) => {
    const role = str(d, "role");
    return {
      summary: role ? `Staff invited as ${humanizeValue(role)}` : "Staff invited",
      secondary: "Invite-only staff access",
    };
  },

  "shipment.location_visibility_changed": (d) => {
    const visibility = str(d, "visibility");
    return {
      summary: visibility
        ? `Location visibility set to ${label(visibility).toLowerCase()}`
        : "Location visibility changed",
      secondary: "",
    };
  },

  "quote.status_change": (d) => {
    const reason = str(d, "reason");
    const old = str(d, "old_status");
    return {
      summary: "Quote status changed",
      secondary: [old ? `From ${humanizeValue(old)}` : "", reason ? label(reason) : ""]
        .filter(Boolean)
        .join(" · "),
    };
  },
};

/* ── technical view ────────────────────────────────────────────────────── */

/** Every detail key, humanised, with sensitive keys withheld. */
function technicalFields(detail: unknown): {
  fields: TechnicalField[];
  redacted: boolean;
} {
  const d = asDetail(detail);
  const fields: TechnicalField[] = [];
  let redacted = false;
  for (const [key, value] of Object.entries(d)) {
    if (isSensitiveKey(key)) {
      redacted = true;
      fields.push({ label: humanizeKey(key), value: "[redacted]", redacted: true });
      continue;
    }
    if (key === "note_length" && typeof value === "number") {
      fields.push({ label: "Note length", value: `${value} characters` });
      continue;
    }
    fields.push({ label: humanizeKey(key), value: label(value) });
  }
  return { fields, redacted };
}

/**
 * The raw payload, with sensitive VALUES replaced. Offered behind a second
 * disclosure for operators who need the literal record; it is still not the
 * untouched object, because the untouched object is what the redactor exists
 * to stand between.
 */
export function redactedDetailJson(detail: unknown): string | null {
  const d = asDetail(detail);
  if (Object.keys(d).length === 0) return null;
  const safe: Detail = {};
  for (const [key, value] of Object.entries(d)) {
    safe[key] = isSensitiveKey(key) ? "[redacted]" : value;
  }
  return JSON.stringify(safe, null, 2);
}

/* ── actor / ip ────────────────────────────────────────────────────────── */

const LOCAL_IPS = new Set(["::1", "127.0.0.1", "0:0:0:0:0:0:0:1", "localhost"]);

/* ── the formatter ─────────────────────────────────────────────────────── */

export function formatAuditEvent(
  event: AuditEventRow,
  actor: AuditActor | null,
): FormattedAuditEvent {
  const detail = asDetail(event.detail);
  const summariser = SUMMARISE[event.action];
  const base = summariser
    ? summariser(detail)
    : { summary: actionLabel(event.action), secondary: "" };

  const { fields, redacted } = technicalFields(event.detail);

  const targetLabel = event.target_table
    ? (TARGET[event.target_table] ?? humanizeValue(event.target_table))
    : "—";

  const ip = event.ip;
  const isLocal = ip !== null && LOCAL_IPS.has(ip);

  return {
    actionLabel: actionLabel(event.action),
    actionRaw: event.action,
    tone: actionTone(event.action),
    summary: base.summary,
    secondary: base.secondary,
    actorLabel: actor
      ? (actor.full_name ?? `${actor.id.slice(0, 8)}…`)
      : event.actor_id
        ? `${event.actor_id.slice(0, 8)}…`
        : "System",
    actorSub: actor
      ? humanizeValue(actor.role)
      : event.actor_id
        ? "Unknown account"
        : "Automated service",
    targetLabel,
    targetRef: event.target_id ? `${event.target_id.slice(0, 8)}…` : "",
    ipLabel: ip === null ? "—" : isLocal ? "Local" : ip,
    ipSub: isLocal && ip !== null ? ip : "",
    technical: fields,
    hasRedactions: redacted,
  };
}

/**
 * Resolve what an operator typed in the Action filter to raw constants.
 *
 * An exact constant wins outright. Otherwise the text is matched against the
 * human labels, so "mfa" finds `staff.mfa_enrolled` — which is the whole point
 * of showing human labels: you should be able to search for what you read.
 * Returns an empty array when nothing matches, so the caller can distinguish
 * "no such action" from "no filter".
 */
export function resolveActionFilter(input: string): string[] {
  const q = input.trim().toLowerCase();
  if (q === "") return [];
  if (ACTION[q]) return [q];
  const hits = Object.entries(ACTION)
    .filter(
      ([action, spec]) =>
        action.includes(q) || spec.label.toLowerCase().includes(q),
    )
    .map(([action]) => action);
  // An unknown constant is still a legitimate filter — the ledger holds rows
  // written by bootstrap scripts this table does not enumerate.
  if (hits.length === 0 && /^[a-z0-9_.]+$/.test(q)) return [q];
  return hits;
}
