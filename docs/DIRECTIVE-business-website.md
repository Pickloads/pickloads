\# 32\. ENTERPRISE BUSINESS WEBSITE EXPERIENCE

The PickLoads platform is first and foremost the official business website of PickLoads Logistics Group LLC.

While the application already includes operational portals (Carrier, Shipper, Dispatcher and Admin), the public-facing website must also represent a premium logistics company capable of acquiring customers, recruiting carriers and building trust.

The implementation must enhance the existing architecture without replacing any current functionality.

Do not remove, simplify or redesign any existing modules.

The following business features must be integrated into the current platform.

\--------------------------------------------------  
A. COMPANY WEBSITE EXPERIENCE  
\--------------------------------------------------

Create a modern corporate website experience with enterprise-quality UI/UX.

The public website must include professional sections for:

• Home  
• About PickLoads  
• Our Services  
• Truck Dispatch  
• Freight Brokerage (respect brokerage activation rules)  
• New Authority Program  
• Become a Carrier  
• Request a Quote  
• Shipment Tracking  
• Carrier Resources  
• Contact  
• Careers  
• Blog / News  
• FAQ  
• Support Center

Every page must follow the approved PickLoads Design System.

Maintain consistent branding across desktop, tablet and mobile.

\--------------------------------------------------  
B. CUSTOMER REVIEWS  
\--------------------------------------------------

Create a Customer Reviews & Testimonials system.

Support:

• written testimonials  
• company name  
• customer name  
• rating  
• optional company logo  
• approval workflow  
• featured testimonials  
• homepage testimonials  
• carousel component

Only approved testimonials may appear publicly.

\--------------------------------------------------  
C. CARRIER REVIEWS  
\--------------------------------------------------

Create an internal Carrier Review system.

This feature is for PickLoads staff only.

Support:

• carrier performance score  
• communication  
• professionalism  
• on-time performance  
• document quality  
• POD speed  
• reliability  
• internal notes  
• active/inactive flag

Do not expose internal carrier ratings publicly.

\--------------------------------------------------  
D. LIVE CHAT & SUPPORT CENTER  
\--------------------------------------------------

Create a Support Center.

Include:

• Live Chat architecture  
• Contact form  
• Email support  
• Ticket history  
• Frequently Asked Questions  
• Knowledge Base  
• Search articles

Support future integration with providers such as:

• Intercom  
• Crisp  
• Tawk  
• Zendesk

Do not hardcode a provider.

Create an adapter layer.

\--------------------------------------------------  
E. KNOWLEDGE BASE  
\--------------------------------------------------

Create a searchable Knowledge Base.

Support categories including:

• Dispatch  
• Brokerage  
• Carrier Onboarding  
• New Authority  
• Payments  
• Tracking  
• Billing  
• Compliance  
• Documents  
• Technical Support

Support:

• categories  
• tags  
• search  
• related articles  
• featured articles

\--------------------------------------------------  
F. DOWNLOADS CENTER  
\--------------------------------------------------

Create a secure Downloads Center.

Support downloadable resources such as:

• Carrier Packet  
• W-9  
• Certificate of Insurance  
• Operating Authority  
• Company Profile  
• Safety Information  
• New Authority Checklist  
• Dispatch Agreement  
• Broker Agreement  
• Other approved resources

Files should support versioning and admin management.

\--------------------------------------------------  
G. COMPANY BLOG  
\--------------------------------------------------

Create a professional Blog / News module.

Purpose:

• SEO  
• company announcements  
• trucking news  
• educational articles  
• customer updates

Support:

• categories  
• authors  
• featured image  
• tags  
• SEO metadata  
• related posts  
• search  
• pagination

\--------------------------------------------------  
H. CAREERS  
\--------------------------------------------------

Create a Careers page.

Support:

• available positions  
• job descriptions  
• application form  
• resume upload  
• application tracking

\--------------------------------------------------  
I. PARTNER PROGRAM  
\--------------------------------------------------

Create a Partner Program section.

Support future partners including:

• logistics partners  
• software partners  
• insurance partners  
• compliance partners  
• factoring partners

Allow partnership inquiries.

\--------------------------------------------------  
J. REFERRAL PROGRAM  
\--------------------------------------------------

Create a Referral Program.

Support:

• referral links  
• referral tracking  
• referral rewards  
• referral dashboard  
• referral history

Architecture only if rewards are not yet enabled.

\--------------------------------------------------  
K. REQUEST A QUOTE  
\--------------------------------------------------

Create a professional Request a Quote workflow.

Support:

• shipment details  
• origin  
• destination  
• equipment  
• commodity  
• pickup date  
• delivery date  
• contact information  
• file attachments

Quote requests must integrate into the existing CRM.

\--------------------------------------------------  
L. BECOME A CARRIER  
\--------------------------------------------------

Create a complete Carrier Recruitment page.

Support:

• online application  
• upload documents  
• MC number  
• DOT number  
• insurance upload  
• W-9  
• carrier packet  
• onboarding progress

Integrate with the existing Carrier Portal.

\--------------------------------------------------  
M. LOGIN EXPERIENCE  
\--------------------------------------------------

Create a unified Login Center.

Support dedicated entry points for:

• Client Login  
• Carrier Login  
• Dispatcher Login  
• Admin Login

All authentication should use the existing authentication system.

Do not duplicate authentication logic.

\--------------------------------------------------  
N. NEWSLETTER  
\--------------------------------------------------

Create a Newsletter module.

Support:

• email subscription  
• confirmation email  
• unsubscribe  
• segmentation  
• export  
• analytics

\--------------------------------------------------  
O. MULTI-LANGUAGE  
\--------------------------------------------------

Extend localization support.

Public website languages:

• English  
• Spanish  
• French  
• Haitian Creole

Use next-intl.

\--------------------------------------------------  
P. GOOGLE REVIEWS  
\--------------------------------------------------

Create an integration layer for Google Reviews.

Support:

• business rating  
• review count  
• approved display  
• homepage widget

Do not fake reviews.

\--------------------------------------------------  
Q. GOOGLE MAPS  
\--------------------------------------------------

Integrate Google Maps.

Support:

• office location  
• directions  
• contact page map

\--------------------------------------------------  
R. MEETING BOOKING  
\--------------------------------------------------

Create a Meeting Booking section.

Prepare integration with:

• Calendly

Future providers should be easily added.

\--------------------------------------------------  
S. AUDIT LOGS  
\--------------------------------------------------

Expand Audit Logs.

Track:

• administrative actions  
• document changes  
• shipment changes  
• user actions  
• login events  
• portal actions

\--------------------------------------------------  
T. ADVANCED SEARCH  
\--------------------------------------------------

Create a global search system.

Support searching:

• shipments  
• customers  
• carriers  
• blog articles  
• FAQ  
• knowledge base  
• documents

\--------------------------------------------------  
U. DARK / LIGHT MODE  
\--------------------------------------------------

Implement Theme Switching.

Support:

• Light  
• Dark  
• System

Persist user preference.

\--------------------------------------------------  
V. PWA  
\--------------------------------------------------

Prepare the application as a Progressive Web App.

Support:

• installable application  
• offline shell  
• manifest  
• icons  
• splash screen  
• update notifications

Offline functionality should never expose stale or sensitive shipment data.

\--------------------------------------------------  
FINAL REQUIREMENT

All of these additions must integrate into the existing PickLoads architecture.

Do not duplicate existing modules.

Do not remove existing functionality.

Respect the current design system.

Respect existing authentication.

Respect existing RLS.

Respect the current project architecture.

The goal is to deliver a premium enterprise business website for PickLoads Logistics Group LLC while preserving the operational platform already defined.  
