# **PICKLOADS — ENTERPRISE SHIPMENT TRACKING SYSTEM**

## **Shipper/Broker Tracking Portal, Shipment Timeline, ETA, Documents, Notifications and Operational Visibility**

You are the Lead Product Engineer, Senior Next.js Architect, Senior Supabase Engineer, Senior Logistics Systems Architect, Senior Security Engineer, Senior UX Engineer and QA Lead responsible for adding a production-grade shipment tracking system to the existing PickLoads platform.

You are working inside the existing PickLoads repository.

This is an extension of the current production application.

DO NOT create a separate project.  
DO NOT rebuild the application from scratch.  
DO NOT replace the approved architecture.  
DO NOT redesign the approved PickLoads visual identity.  
DO NOT remove or break existing public pages, account creation, authentication, Carrier Portal, Shipper Portal, Admin Dashboard, Dispatcher Dashboard, CRM, onboarding, Stripe, Dropbox Sign, Resend, Turnstile, Upstash, analytics, SEO, localization, migrations or RLS policies.

Before changing code, read:

* the existing repository;  
* CLAUDE.md;  
* LAUNCHRUNBOOK.md;  
* all architecture documents;  
* all existing migrations;  
* all module documentation;  
* existing Carrier Portal;  
* existing Shipper Portal;  
* existing load and quote functionality;  
* existing role and RLS implementation.

The final system must look and operate like a serious national logistics platform capable of supporting PickLoads Logistics Group LLC at enterprise scale.

This is not a visual demo.

Every implemented feature must use real database records, secure permissions and honest operational states.

---

# **1\. BUSINESS OBJECTIVE**

Create a professional shipment tracking experience for PickLoads customers.

A shipper, authorized broker partner or approved customer must be able to follow the progress of a shipment through PickLoads.com without repeatedly calling the dispatch team.

The experience should provide the clarity and simplicity users expect from modern parcel-tracking systems, while remaining appropriate for full truckload, partial truckload and commercial freight operations.

The customer should be able to see:

* shipment reference number;  
* current shipment status;  
* origin and destination;  
* pickup and delivery dates;  
* estimated arrival time;  
* shipment milestones;  
* assigned carrier status;  
* document availability;  
* last tracking update;  
* exceptions or delays;  
* delivery confirmation;  
* Proof of Delivery when available.

Do not copy another company’s branding or interface.

Create an original PickLoads experience using the approved PickLoads design system.

---

# **2\. IMPORTANT LEGAL AND OPERATIONAL BOUNDARY**

PickLoads currently operates dispatch services.

Freight brokerage features must remain gated until PickLoads’ broker authority, bond and operational readiness are active.

Until `company_settings.brokerage_active = true`:

* do not represent PickLoads as actively brokering freight;  
* shipper users may create accounts, request quotes and join the pipeline;  
* tracking may be used only for legally authorized loads managed through the correct operating structure;  
* pre-launch shipper pages must display an honest waitlist or pending state;  
* no fake operational shipments should be displayed;  
* no shipper-facing action may imply active brokerage authority when it is not active.

All public messaging must follow the existing compliance switchboard and company settings.

---

# **3\. USER ROLES**

The tracking system must support:

## **Shipper**

Can view only shipments belonging to their shipper organization.

## **Broker Partner**

Optional role or organization type.

Can view only shipments explicitly assigned or shared with their organization.

Do not allow public self-registration as a broker partner without admin approval.

## **Carrier**

Can view shipments assigned to their carrier organization and update only the operational fields they are authorized to update.

## **Dispatcher**

Can manage shipments assigned to their carriers or operational team.

## **Admin**

Can view and manage all authorized shipments, events, documents, assignments and settings.

Use least-privilege authorization.

No role may access another company’s shipment through URL manipulation, API calls or direct database requests.

---

# **4\. PRIMARY CUSTOMER EXPERIENCE**

Create a professional tracking experience with two entry points.

## **Authenticated tracking**

Inside the Shipper Portal:

`/portal/shipper/shipments`

The shipper can see all shipments belonging to their organization.

## **Public secure tracking**

Create:

`/track`

A customer enters:

* tracking number;  
* secure access code, recipient ZIP or another secondary verification value.

Do not allow tracking by shipment number alone if the page reveals sensitive commercial information.

The public view must expose only approved information.

Never show:

* broker margins;  
* carrier rate confirmations;  
* private carrier contact information;  
* internal notes;  
* dispatch fee;  
* insurance documents;  
* shipper billing details;  
* private operational comments.

The authenticated portal may display more information based on role and permissions.

---

# **5\. TRACKING NUMBER FORMAT**

Create a consistent PickLoads tracking-number system.

Recommended format:

`PL-YYYY-######`

Example:

`PL-2026-000458`

Requirements:

* generated server-side;  
* unique database constraint;  
* non-sequential public guessing should be mitigated with secure secondary verification;  
* searchable by admin and dispatcher;  
* visible in emails and customer portals;  
* immutable after creation.

Keep a separate internal UUID primary key.

Do not use the tracking number as the database primary key.

---

# **6\. SHIPMENT STATUS MODEL**

Use a controlled shipment-status enum.

Recommended shipment lifecycle:

1. `quote_requested`  
2. `quote_sent`  
3. `quote_accepted`  
4. `carrier_search`  
5. `carrier_assigned`  
6. `dispatched`  
7. `en_route_to_pickup`  
8. `arrived_at_pickup`  
9. `loading`  
10. `picked_up`  
11. `in_transit`  
12. `delayed`  
13. `arrived_at_delivery`  
14. `unloading`  
15. `delivered`  
16. `pod_uploaded`  
17. `completed`  
18. `cancelled`

Not every shipment must use every status.

The system must support:

* normal progress;  
* delayed shipment;  
* appointment rescheduled;  
* carrier reassignment;  
* cancelled shipment;  
* rejected pickup;  
* delivery exception;  
* damaged freight or claims-related flag;  
* missing POD;  
* manual administrative correction.

Statuses must not be free text.

Create a separate event history instead of overwriting the shipment record without history.

---

# **7\. SHIPMENT TIMELINE**

Each shipment must have a chronological event timeline.

Create a table such as:

`shipment_events`

Recommended fields:

* id;  
* shipment\_id;  
* event\_type;  
* status;  
* event\_time;  
* recorded\_at;  
* source;  
* created\_by;  
* city;  
* state;  
* latitude;  
* longitude;  
* public\_message;  
* internal\_message;  
* visibility;  
* metadata;  
* external\_event\_id;  
* idempotency\_key.

Sources may include:

* dispatcher;  
* carrier;  
* driver;  
* ELD integration;  
* GPS provider;  
* system automation;  
* admin;  
* shipper confirmation.

Visibility levels:

* public;  
* shipper;  
* carrier;  
* staff\_only.

A staff-only note must never appear in the customer timeline.

Do not delete event history silently.

Corrections should be recorded as additional audit events.

---

# **8\. CUSTOMER-FACING TRACKING PAGE**

Create a premium PickLoads tracking interface.

The page must show:

## **Header summary**

* PickLoads tracking number;  
* current status;  
* shipment type;  
* origin;  
* destination;  
* estimated delivery;  
* last update time.

## **Progress timeline**

Display the important milestones clearly:

* Quote Accepted  
* Carrier Assigned  
* Dispatched  
* Arrived at Pickup  
* Picked Up  
* In Transit  
* Arrived at Delivery  
* Delivered  
* POD Available

Completed steps:

* visually marked as complete;  
* include date and time.

Current step:

* clearly highlighted.

Future steps:

* visible but inactive.

Exception state:

* use an accessible warning style;  
* explain the problem honestly;  
* show what PickLoads is doing;  
* do not disclose private internal details.

## **Shipment summary**

* pickup location;  
* delivery location;  
* pickup appointment;  
* delivery appointment;  
* equipment;  
* commodity category;  
* weight;  
* pallet count;  
* reference numbers;  
* customer PO number, when applicable.

Do not expose sensitive commodity details publicly unless approved.

## **Contact**

Display:

* PickLoads support;  
* assigned representative or dispatcher, when appropriate;  
* support-message button;  
* phone and email.

Do not expose a driver’s personal phone number publicly by default.

---

# **9\. MAP AND LOCATION TRACKING**

Create the architecture for map-based tracking.

The system must support three tracking modes:

## **Mode A — Manual operational updates**

Dispatcher or carrier updates:

* city;  
* state;  
* current status;  
* estimated arrival;  
* notes.

This is required for launch and must work without GPS integrations.

## **Mode B — Tracking-link provider**

Support future integration with services that provide temporary driver-location links.

The database should support:

* provider;  
* external tracking ID;  
* tracking URL;  
* expiration;  
* consent status.

## **Mode C — ELD/GPS integration**

Prepare an integration layer for future providers such as:

* Motive;  
* Samsara;  
* Geotab;  
* Verizon Connect;  
* other approved telematics providers.

Do not implement a fake connection.

Create an adapter interface so future providers can be added without rewriting the shipment system.

Example interface responsibilities:

* fetch current vehicle location;  
* fetch last update time;  
* fetch vehicle speed, if permitted;  
* fetch ETA inputs;  
* normalize provider data;  
* store raw provider event metadata securely;  
* prevent duplicate events.

## **Privacy rules**

Do not permanently expose exact real-time truck position to every public visitor.

Tracking visibility must be configurable:

* exact location;  
* approximate city/state;  
* milestone-only;  
* hidden.

The shipper portal may receive more precise information than the public tracking page.

Location history retention must be configurable.

---

# **10\. ETA SYSTEM**

Create an ETA architecture that supports:

* manually entered ETA;  
* calculated ETA;  
* provider-supplied ETA;  
* dispatcher-adjusted ETA.

Recommended fields:

* estimated\_pickup\_at;  
* estimated\_delivery\_at;  
* eta\_source;  
* eta\_confidence;  
* eta\_updated\_at;  
* delay\_minutes;  
* delay\_reason\_public;  
* delay\_reason\_internal.

At launch, manual ETA is acceptable.

Do not claim AI-powered or live predictive ETA unless it is truly implemented and supported by real data.

When ETA changes:

* create a shipment event;  
* notify the customer according to preferences;  
* preserve previous ETA values in history or metadata.

---

# **11\. SHIPPER PORTAL**

Expand the Shipper Portal.

Recommended routes:

* `/portal/shipper`  
* `/portal/shipper/quotes`  
* `/portal/shipper/shipments`  
* `/portal/shipper/shipments/[shipmentId]`  
* `/portal/shipper/documents`  
* `/portal/shipper/billing`  
* `/portal/shipper/support`  
* `/portal/shipper/settings`

## **Dashboard summary**

Show:

* pending quotes;  
* booked shipments;  
* pickups today;  
* in-transit shipments;  
* delayed shipments;  
* deliveries today;  
* completed shipments;  
* documents awaiting review;  
* outstanding invoices.

No fake metrics.

Use zero-data and empty states.

## **Shipment list**

Allow filtering by:

* tracking number;  
* PO/reference;  
* date;  
* origin;  
* destination;  
* status;  
* equipment;  
* delayed;  
* delivered.

Use server-side pagination.

Do not load every shipment into the browser.

## **Shipment detail**

Show:

* timeline;  
* current status;  
* ETA;  
* shipment summary;  
* map, when enabled;  
* documents;  
* support messages;  
* invoice status;  
* shipment contacts;  
* update history.

---

# **12\. BROKER-PARTNER ACCESS**

Prepare an optional Broker Partner Portal or organization access model.

Do not make the broker role public by default.

Broker partners must be:

* invited by an admin;  
* verified;  
* attached to a broker organization;  
* granted access shipment by shipment or account agreement.

Broker users may see only approved information.

Recommended permissions:

* assigned shipments;  
* status;  
* timeline;  
* POD;  
* BOL, when authorized;  
* approved contact channels.

They must not automatically see:

* carrier’s private packet;  
* carrier insurance records;  
* shipper billing;  
* PickLoads commission;  
* internal margin;  
* unrelated shipments.

---

# **13\. CARRIER AND DRIVER UPDATE EXPERIENCE**

Create a secure way for shipment status to be updated.

## **Carrier Portal**

Carrier users may update assigned shipments according to permissions.

Allowed actions may include:

* confirm dispatch;  
* en route to pickup;  
* arrived at pickup;  
* loaded;  
* departed pickup;  
* in transit;  
* delayed;  
* arrived at delivery;  
* delivered;  
* upload BOL;  
* upload POD;  
* update ETA;  
* submit exception.

## **Driver update link**

Optional secure driver experience:

`/driver/update/[secureToken]`

Requirements:

* short-lived or shipment-scoped token;  
* no full portal account required for limited update;  
* only assigned shipment;  
* limited status transitions;  
* no access to financial data;  
* no access to other carrier records;  
* rate limited;  
* audit logged;  
* revocable.

Do not expose internal shipment IDs in predictable URLs.

Driver consent must be considered for location tracking.

---

# **14\. DISPATCHER OPERATIONS**

Expand the Dispatcher Dashboard.

Recommended functions:

* create shipment;  
* convert accepted quote to shipment;  
* assign carrier;  
* assign dispatcher;  
* assign driver/truck where available;  
* set appointments;  
* update status;  
* update ETA;  
* add public update;  
* add internal note;  
* upload documents;  
* record call;  
* record email;  
* log exception;  
* resolve exception;  
* request POD;  
* resend customer notification;  
* view update history.

Add an operational board with columns such as:

* Needs Carrier  
* Carrier Assigned  
* Pickup Today  
* In Transit  
* Delivery Today  
* Delayed  
* POD Pending  
* Completed

Use filters and server-side queries.

Use real-time updates only where useful.

Do not use Realtime for every table without need.

---

# **15\. ADMIN MANAGEMENT**

Admin must be able to:

* view all shipments;  
* edit shipment settings;  
* correct tracking numbers only through controlled administrative flow, preferably not at all;  
* control public tracking visibility;  
* manage organization access;  
* manage shipper accounts;  
* manage broker partners;  
* manage carrier assignments;  
* view status history;  
* view document-access history;  
* view notification logs;  
* view webhook events;  
* manage integration credentials through environment variables, never database plaintext;  
* suspend tracking access;  
* revoke public tracking codes;  
* mark shipment sensitive;  
* manage retention settings;  
* audit who changed each status.

---

# **16\. DOCUMENT MANAGEMENT**

Each shipment may have:

* quote;  
* shipper confirmation;  
* rate confirmation;  
* Bill of Lading;  
* lumper receipt;  
* detention documentation;  
* delivery receipt;  
* Proof of Delivery;  
* invoice;  
* claim-related documents;  
* other documents.

Create shipment-document permissions.

Recommended document visibility:

## **Shipper-visible**

* BOL;  
* POD;  
* shipper invoice;  
* approved shipment paperwork.

## **Carrier-visible**

* carrier rate confirmation;  
* BOL;  
* POD;  
* approved operational documents.

## **Staff-only**

* internal notes;  
* carrier compliance documents;  
* internal pricing/margin data;  
* private claim review.

Use private storage and signed URLs.

Do not put shipment documents in public buckets.

---

# **17\. NOTIFICATIONS**

Create event-driven shipment notifications.

Channels at launch:

* email;  
* in-app notifications.

SMS may be added only when Twilio or another approved provider is explicitly enabled and compliant opt-in exists.

Recommended customer notifications:

* quote accepted;  
* carrier assigned;  
* driver dispatched;  
* picked up;  
* shipment in transit;  
* delay reported;  
* delivery ETA updated;  
* arrived at delivery;  
* delivered;  
* POD available;  
* invoice available.

Requirements:

* respect user preferences;  
* avoid duplicate notifications;  
* log notification attempts;  
* localize customer-facing messages;  
* include tracking link;  
* do not expose sensitive data;  
* provide retry handling;  
* record provider response;  
* use idempotency keys.

Create professional React Email templates using PickLoads branding.

---

# **18\. DATABASE ARCHITECTURE**

Audit existing tables before adding new migrations.

Do not duplicate the existing `loads` table if it already represents operational shipments.

Decide whether to:

* extend `loads`;  
* rename conceptually through application services;  
* introduce a separate `shipments` table with migration strategy.

Do not make a destructive rename without a migration and rollback plan.

Potential required tables or additions:

* shipments or extended loads;  
* shipment\_events;  
* shipment\_documents;  
* shipment\_parties;  
* shipment\_assignments;  
* shipment\_tracking\_access;  
* shipment\_locations;  
* shipment\_eta\_history;  
* shipment\_exceptions;  
* tracking\_provider\_connections;  
* notification\_preferences;  
* notification\_deliveries;  
* support\_messages;  
* organization memberships;  
* audit\_events.

Recommended shipment fields:

* id;  
* tracking\_number;  
* shipper\_id;  
* carrier\_id;  
* dispatcher\_id;  
* quote\_id;  
* broker\_partner\_id;  
* status;  
* origin fields;  
* destination fields;  
* pickup appointment;  
* delivery appointment;  
* equipment;  
* commodity category;  
* weight;  
* pallets;  
* distance;  
* gross shipper amount, staff-only;  
* carrier pay, staff-only;  
* dispatch fee or margin, staff-only;  
* reference numbers;  
* public tracking enabled;  
* tracking mode;  
* public access hash;  
* current latitude;  
* current longitude;  
* current city;  
* current state;  
* last\_location\_at;  
* current ETA;  
* created\_at;  
* updated\_at;  
* completed\_at;  
* cancelled\_at.

Sensitive financial data must never be included in public shipment queries.

Use database views or server-side serializers to control exposed fields.

---

# **19\. RLS AND AUTHORIZATION**

Create and test complete RLS policies.

## **Shipper**

Can select shipments where the authenticated user belongs to the shipment’s shipper organization.

## **Broker Partner**

Can select only shipments explicitly linked to their broker organization and permitted by sharing policy.

## **Carrier**

Can select assigned shipments for their carrier organization.

Carrier updates must be limited to approved fields and transitions.

## **Dispatcher**

Can select and manage shipments assigned to them or their operational team, according to role policy.

## **Admin**

Full authorized operational access.

## **Public tracking**

Do not use direct anonymous table SELECT access.

Public tracking requests must go through a server-side route or server action that:

* validates tracking number;  
* validates secondary access credential;  
* applies rate limiting;  
* returns a strict public DTO;  
* logs access;  
* prevents enumeration.

Add tests proving:

* Shipper A cannot view Shipper B’s shipment;  
* Carrier A cannot view Carrier B’s shipment;  
* Broker A cannot view Broker B’s shipment;  
* public tracking cannot expose private fields;  
* carrier users cannot edit financial fields;  
* dispatcher permissions are limited;  
* unauthorized status transitions fail.

---

# **20\. STATUS TRANSITION RULES**

Create server-side status-transition validation.

Examples:

* `quote_accepted` may move to `carrier_search`;  
* `carrier_assigned` requires a carrier assignment;  
* `picked_up` should require pickup confirmation;  
* `delivered` may require delivery timestamp;  
* `pod_uploaded` requires an approved POD document;  
* `completed` should require delivery and the required operational closeout;  
* `cancelled` must record a cancellation reason.

Prevent impossible transitions such as:

* `delivered` directly back to `carrier_search`;  
* public user marking a shipment paid;  
* carrier changing shipper financial data;  
* driver marking another carrier’s shipment delivered.

Allow controlled admin correction with mandatory reason and audit event.

---

# **21\. EXCEPTIONS AND DELAYS**

Create a shipment-exception system.

Exception types:

* pickup delay;  
* delivery delay;  
* mechanical issue;  
* weather;  
* traffic;  
* facility delay;  
* rejected freight;  
* damaged freight;  
* missing appointment;  
* driver unavailable;  
* carrier cancellation;  
* documentation issue;  
* other.

Each exception should include:

* severity;  
* public description;  
* internal description;  
* opened\_at;  
* resolved\_at;  
* opened\_by;  
* assigned\_to;  
* customer notified;  
* resolution.

The customer should see a clear and calm explanation.

Do not expose blame, legal conclusions or sensitive internal commentary.

---

# **22\. RESPONSIVE DESIGN**

The entire tracking experience must be fully responsive.

Test at minimum:

* 320px;  
* 360px;  
* 375px;  
* 390px;  
* 414px;  
* 480px;  
* 768px;  
* 820px;  
* 1024px;  
* 1280px;  
* 1440px;  
* 1920px.

Requirements:

* no horizontal page overflow;  
* no clipped timeline;  
* no unreadable shipment table;  
* no oversized map;  
* no form controls outside viewport;  
* no hidden actions;  
* no hover-only interactions;  
* no tiny touch targets;  
* no fixed-height cards cutting content;  
* no mobile modal exceeding screen;  
* no iOS date-input overflow.

## **Mobile tracking page**

Prioritize:

1. current status;  
2. ETA;  
3. origin and destination;  
4. timeline;  
5. support;  
6. documents;  
7. map.

Do not force desktop tables onto mobile.

Convert operational rows to cards when appropriate.

---

# **23\. ACCESSIBILITY**

Target WCAG 2.2 AA.

Requirements:

* semantic timeline markup;  
* text labels in addition to status colors;  
* keyboard-accessible filters;  
* accessible map alternative;  
* focus-visible controls;  
* correct headings;  
* accessible date/time formatting;  
* status changes announced with aria-live where appropriate;  
* no critical information only on hover;  
* reduced-motion support;  
* meaningful document labels;  
* accessible error and empty states.

The visual tracking timeline must have a text equivalent for assistive technologies.

---

# **24\. INTERNATIONALIZATION**

All customer-facing tracking strings must use next-intl.

Locales:

* English;  
* Spanish;  
* French;  
* Haitian Creole;  
* Russian.

Localize:

* shipment statuses;  
* event descriptions;  
* emails;  
* errors;  
* empty states;  
* date and time formatting;  
* tracking forms;  
* notification preferences;  
* accessibility labels.

Internal staff notes do not need automatic translation.

Do not machine-translate customer-specific free text automatically without a defined workflow.

---

# **25\. PERFORMANCE AND SCALE**

Design for:

* thousands of shippers;  
* thousands of carriers;  
* hundreds of thousands of shipment events;  
* large document history;  
* high tracking-page traffic.

Requirements:

* server-side pagination;  
* indexed status/date/organization columns;  
* no N+1 queries;  
* lightweight public tracking response;  
* cache only safe, non-sensitive data;  
* never cache private shipment data publicly;  
* event timeline pagination or sensible limits;  
* query current summary separately from full history when needed;  
* map scripts lazy-loaded;  
* database indexes documented;  
* background notification processing architecture prepared.

Do not load all events or documents by default when a shipment has a large history.

---

# **26\. OBSERVABILITY**

Use existing Sentry and logging infrastructure.

Track:

* public tracking failures;  
* repeated invalid tracking attempts;  
* status-update errors;  
* webhook failures;  
* notification failures;  
* location-provider failures;  
* unauthorized access attempts;  
* document-download errors;  
* ETA calculation failures.

Never log:

* passwords;  
* full bank information;  
* EIN plaintext;  
* private document contents;  
* access tokens;  
* exact location data beyond operational need.

---

# **27\. TESTING**

## **Unit tests**

* tracking-number generation;  
* public DTO serializer;  
* status transitions;  
* ETA formatting;  
* event visibility;  
* permission helpers;  
* access-code verification;  
* notification deduplication.

## **Integration tests**

* create shipment;  
* assign carrier;  
* create shipment event;  
* update status;  
* public tracking lookup;  
* shipper portal lookup;  
* carrier update;  
* document upload;  
* POD upload;  
* notification generation;  
* exception creation and resolution.

## **E2E tests**

### **Shipper flow**

Login  
→ View shipments  
→ Open shipment  
→ View timeline  
→ Download POD  
→ Submit support message.

### **Public tracking flow**

Enter tracking number  
→ Enter secondary verification  
→ View approved public shipment data  
→ Invalid access fails safely.

### **Dispatcher flow**

Create shipment  
→ Assign carrier  
→ Update pickup status  
→ Record delay  
→ Update ETA  
→ Mark delivered  
→ Request POD  
→ Complete shipment.

### **Carrier flow**

Login  
→ View assigned shipment  
→ Update en route  
→ Confirm pickup  
→ Upload BOL  
→ Mark delivered  
→ Upload POD.

### **Security flow**

* Shipper A cannot access Shipper B;  
* Carrier A cannot access Carrier B;  
* public tracking cannot expose financial fields;  
* expired driver token fails;  
* unauthorized status transition fails;  
* revoked tracking code fails.

## **Responsive tests**

Run Playwright screenshots on:

* public `/track`;  
* authenticated shipment list;  
* shipment detail;  
* dispatcher board;  
* status-update form;  
* mobile timeline.

Viewports:

* 375 × 812;  
* 390 × 844;  
* 768 × 1024;  
* 1024 × 768;  
* 1440 × 900\.

---

# **28\. IMPLEMENTATION MODULES**

Before coding, audit the current repository and report what already exists.

Recommended modules:

M-70 — Existing loads/shipments architecture audit  
M-71 — Shipment schema and migrations  
M-72 — Status transition and event engine  
M-73 — Public secure tracking page  
M-74 — Shipper shipment list and detail pages  
M-75 — Dispatcher shipment operations  
M-76 — Carrier shipment update experience  
M-77 — Shipment documents and POD workflow  
M-78 — ETA, exceptions and delays  
M-79 — Email and in-app shipment notifications  
M-80 — Tracking map and provider-adapter architecture  
M-81 — Broker-partner access preparation  
M-82 — Responsive and accessibility QA  
M-83 — RLS, security and public-enumeration audit  
M-84 — E2E tests, documentation and launch updates

After every module:

1. run lint;  
2. run typecheck;  
3. run unit tests;  
4. run relevant integration tests;  
5. run relevant E2E tests;  
6. review RLS;  
7. review responsive behavior;  
8. review accessibility;  
9. update documentation;  
10. list files changed;  
11. list migrations;  
12. list required environment variables;  
13. provide rollback instructions;  
14. create a clean Git commit.

Do not mark a module complete until it is functional, secure, tested and documented.

---

# **29\. DOCUMENTATION**

Create or update:

* shipment architecture;  
* shipment status model;  
* event visibility model;  
* tracking-number rules;  
* public tracking security;  
* shipper tracking portal;  
* carrier update workflow;  
* dispatcher workflow;  
* document permissions;  
* notification architecture;  
* ETA architecture;  
* tracking-provider adapter interface;  
* RLS policies;  
* migrations;  
* responsive behavior;  
* testing;  
* launch procedure;  
* troubleshooting.

Update `LAUNCHRUNBOOK.md` with:

* new environment variables;  
* database migrations;  
* public tracking configuration;  
* map configuration;  
* notification setup;  
* smoke tests;  
* go-live checks;  
* rollback steps.

---

# **30\. HONEST PRODUCT RULES**

Do not display fake GPS positions.

Do not display fake ETAs.

Do not display fabricated shipments.

Do not claim “live tracking” when the system has only manual updates.

Use honest labels:

* “Last updated by dispatch”  
* “Milestone tracking”  
* “Live location available”  
* “Location temporarily unavailable”  
* “ETA provided by dispatcher”  
* “Tracking link expired”

Do not call the tracking system “AI-powered” unless real AI functionality is implemented and validated.

---

# **31\. FINAL ACCEPTANCE CRITERIA**

The tracking system is accepted only when:

* authorized shippers can view their shipments;  
* public users can securely track with secondary verification;  
* carriers can update only assigned shipments;  
* dispatchers can manage shipment operations;  
* admins can audit every status change;  
* shipment timelines preserve event history;  
* status transitions are validated server-side;  
* ETA changes create history;  
* delays and exceptions are supported;  
* documents use private storage;  
* POD can be uploaded and shared securely;  
* customer notifications are logged;  
* public tracking exposes no private financial data;  
* RLS isolation tests pass;  
* mobile tracking works from 320px upward;  
* portal and tracking pages meet accessibility requirements;  
* no fake location or status data is presented;  
* production build passes;  
* documentation and Launch Runbook are updated.

---

# **FIRST RESPONSE REQUIRED**

Do not start with broad code changes.

First provide:

1. Existing `loads` and shipment-related architecture  
2. Existing Shipper Portal functionality  
3. Existing Carrier Portal shipment functionality  
4. Existing Dispatcher/Admin functionality  
5. Existing database tables and RLS relevant to tracking  
6. Existing document and notification infrastructure  
7. Gaps between the current build and this directive  
8. Recommended approach: extend `loads` or introduce `shipments`  
9. Proposed migrations  
10. Security risks  
11. Legal/authority gating requirements  
12. Responsive risks  
13. Implementation module plan  
14. Files expected to change  
15. Decisions requiring business approval

Then begin M-70 only after presenting the audit.

Proceed with the audit now.

