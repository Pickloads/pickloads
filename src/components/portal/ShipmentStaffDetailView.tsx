import { Link } from "@/i18n/navigation";
import {
  AppointmentForm,
  AssignCarrierForm,
  AssignDispatcherForm,
  CorrectionForm,
  EtaUpdateForm,
  LogExceptionForm,
  ResolveExceptionForm,
  TriageExceptionForm,
  NoteForm,
  RecordCallForm,
  RecordEmailForm,
  RequestPodForm,
  ResendNotificationForm,
  StatusUpdateForm,
  IssueDriverLinkForm,
  RevokeDriverLinkForm,
  LocationVisibilityForm,
  ProviderLinkForm,
  RevokeProviderLinkForm,
  type AssignOption,
} from "@/components/portal/ShipmentOpsForms";
import { LocationPanel } from "@/components/tracking/LocationPanel";
import type { ProviderStatus } from "@/lib/shipments/providers";
import { statusLabel } from "@/components/portal/ShipmentBoardView";
import {
  StaffShipmentDocuments,
  type StaffDocumentView,
} from "@/components/portal/ShipmentDocumentReview";
import {
  BrokerShipmentShare,
  type BrokerGrantView,
  type BrokerPartnerOption,
} from "@/components/portal/BrokerShipmentShare";
import {
  getStaffDocumentUrlAction,
  reviewDocumentAction,
  staffUploadDocumentAction,
} from "@/app/actions/shipment-documents";
import type {
  StaffAssignmentRow,
  StaffShipmentRow,
  StaffTimelineEvent,
} from "@/lib/shipments/staff-detail";
import { SHIPMENT_STATUSES, type ShipmentStatus } from "@/lib/shipments/types";
import type {
  DriverTokenView,
  ShipmentExceptionRow,
  ShipmentLocationRow,
  ShipmentPartyRow,
  TrackingProviderConnectionRow,
} from "@/lib/shipments/types";
import { driverTokenState } from "@/lib/shipments/driver-token-state";

/**
 * M-75 — the dispatcher shipment page: what is true about this shipment, what
 * has happened to it, and the fourteen §14 actions.
 *
 * ── §14's "VIEW UPDATE HISTORY" IS THE CENTRE OF THIS PAGE ────────────────
 *
 * Not an afterthought below the forms — the second block, above every action
 * except the status change. A dispatcher taking over a shipment reads the
 * history first, and §15's *"audit who changed each status"* is answered here,
 * per event, with the source, the band and the time it HAPPENED beside the
 * time it was RECORDED (§7 keeps both, and the gap between them is the answer
 * to "how late were we told?").
 *
 * Staff see all five visibility bands. Each event carries its band as a
 * labelled badge, so a dispatcher can see at a glance which of their notes the
 * customer is reading — the single most useful thing a staff timeline can
 * show, and impossible to infer from the prose.
 *
 * ── §22/§23 ───────────────────────────────────────────────────────────────
 *
 * `.ptable--cards` with `data-th` on every body cell so the tables become
 * readable cards at 320px; `<ol>` + `<time datetime>` for the history so it is
 * a semantic sequence rather than styled divs; `scope="col"` on every header;
 * no colour-only state anywhere — every badge carries its word.
 */

function when(iso: string | null): string {
  if (iso === null) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function money(value: number | null): string {
  return value === null
    ? "—"
    : value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const BAND_LABEL: Record<string, string> = {
  public: "Public",
  shipper: "Shipper",
  carrier: "Carrier",
  broker: "Broker",
  staff_only: "Staff only",
};

/* ------------------------------------------------------------------ *
 * Header + summary
 * ------------------------------------------------------------------ */

function Summary({ shipment }: { shipment: StaffShipmentRow }) {
  return (
    <section aria-labelledby="sd-summary-h">
      <span className="psec" id="sd-summary-h">
        Shipment summary
      </span>
      <div className="ptable-wrap">
        <table className="ptable ptable--cards">
          <thead>
            <tr>
              <th scope="col">Lane</th>
              <th scope="col">Equipment</th>
              <th scope="col">Pickup appt</th>
              <th scope="col">Delivery appt</th>
              <th scope="col">Pickup ETA</th>
              <th scope="col">Delivery ETA</th>
              <th scope="col">Gross</th>
              <th scope="col">Carrier pay</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td data-th="Lane">
                {shipment.origin_city}, {shipment.origin_state} →{" "}
                {shipment.destination_city}, {shipment.destination_state}
              </td>
              <td data-th="Equipment">{shipment.equipment}</td>
              <td data-th="Pickup appt">{when(shipment.pickup_appointment_at)}</td>
              <td data-th="Delivery appt">
                {when(shipment.delivery_appointment_at)}
              </td>
              <td data-th="Pickup ETA">{when(shipment.estimated_pickup_at)}</td>
              <td data-th="Delivery ETA">{when(shipment.estimated_delivery_at)}</td>
              <td data-th="Gross">{money(shipment.gross_shipper_amount)}</td>
              <td data-th="Carrier pay">{money(shipment.carrier_pay)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="pempty" style={{ padding: "8px 0 0" }}>
        {/* §30 honest label — the ETA is whatever a person typed. */}
        {shipment.eta_source === null
          ? "No ETA has been entered yet."
          : `ETA entered by dispatch (${shipment.eta_source.replace(/_/g, " ")}${
              shipment.eta_confidence
                ? `, ${shipment.eta_confidence} confidence`
                : ""
            }), last updated ${when(shipment.eta_updated_at)}. PickLoads does not predict ETAs.`}
        {(shipment.delay_minutes ?? 0) > 0
          ? ` Running ${shipment.delay_minutes} minutes late.`
          : ""}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * §14 — view update history
 * ------------------------------------------------------------------ */

function UpdateHistory({
  events,
  nextCursor,
  failed,
  shipmentId,
}: {
  events: StaffTimelineEvent[];
  nextCursor: string | null;
  failed: boolean;
  shipmentId: string;
}) {
  return (
    <section aria-labelledby="sd-history-h">
      <span className="psec" id="sd-history-h">
        Update history
      </span>
      {failed ? (
        <p className="pempty" role="alert">
          Couldn&apos;t load the history. Retry, and check the Supabase
          connection.
        </p>
      ) : events.length === 0 ? (
        <p className="pempty">
          Nothing has happened to this shipment yet beyond its creation.
        </p>
      ) : (
        <div className="ptable-wrap">
          <table className="ptable ptable--cards">
            <thead>
              <tr>
                <th scope="col">Happened</th>
                <th scope="col">Recorded</th>
                <th scope="col">Event</th>
                <th scope="col">Status</th>
                <th scope="col">Source</th>
                <th scope="col">Seen by</th>
                <th scope="col">Message</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td data-th="Happened">
                    <time dateTime={e.event_time}>{when(e.event_time)}</time>
                  </td>
                  <td data-th="Recorded">
                    <time dateTime={e.recorded_at}>{when(e.recorded_at)}</time>
                  </td>
                  <td data-th="Event">{e.event_type.replace(/_/g, " ")}</td>
                  <td data-th="Status">
                    {e.status === null ? "—" : statusLabel(e.status)}
                  </td>
                  <td data-th="Source">{e.source}</td>
                  <td data-th="Seen by">
                    <span
                      className={`pbadge${e.visibility === "public" ? " green" : ""}`}
                    >
                      {BAND_LABEL[e.visibility] ?? e.visibility}
                    </span>
                  </td>
                  <td data-th="Message">
                    {e.public_message ? (
                      <span>
                        <b>Customer:</b> {e.public_message}
                        <br />
                      </span>
                    ) : null}
                    {e.internal_message ? (
                      <span>
                        <b>Internal:</b> {e.internal_message}
                      </span>
                    ) : null}
                    {!e.public_message && !e.internal_message ? "—" : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nextCursor !== null ? (
        <p className="psh-more">
          <Link
            className="btn btn-ghost btn-sm"
            href={`/portal/admin/shipments/${shipmentId}?before=${encodeURIComponent(nextCursor)}`}
          >
            Show older entries
          </Link>
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Assignment + party history
 * ------------------------------------------------------------------ */

function AssignmentHistory({
  assignments,
  carrierName,
}: {
  assignments: StaffAssignmentRow[];
  carrierName: (id: string) => string;
}) {
  return (
    <section aria-labelledby="sd-assign-h">
      <span className="psec" id="sd-assign-h">
        Assignment history
      </span>
      {assignments.length === 0 ? (
        <p className="pempty">No carrier has been assigned yet.</p>
      ) : (
        <div className="ptable-wrap">
          <table className="ptable ptable--cards">
            <thead>
              <tr>
                <th scope="col">Carrier</th>
                <th scope="col">Assigned</th>
                <th scope="col">Released</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map((a) => (
                <tr key={a.id}>
                  <td data-th="Carrier">{carrierName(a.carrier_id)}</td>
                  <td data-th="Assigned">{when(a.assigned_at)}</td>
                  <td data-th="Released">
                    {a.released_at === null ? (
                      <span className="pbadge green">Open</span>
                    ) : (
                      when(a.released_at)
                    )}
                  </td>
                  <td data-th="Reason">{a.release_reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Parties({ parties }: { parties: ShipmentPartyRow[] }) {
  if (parties.length === 0) return null;
  return (
    <section aria-labelledby="sd-parties-h">
      <span className="psec" id="sd-parties-h">
        Contacts
      </span>
      <div className="ptable-wrap">
        <table className="ptable ptable--cards">
          <thead>
            <tr>
              <th scope="col">Role</th>
              <th scope="col">Company</th>
              <th scope="col">Contact</th>
              <th scope="col">Phone</th>
              <th scope="col">Email</th>
              <th scope="col">On public page</th>
            </tr>
          </thead>
          <tbody>
            {parties.map((p) => (
              <tr key={p.id}>
                <td data-th="Role">{p.party_role.replace(/_/g, " ")}</td>
                <td data-th="Company">{p.company_name ?? "—"}</td>
                <td data-th="Contact">{p.contact_name ?? "—"}</td>
                <td data-th="Phone">{p.phone ?? "—"}</td>
                <td data-th="Email">{p.email ?? "—"}</td>
                <td data-th="On public page">
                  <span className={`pbadge${p.public_contact ? " green" : ""}`}>
                    {p.public_contact ? "Shown" : "Hidden"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The page body
 * ------------------------------------------------------------------ */

export interface ShipmentStaffDetailProps {
  shipment: StaffShipmentRow;
  events: StaffTimelineEvent[];
  nextCursor: string | null;
  historyFailed: boolean;
  assignments: StaffAssignmentRow[];
  parties: ShipmentPartyRow[];
  carriers: AssignOption[];
  staff: AssignOption[];
  drivers: AssignOption[];
  trucks: AssignOption[];
  availableTransitions: readonly ShipmentStatus[];
  isAdmin: boolean;
  carrierNames: Record<string, string>;
  /** M-76 — §13's driver links on this shipment, credential column excluded. */
  driverTokens: readonly DriverTokenView[];
  driverTokensFailed: boolean;
  /** True when `DRIVER_TOKEN_SECRET` is set — §30: no button we cannot honour. */
  driverLinksEnabled: boolean;
  /** M-77 — §16's documents on this shipment, with the review trail (§15). */
  documents: StaffDocumentView[];
  documentsFailed: boolean;
  documentsHasMore: boolean;
  /** M-78 — §21's exceptions, full field set, under 0025's staff policy. */
  exceptions: readonly ShipmentExceptionRow[];
  exceptionsFailed: boolean;
  /** M-80 — §9's location history, unredacted (staff read the table). */
  locations: readonly ShipmentLocationRow[];
  locationsFailed: boolean;
  /** M-80 — §9 Mode B links on this shipment. Staff-only, `tracking_url` and all. */
  connections: readonly TrackingProviderConnectionRow[];
  connectionsFailed: boolean;
  /** M-80 — the adapter contract table. Every entry is `connected: false`. */
  providers: readonly ProviderStatus[];
  /** M-81 — §12's per-shipment grants on this shipment, with partner names. */
  brokerGrants: readonly BrokerGrantView[];
  /** M-81 — VERIFIED partner organizations only; sharing with any other grants nothing. */
  brokerPartners: readonly BrokerPartnerOption[];
  brokerGrantsFailed: boolean;
}

/**
 * M-80 — §9's provider connections, and the ADAPTER CONTRACT TABLE.
 *
 * The table is not decoration. §9 asks for an adapter interface for Motive,
 * Samsara, Geotab and Verizon Connect and forbids a fake connection, so the
 * one place a dispatcher could reasonably expect a live map is also the place
 * that has to say plainly that there is none — with the environment variables
 * a future integration needs, read out of the adapters themselves rather than
 * transcribed.
 */
function ProviderConnections({
  shipmentId,
  connections,
  failed,
  providers,
}: {
  shipmentId: string;
  connections: readonly TrackingProviderConnectionRow[];
  failed: boolean;
  providers: readonly ProviderStatus[];
}) {
  const active = connections.filter((c) => c.active);
  return (
    <section aria-labelledby="sd-providers-h">
      <h2 id="sd-providers-h" className="psec">
        Tracking providers
      </h2>
      <p className="pempty" style={{ padding: "0 0 12px" }}>
        <strong>No provider is connected.</strong> PickLoads holds no telematics
        contract and no API credentials, so nothing is fetched and no position
        is ever fabricated (DIRECTIVE-tracking §9, §30). What is shipped is the
        adapter interface below: adding a real provider is one file, not a
        rewrite.
      </p>

      <div className="ptable-wrap">
        <table className="ptable">
          <caption className="sr-only">
            Tracking provider adapters and their configuration state
          </caption>
          <thead>
            <tr>
              <th scope="col">Provider</th>
              <th scope="col">Environment variables</th>
              <th scope="col">Credentials</th>
              <th scope="col">Connection</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.provider}>
                <td data-th="Provider">{p.displayName}</td>
                <td data-th="Environment variables" className="mono">
                  {p.requiredEnvVars.length === 0
                    ? "—"
                    : p.requiredEnvVars.join(", ")}
                </td>
                <td data-th="Credentials">
                  {p.configured ? "Present" : "Not configured"}
                </td>
                <td data-th="Connection">Not connected</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {failed ? (
        <p className="pempty" role="status">
          We couldn&apos;t read this shipment&apos;s provider links just now.
        </p>
      ) : active.length === 0 ? (
        <p className="pempty">
          No tracking link is attached to this shipment. It is milestone-tracked.
        </p>
      ) : (
        <div className="ptable-wrap">
          <table className="ptable">
            <caption className="sr-only">
              Tracking links attached to this shipment
            </caption>
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Link</th>
                <th scope="col">Expires</th>
                <th scope="col">Consent</th>
                <th scope="col">
                  <span className="sr-only">Revoke</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {active.map((c) => (
                <tr key={c.id}>
                  <td data-th="Provider">{c.provider}</td>
                  <td data-th="Link" className="mono">
                    {c.tracking_url === null ? (
                      (c.external_tracking_id ?? "—")
                    ) : (
                      /* Staff-only, and `noreferrer` so the provider is not
                         handed the dispatcher's page URL. */
                      <a
                        href={c.tracking_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open driver link
                      </a>
                    )}
                  </td>
                  <td data-th="Expires">
                    {c.expires_at === null ? (
                      "—"
                    ) : (
                      <time dateTime={c.expires_at}>
                        {c.expires_at.slice(0, 16).replace("T", " ")}
                      </time>
                    )}
                  </td>
                  <td data-th="Consent">{c.consent_status}</td>
                  <td data-th="Revoke">
                    <RevokeProviderLinkForm
                      shipmentId={shipmentId}
                      connectionId={c.id}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ShipmentStaffDetailView(props: ShipmentStaffDetailProps) {
  const { shipment } = props;
  const openAssignment = props.assignments.some((a) => a.released_at === null);
  const carrierName = (id: string) => props.carrierNames[id] ?? "Carrier";

  return (
    <>
      <div className="pbar">
        <div>
          <span className="crumb">Dispatch desk / Shipments</span>
          <h1>{shipment.tracking_number}</h1>
        </div>
        <span
          className={`pbadge ${
            shipment.status === "delayed" || shipment.status === "cancelled"
              ? "red"
              : shipment.status === "completed"
                ? "green"
                : "amber"
          }`}
        >
          {statusLabel(shipment.status)}
        </span>
      </div>

      <p className="pempty" style={{ padding: "0 0 14px" }}>
        {/* §5 — the number is fixed at creation. Said plainly, on the surface
            where somebody would otherwise go looking for an edit button. */}
        The tracking number is fixed at creation and cannot be changed.
        {shipment.public_tracking_enabled
          ? " Public tracking is ON for this shipment."
          : " Public tracking is OFF — the customer can still follow it in their portal."}
      </p>

      <Summary shipment={shipment} />

      <UpdateHistory
        events={props.events}
        nextCursor={props.nextCursor}
        failed={props.historyFailed}
        shipmentId={shipment.id}
      />

      <AssignmentHistory
        assignments={props.assignments}
        carrierName={carrierName}
      />
      <Parties parties={props.parties} />

      {/* M-80 — §9's location panel at the STAFF audience: coordinates and
          speed are never redacted for dispatch, because the visibility level
          is a CUSTOMER-facing control and dispatch cannot operate a shipment
          it is not allowed to see. */}
      <LocationPanel
        headingId="sd-location-h"
        level="exact"
        trackingMode={shipment.tracking_mode}
        currentCity={shipment.current_city}
        currentState={shipment.current_state}
        currentLatitude={shipment.current_latitude}
        currentLongitude={shipment.current_longitude}
        lastLocationAt={shipment.last_location_at}
        readings={props.locations}
        failed={props.locationsFailed}
      />

      <ProviderConnections
        shipmentId={shipment.id}
        connections={props.connections}
        failed={props.connectionsFailed}
        providers={props.providers}
      />

      <span className="psec">Operations</span>
      <StatusUpdateForm
        shipmentId={shipment.id}
        status={shipment.status}
        available={props.availableTransitions}
        needsCloseout={shipment.status === "delivered" || shipment.status === "pod_uploaded"}
      />
      <AssignCarrierForm
        shipmentId={shipment.id}
        carriers={props.carriers}
        staff={props.staff}
        drivers={props.drivers}
        trucks={props.trucks}
        hasOpenAssignment={openAssignment}
      />
      <AppointmentForm
        shipmentId={shipment.id}
        pickupAt={when(shipment.pickup_appointment_at)}
        deliveryAt={when(shipment.delivery_appointment_at)}
      />
      <EtaUpdateForm
        shipmentId={shipment.id}
        pickupEta={when(shipment.estimated_pickup_at)}
        deliveryEta={when(shipment.estimated_delivery_at)}
        distanceMiles={shipment.distance_miles}
      />
      <NoteForm shipmentId={shipment.id} />
      <RecordCallForm shipmentId={shipment.id} />
      <RecordEmailForm shipmentId={shipment.id} />
      <LogExceptionForm shipmentId={shipment.id} />
      <RequestPodForm shipmentId={shipment.id} />
      <ResendNotificationForm shipmentId={shipment.id} />
      <AssignDispatcherForm
        shipmentId={shipment.id}
        staff={props.staff}
        current={shipment.dispatcher_id}
      />
      <LocationVisibilityForm
        shipmentId={shipment.id}
        current={shipment.location_visibility}
        isAdmin={props.isAdmin}
      />
      <ProviderLinkForm shipmentId={shipment.id} providers={props.providers} />
      {props.isAdmin ? (
        <CorrectionForm
          shipmentId={shipment.id}
          status={shipment.status}
          statuses={SHIPMENT_STATUSES}
        />
      ) : null}

      {/* M-76 — §13's driver link, from the dispatcher side. Both origins the
          directive permits are wired: this surface and the carrier portal. */}
      <DriverLinkBlock
        shipmentId={shipment.id}
        tokens={props.driverTokens}
        tokensFailed={props.driverTokensFailed}
        enabled={props.driverLinksEnabled}
        hasCarrier={shipment.carrier_id !== null}
        drivers={props.drivers}
      />

      {/* M-77 — §14/§15's document surface. Staff file ANY of the eleven §16
          types and are the only role that may; and the approval below is the
          step §20's `pod_uploaded` waits on. */}
      <span className="psec">Documents</span>
      <StaffShipmentDocuments
        shipmentId={shipment.id}
        documents={props.documents}
        failed={props.documentsFailed}
        hasMore={props.documentsHasMore}
        uploadAction={staffUploadDocumentAction}
        reviewAction={reviewDocumentAction}
        downloadAction={getStaffDocumentUrlAction}
      />

      {/* M-81 — §12's "shipment by shipment" grant, where the shipment is.
          Placed directly after Documents on purpose: the question a dispatcher
          asks when they share a load is "can the partner see the BOL?", and
          the two answers should be next to each other. */}
      <span className="psec">Broker partner access</span>
      <BrokerShipmentShare
        shipmentId={shipment.id}
        partners={props.brokerPartners}
        grants={props.brokerGrants}
        failed={props.brokerGrantsFailed}
      />

      {/* M-78 — §21's register, with the open/resolve lifecycle §14 asked for
          and M-75 deferred by name. */}
      <ExceptionRegister
        shipmentId={shipment.id}
        exceptions={props.exceptions}
        failed={props.exceptionsFailed}
        staff={props.staff}
      />

      <span className="psec">Not here yet</span>
      <p className="pempty" style={{ padding: "0 0 20px" }}>
        {/* §30 applies to staff surfaces too: name what is missing rather than
            leaving a dispatcher to discover it mid-shift. */}
        Localized customer <strong>emails</strong> are not built yet — the ETA
        change and the exception both write the shipper&apos;s in-portal
        notification today and nothing else, so call them if it is urgent.
        Provider-supplied ETAs are not built either: the source list offers
        manual, dispatcher-adjusted and calculated, and calculated is arithmetic
        over the recorded mileage, never a prediction.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * M-78 — §21's exception register
 * ------------------------------------------------------------------ */

const SEVERITY_LABEL: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

function typeLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/**
 * The one surface where §21's ten fields are all visible at once — which is
 * the whole reason the table exists rather than the exceptions being inferred
 * from the timeline.
 *
 * `internal_description` and `resolution` ARE rendered here, and only here.
 * That is not a relaxation of §21: the rule is about what a CUSTOMER sees, and
 * this page is behind `requireStaff` on a row set 0025's staff policy chose.
 * Every customer path reaches these rows through `my_shipment_exceptions()`,
 * which cannot return either column.
 *
 * State is TEXT (§23), never a colour: "Open" / "Resolved", and the severity
 * carries its word.
 */
function ExceptionRegister({
  shipmentId,
  exceptions,
  failed,
  staff,
}: {
  shipmentId: string;
  exceptions: readonly ShipmentExceptionRow[];
  failed: boolean;
  staff: AssignOption[];
}) {
  const open = exceptions.filter((e) => e.resolved_at === null);
  return (
    <section aria-labelledby="exceptions-heading">
      <span className="psec" id="exceptions-heading">
        Exceptions ({open.length} open)
      </span>
      {failed ? (
        <p className="pempty" style={{ padding: "0 0 14px" }}>
          The exception list could not be loaded. Everything else on this page
          is current; reload before assuming there are none.
        </p>
      ) : exceptions.length === 0 ? (
        <p className="pempty" style={{ padding: "0 0 14px" }}>
          No exceptions have been logged on this shipment.
        </p>
      ) : (
        <div className="ptable-wrap">
          <table className="ptable ptable--cards">
            <caption className="sr-only">
              Exceptions logged on this shipment, newest first
            </caption>
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Severity</th>
                <th scope="col">State</th>
                <th scope="col">Opened</th>
                <th scope="col">Customer told</th>
                <th scope="col">Assigned</th>
                <th scope="col">What the customer sees</th>
                <th scope="col">Internal</th>
              </tr>
            </thead>
            <tbody>
              {exceptions.map((e) => (
                <tr key={e.id}>
                  <td data-th="Type">{typeLabel(e.exception_type)}</td>
                  <td data-th="Severity">
                    {SEVERITY_LABEL[e.severity] ?? e.severity}
                  </td>
                  <td data-th="State">
                    {e.resolved_at === null
                      ? "Open"
                      : `Resolved ${when(e.resolved_at)}`}
                  </td>
                  <td data-th="Opened">{when(e.opened_at)}</td>
                  <td data-th="Customer told">
                    {e.customer_notified_at === null
                      ? "Not notified"
                      : when(e.customer_notified_at)}
                  </td>
                  <td data-th="Assigned">
                    {staff.find((s) => s.id === e.assigned_to)?.label ??
                      (e.assigned_to === null ? "—" : "Staff")}
                  </td>
                  <td data-th="What the customer sees">
                    {e.public_description ?? "Nothing published"}
                  </td>
                  <td data-th="Internal">
                    {e.internal_description ?? "—"}
                    {e.resolution === null ? null : (
                      <>
                        <br />
                        <strong>Resolution:</strong> {e.resolution}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open.length === 0 ? null : (
        <>
          <TriageExceptionForm
            shipmentId={shipmentId}
            exceptions={open}
            staff={staff}
          />
          <ResolveExceptionForm shipmentId={shipmentId} exceptions={open} />
        </>
      )}
    </section>
  );
}

/**
 * M-76 — §13's driver links on this shipment.
 *
 * WHAT IS NOT IN THIS TABLE is the point: no token, no prefix, no "last four".
 * `DriverTokenView` is `ShipmentDriverTokenRow` minus `token_hash`, so
 * rendering the credential is a compile error — and 0023 revokes SELECT on
 * that column from `authenticated` at the COLUMN level, so it is a permission
 * error too. Three independent guarantees for one column, because it is the
 * only bearer credential in the schema.
 *
 * State is TEXT (§23), never a colour: "Active" / "Expired" / "Revoked".
 */
function DriverLinkBlock({
  shipmentId,
  tokens,
  tokensFailed,
  enabled,
  hasCarrier,
  drivers,
}: {
  shipmentId: string;
  tokens: readonly DriverTokenView[];
  tokensFailed: boolean;
  enabled: boolean;
  hasCarrier: boolean;
  drivers: AssignOption[];
}) {
  const disabledReason = !hasCarrier
    ? "Assign a carrier before issuing a driver link — the link is scoped to the carrier hauling this freight."
    : !enabled
      ? "DRIVER_TOKEN_SECRET is unset in this environment, so no driver link can be minted or verified. Take the update by phone."
      : null;

  return (
    <>
      <span className="psec">Driver links</span>
      {tokensFailed ? (
        <p className="pempty" role="alert" style={{ padding: "0 0 12px" }}>
          Couldn&rsquo;t read this shipment&rsquo;s driver links. Reload the page.
        </p>
      ) : tokens.length === 0 ? (
        <p className="pempty" style={{ padding: "0 0 12px" }}>
          No driver link has been issued for this shipment.
        </p>
      ) : (
        <div className="pcard" style={{ padding: 0 }}>
          <table className="ptable ptable--cards">
            <thead>
              <tr>
                <th scope="col">Driver</th>
                <th scope="col">State</th>
                <th scope="col">Issued</th>
                <th scope="col">Expires</th>
                <th scope="col">Uses</th>
                <th scope="col">Location consent</th>
                <th scope="col">
                  <span className="sr-only">Revoke</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => {
                const state = driverTokenState(token);
                return (
                  <tr key={token.id}>
                    <td data-th="Driver">{token.driver_name ?? "—"}</td>
                    <td data-th="State">
                      {state === "active"
                        ? "Active"
                        : state === "expired"
                          ? "Expired"
                          : "Revoked"}
                    </td>
                    <td data-th="Issued">
                      <time dateTime={token.issued_at}>
                        {token.issued_at.slice(0, 16).replace("T", " ")}
                      </time>{" "}
                      ({token.issued_by_role})
                    </td>
                    <td data-th="Expires">
                      <time dateTime={token.expires_at}>
                        {token.expires_at.slice(0, 16).replace("T", " ")}
                      </time>
                    </td>
                    <td data-th="Uses">{token.use_count}</td>
                    <td data-th="Location consent">{token.consent_status}</td>
                    <td data-th="Revoke">
                      {state === "active" ? (
                        <RevokeDriverLinkForm
                          shipmentId={shipmentId}
                          tokenId={token.id}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <IssueDriverLinkForm
        shipmentId={shipmentId}
        drivers={drivers}
        disabledReason={disabledReason}
      />
    </>
  );
}
