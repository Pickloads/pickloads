/*
 * M-35 — State page content (typed TS module, same pattern/rationale as
 * src/content/equipment.ts): structured fields feed the template, JSON-LD
 * and the sitemap from one source; no MDX pipeline enters the bundle.
 *
 * Content is original English long-form (500–800 words/page). Six priority
 * states ship now (arch: "6 priority states with real content, then 4–6 per
 * month"); the ×5-locale translation is the O-03 content workstream. Rates
 * are typical 2026 spot-market ranges and are labeled as estimates.
 */

export const STATE_SLUGS = [
  "new-jersey",
  "new-york",
  "florida",
  "georgia",
  "texas",
  "illinois",
] as const;

export type StateSlug = (typeof STATE_SLUGS)[number];

export interface StateLaneNode {
  label: string;
  hot?: boolean;
}

export interface StateContent {
  slug: StateSlug;
  code: string;
  /** Full page H1, e.g. "New Jersey Truck Dispatch". */
  name: string;
  stateName: string;
  abbr: string;
  metaTitle: string;
  metaDescription: string;
  heroLead: string;
  introHeading: string;
  intro: string[];
  ratesNote: string;
  lanesTitle: string;
  lanes: StateLaneNode[];
  requirementsHeading: string;
  requirements: string[];
  faq: ReadonlyArray<readonly [string, string]>;
  blurb: string;
}

export const STATE_CONTENT: Record<StateSlug, StateContent> = {
  "new-jersey": {
    slug: "new-jersey",
    code: "ST-01",
    name: "New Jersey Truck Dispatch",
    stateName: "New Jersey",
    abbr: "NJ",
    metaTitle:
      "New Jersey Truck Dispatch Service — Port Newark, Exit 8A & NYC Metro Lanes | PickLoads",
    metaDescription:
      "Home-state dispatch for New Jersey owner-operators: Port Newark–Elizabeth freight, Exit 8A warehouse lanes, NYC metro deliveries and Northeast reloads. Flat 5% per load, no forced dispatch.",
    heroLead:
      "We're based in Irvington, ten minutes from Port Newark — New Jersey isn't a market we study on a map, it's the one we drive every day. The Garden State moves an enormous share of Northeast freight, and running it profitably means mastering tolls, tight docks and the reload math.",
    introHeading: "Our home market, worked like locals.",
    intro: [
      "New Jersey punches far above its size in freight. Port Newark–Elizabeth is the busiest container complex on the East Coast, feeding a warehouse belt that runs down the Turnpike to the Exit 8A cluster around Cranbury, Monroe and South Brunswick — one of the largest concentrations of distribution space in the country. Add the pharmaceutical corridor along I-78, food importers in Elizabeth and Newark, and the daily gravity of 20 million consumers between Philadelphia and New York, and there is always freight moving. The question is never volume; it's whether the rate survives the tolls and the dwell time.",
      "That's where local dispatch earns its fee. The Turnpike, the Parkway, the George Washington Bridge and the crossings into the city are some of the most expensive truck miles in America, and a load that looks strong at $3.00/mi can die in bridge tolls and a four-hour receiver in Brooklyn. We price NJ freight net of the crossing it actually requires, we know which Elizabeth and Kearny warehouses turn trucks in an hour versus half a shift, and we schedule NYC metro deliveries around the windows that keep your day alive.",
      "The reload story is honest but manageable: the Northeast is inbound-heavy, so inbound rates into North Jersey run strong while outbound van rates soften. We plan around it — port and intermodal freight out of the NJ ramps, food-grade reefer out of South Jersey and Vineland, and round-trip economics to the Southeast and Midwest that value the week, not the single leg. For drayage-adjacent work, TWIC-carded drivers open Port Newark and Elizabeth marine terminals that other trucks simply can't touch.",
    ],
    ratesNote:
      "// Typical 2026 spot ranges we see around NJ: inbound NYC-metro van $2.40–$3.00/mi, outbound van $1.90–$2.30, reefer +30–50¢, local port work priced per turn. Estimates, not promises — every lane is negotiated live, net of tolls.",
    lanesTitle: "Typical NJ flow — Northeast base",
    lanes: [
      { label: "PORT NEWARK NJ", hot: true },
      { label: "EXIT 8A WAREHOUSES" },
      { label: "PHILADELPHIA PA" },
      { label: "HARRISBURG PA" },
      { label: "ALLENTOWN PA" },
      { label: "BACK TO NJ", hot: true },
    ],
    requirementsHeading: "Running New Jersey with us",
    requirements: [
      "Active MC/DOT authority in good standing",
      "$1M auto liability / $100K cargo insurance",
      "E-ZPass transponder (Turnpike/GWB cash rates are brutal)",
      "TWIC card for port terminal work (optional, opens drayage)",
      "NYC-legal equipment for metro deliveries (53' restrictions apply on parkways)",
      "W-9 and voided check or factoring NOA",
    ],
    faq: [
      [
        "Do you actually know the New Jersey market?",
        "It's our home base — PickLoads operates from Irvington, NJ, minutes from the port and the Turnpike. We dispatch NJ lanes with local knowledge of tolls, dock behavior and traffic windows, not just load-board averages.",
      ],
      [
        "Is New York City delivery worth taking?",
        "Often, yes — NYC pays a premium for a reason. We take metro loads when the rate covers the crossing, the receiver has a workable window and the truck is legal for the route. We decline the ones that only look good before tolls.",
      ],
      [
        "What about port drayage from Port Newark?",
        "Full drayage (chassis, UIIA interchange) is a specialized operation, but we regularly book port-adjacent freight — transloads, container-freight-station pickups and warehouse moves — and TWIC-carded drivers get access to more of it.",
      ],
      [
        "Outbound NJ rates look weak. How do you handle that?",
        "By planning the round trip before booking the outbound leg. A softer outbound to a strong reload market (Harrisburg, Allentown, the Carolinas) usually beats holding out for a unicorn rate while your truck sits.",
      ],
    ],
    blurb:
      "Local New Jersey dispatch from our Irvington HQ: Port Newark freight, Exit 8A warehouse lanes, NYC metro deliveries priced net of tolls, and Northeast reload planning at a flat 5% per load.",
  },

  "new-york": {
    slug: "new-york",
    code: "ST-02",
    name: "New York Truck Dispatch",
    stateName: "New York",
    abbr: "NY",
    metaTitle:
      "New York Truck Dispatch Service — NYC Metro, HUT Compliance & Upstate Lanes | PickLoads",
    metaDescription:
      "Dispatch for New York carriers: NYC borough deliveries with legal routing, HUT permit compliance, upstate I-90 lanes and premium inbound rates. Flat 5% per load, no forced dispatch.",
    heroLead:
      "New York freight pays a premium because most of the country doesn't want to run it: low bridges, banned parkways, congestion tolls, and receivers that measure dock time in half-days. With a dispatcher who plans NYC like a local, that premium becomes profit instead of punishment.",
    introHeading: "Premium freight for drivers who can handle it.",
    intro: [
      "New York is really two freight markets. Downstate, the five boroughs and Long Island form one of the highest-paying delivery zones in the country — grocery, foodservice, retail and construction materials feeding 20+ million people through a road network that was never designed for 53-footers. Upstate is a different world: the I-90 corridor through Albany, Syracuse, Rochester and Buffalo moves manufacturing, paper, food and Canada-border freight at steadier, thinner rates. A good week often stitches the two together.",
      "Downstate execution is where dispatch matters most. Trucks are banned from most parkways, low bridges have ended careers, and Manhattan south of 60th Street now carries a congestion toll on top of the crossings. We route borough deliveries over legal truck routes, book delivery windows that respect the receiver's reality, and price every NYC load net of tolls and expected dwell. When a broker's 'quick Brooklyn drop' is actually a 6-hour lumper job, we either get it priced in or we pass.",
      "Compliance is the other half. New York's Highway Use Tax means a HUT certificate and decals for most vehicles over 18,000 lbs operating on public highways, with quarterly mileage filings — miss it and roadside inspections get expensive fast. We keep it on your requirements checklist from day one, along with the port and border paperwork for carriers touching JFK air freight or the Buffalo/Champlain crossings. Upstate, we lean on reload pairs — inbound NYC premium out, Albany or Scranton reload back — so the deadhead out of the metro never eats the margin.",
    ],
    ratesNote:
      "// Typical 2026 spot ranges: inbound NYC van $2.50–$3.20/mi (before tolls — we negotiate net), upstate I-90 van $1.90–$2.30, reefer +30–50¢. NYC pays for patience; we make sure it pays yours. Estimates, not promises.",
    lanesTitle: "Typical NY flow — downstate premium + upstate reload",
    lanes: [
      { label: "NYC METRO", hot: true },
      { label: "ALBANY NY" },
      { label: "SYRACUSE NY" },
      { label: "BUFFALO NY" },
      { label: "SCRANTON PA" },
      { label: "BACK TO NYC", hot: true },
    ],
    requirementsHeading: "Running New York with us",
    requirements: [
      "Active MC/DOT authority in good standing",
      "NY HUT certificate of registration + decals (over 18,000 lbs GVW)",
      "$1M auto liability / $100K cargo insurance",
      "E-ZPass (crossings + Thruway) — cash tolls kill NYC margins",
      "Legal truck-route knowledge or willingness to follow our routing",
      "W-9 and voided check or factoring NOA",
    ],
    faq: [
      [
        "Is NYC freight worth the hassle?",
        "At the right rate, absolutely — it's one of the few markets where $3+/mi van freight is routine. The margin lives in the details: legal routing, toll math and realistic delivery windows. That's exactly the work we do before you accept.",
      ],
      [
        "What is the NY HUT and do I need it?",
        "New York's Highway Use Tax applies to most trucks over 18,000 lbs on NY public highways. You need a HUT certificate and decal before running, plus quarterly filings. We flag it during onboarding for any carrier planning NY miles — it's cheap to comply and expensive to skip.",
      ],
      [
        "Do you dispatch upstate-only carriers?",
        "Yes. Buffalo, Rochester, Syracuse and Albany have steady manufacturing and food freight, plus Canada-border volume. Rates are thinner than the metro, so we work round-trips and consistent shipper relationships rather than one-off spot loads.",
      ],
      [
        "Can you keep me out of Manhattan?",
        "If you don't want island work, we simply don't book it — no forced dispatch means exactly that. Plenty of NY freight delivers to Brooklyn, Queens, the Bronx and Long Island distribution points without touching the congestion zone.",
      ],
    ],
    blurb:
      "New York dispatch that treats NYC like the specialized market it is: legal borough routing, toll-aware pricing, HUT compliance guidance and upstate reload planning at a flat 5% per load.",
  },

  florida: {
    slug: "florida",
    code: "ST-03",
    name: "Florida Truck Dispatch",
    stateName: "Florida",
    abbr: "FL",
    metaTitle:
      "Florida Truck Dispatch Service — Produce Season, Ports & I-95/I-75 Lanes | PickLoads",
    metaDescription:
      "Dispatch for Florida owner-operators: produce-season reefer strategy, port freight from Jax to Miami, and honest outbound planning in an inbound-heavy state. Flat 5% per load.",
    heroLead:
      "Florida is the classic one-way market: the whole country ships in, and everybody fights over what ships out. Carriers who win here either ride the produce calendar, work the ports, or price the inbound leg knowing exactly what the outbound will pay. We dispatch all three ways.",
    introHeading: "An inbound state, worked with an outbound plan.",
    intro: [
      "Nearly 23 million residents and over a hundred million annual visitors make Florida a consumption machine: groceries, building materials, retail and hospitality freight pour down I-95 and I-75 every day. That's the good news if you're hauling into the state — inbound rates from the Southeast and Northeast stay healthy most of the year. The catch is the exit: manufactured outbound freight is thin, and undispatched trucks routinely leave Miami at rates that don't cover fuel.",
      "The seasonal answer is produce. From roughly November through June — peaking hard in April–June — South Florida and the Homestead area, plus Central Florida citrus and Plant City strawberries, load reefers north at rates that can double the van market. It's demanding freight: pre-cools, pulp temps, multi-pick schedules and receivers who reject casually. We run the temp-protocol discipline (and the paperwork trail) that keeps claims off your record, and we book the produce calendar deliberately rather than luckily.",
      "Year-round, the structural answer is the ports and the drayage-adjacent belt around them: JAXPORT in Jacksonville, Port Everglades, PortMiami and Tampa feed transload warehouses that generate real outbound van work, and Lakeland–Orlando's distribution cluster along I-4 reloads trucks that know when to be there. When outbound is simply soft, we price the round trip honestly — a strong inbound plus a modest outbound to Atlanta or Savannah beats sitting three days in Medley waiting for a miracle.",
    ],
    ratesNote:
      "// Typical 2026 spot ranges: inbound FL van $2.20–$2.70/mi, outbound van $1.60–$2.00 off-season, produce-season reefer out of South FL $2.80–$3.60 at peak. Estimates, not promises — the produce calendar moves and so do we.",
    lanesTitle: "Typical FL flow — produce season northbound",
    lanes: [
      { label: "HOMESTEAD FL", hot: true },
      { label: "LAKELAND FL" },
      { label: "ATLANTA GA" },
      { label: "CHARLOTTE NC" },
      { label: "RICHMOND VA" },
      { label: "NORTHEAST DELIVERY", hot: true },
    ],
    requirementsHeading: "Running Florida with us",
    requirements: [
      "Active MC/DOT authority in good standing",
      "$1M auto liability / $100K cargo insurance ($250K preferred for produce)",
      "Reefer: functioning unit with temp download capability for produce claims defense",
      "SunPass or interoperable toll transponder (FL toll roads)",
      "Hurricane-season flexibility June–November (FEMA/relief freight surges)",
      "W-9 and voided check or factoring NOA",
    ],
    faq: [
      [
        "How do you deal with Florida's weak outbound rates?",
        "By never booking the inbound leg blind. We check the outbound board for your delivery area before committing, target port and I-4 corridor reloads, and in produce season we position reefers where the calendar says the money will be.",
      ],
      [
        "When is Florida produce season and what does it pay?",
        "Roughly November to June, peaking April–June. At peak, reefer loads out of South Florida commonly run $1/mi above the van market. It's strict freight — temps, appointments, rejection risk — and we manage that discipline with you.",
      ],
      [
        "Is there decent van freight without a reefer?",
        "Yes: port transloads out of Jacksonville, Miami and Tampa, the I-4 distribution corridor, and building-material flows. Outbound van is the thinner side, which is why our FL van strategy is round-trip pricing rather than single-leg optimism.",
      ],
      [
        "What happens during hurricane season?",
        "Freight surges — generators, water, building supplies, FEMA relief loads — often at premium rates. We take them when they make sense and keep you clear of storm zones when they don't. Your truck, your call, always.",
      ],
    ],
    blurb:
      "Florida dispatch with an honest outbound plan: produce-season reefer strategy, port and I-4 corridor reloads, and round-trip pricing for an inbound-heavy state. Flat 5% per load.",
  },

  georgia: {
    slug: "georgia",
    code: "ST-04",
    name: "Georgia Truck Dispatch",
    stateName: "Georgia",
    abbr: "GA",
    metaTitle:
      "Georgia Truck Dispatch Service — Atlanta Hub, Port of Savannah & Southeast Lanes | PickLoads",
    metaDescription:
      "Dispatch for Georgia carriers: Atlanta's distribution hub, Port of Savannah container freight, poultry reefer lanes and the strongest outbound market in the Southeast. Flat 5%.",
    heroLead:
      "If the Southeast has a freight capital, it's Georgia: Atlanta is the region's distribution brain and Savannah is America's fastest-growing container port. A Georgia-based truck sits inside one of the few markets where inbound and outbound both pay — if the dispatcher knows which board to work.",
    introHeading: "The Southeast's freight engine, front to back.",
    intro: [
      "Metro Atlanta is ringed by one of the country's densest distribution networks — hundreds of millions of square feet of warehouse along I-85, I-75 and I-20, serving retail, grocery, automotive and e-commerce for the entire Southeast. For a dry van operator that means genuine two-way volume: Atlanta is a top-tier outbound market by any measure, and its reload depth means a delivered truck rarely waits long. Our job is picking the right freight from a deep board — vetting the broker, protecting the RPM and keeping the week's miles paid, not just the day's.",
      "Savannah changes the math for the eastern half of the state. The Port of Savannah's Garden City Terminal is the largest single container terminal in North America, and its growth has pulled transload warehouses, import distribution and export ag freight into the I-16/I-95 corridor. Even without running formal drayage, carriers earn steady money on port-adjacent work — container transloads heading to Atlanta, the Carolinas and Florida, and export-bound loads returning. We track vessel-driven surges the way produce dispatchers track harvests.",
      "Georgia also feeds specialized lanes: America's poultry capital around Gainesville loads reefer freight year-round, North Georgia's carpet and flooring industry out of Dalton fills flatbeds and vans with heavy, dense product, and Southeast produce (Vidalia onions, peaches, pecans) adds seasonal reefer spikes. Winter is mild, tolls are minimal, and I-75/I-85 connect you to Florida's inbound premium and the Carolinas' manufacturing base within a day's drive. It's as balanced a home base as trucking offers — we make sure the balance shows up in your settlement.",
    ],
    ratesNote:
      "// Typical 2026 spot ranges: Atlanta outbound van $2.00–$2.50/mi, Savannah port-adjacent $2.10–$2.60, Gainesville poultry reefer $2.40–$2.90. Estimates, not promises — Atlanta's board is deep enough to negotiate hard.",
    lanesTitle: "Typical GA flow — Atlanta hub rotation",
    lanes: [
      { label: "ATLANTA GA", hot: true },
      { label: "SAVANNAH GA" },
      { label: "CHARLOTTE NC" },
      { label: "NASHVILLE TN" },
      { label: "BIRMINGHAM AL" },
      { label: "BACK TO ATLANTA", hot: true },
    ],
    requirementsHeading: "Running Georgia with us",
    requirements: [
      "Active MC/DOT authority in good standing",
      "$1M auto liability / $100K cargo insurance",
      "Peach Pass optional (GA express lanes; most truck routes are toll-free)",
      "TWIC card for Savannah terminal access (optional, opens port work)",
      "Reefer for poultry/produce lanes: temp download capability",
      "W-9 and voided check or factoring NOA",
    ],
    faq: [
      [
        "Is Atlanta really a good market for owner-operators?",
        "It's one of the best in the country: deep outbound board, fast reloads and balanced flows. The risk is the opposite one — cheap freight hides in deep boards. Our job is refusing the loads that only look acceptable because they're convenient.",
      ],
      [
        "Can I get port freight without being a drayage carrier?",
        "Yes. Savannah's growth built a transload economy: containers get stripped at Garden City-area warehouses and reloaded onto 53' equipment for Atlanta, Florida and the Carolinas. That's standard van/reefer work at port-driven volume.",
      ],
      [
        "What specialized Georgia freight should I know about?",
        "Gainesville poultry (year-round reefer), Dalton flooring (heavy van/flatbed), Southeast produce in season, and automotive flows around the West Point Kia corridor. Each has quirks — we match them to your equipment and preferences.",
      ],
      [
        "How does Georgia pair with Florida?",
        "Perfectly, if sequenced right: strong Atlanta outbound into Florida's inbound premium, then a port or produce reload north. That triangle is a staple of our Southeast planning.",
      ],
    ],
    blurb:
      "Georgia dispatch built on the Southeast's strongest market: Atlanta hub rotation, Savannah port-adjacent freight, poultry and flooring lanes — flat 5% per load, no forced dispatch.",
  },

  texas: {
    slug: "texas",
    code: "ST-05",
    name: "Texas Truck Dispatch",
    stateName: "Texas",
    abbr: "TX",
    metaTitle:
      "Texas Truck Dispatch Service — Triangle Lanes, Border Freight & Energy Loads | PickLoads",
    metaDescription:
      "Dispatch for Texas carriers: Dallas–Houston–San Antonio triangle, Laredo border freight, Houston port and energy-sector flatbed. Intrastate and interstate planning at a flat 5%.",
    heroLead:
      "Texas is a freight country of its own: more truck freight originates here than in any other state, the busiest land port in the hemisphere sits on its border, and the triangle between Dallas, Houston and San Antonio moves more loads in a day than some states see in a week. Scale cuts both ways — the boards are deep, and so are the traps.",
    introHeading: "A whole country's worth of freight in one state.",
    intro: [
      "Start with the triangle. Dallas–Fort Worth, Houston and San Antonio/Austin anchor an intrastate market so large that many Texas carriers build entire weeks inside it: DFW's massive distribution and intermodal complex (including Alliance and the inland ports), Houston's port-driven import volume and petrochemical belt, and the I-35 growth corridor between San Antonio and Austin. Triangle legs are short enough to double up in a day when appointments cooperate — the RPM math works differently, and we dispatch it accordingly, valuing loads per day rather than per mile alone.",
      "Then the border. Laredo is the #1 trade gateway in the western hemisphere, and cross-border freight works on a relay: Mexican carriers drayage trailers across, US trucks pick up at Laredo yards and run north to Dallas, San Antonio, Houston and beyond. Add El Paso's maquiladora traffic and the Rio Grande Valley's winter produce out of Pharr–McAllen, and border-savvy carriers have year-round volume. The paperwork and the yard procedures scare off casual competition, which is precisely why the lanes pay.",
      "Energy and project freight round out the picture: Permian Basin oilfield work keeps flatbeds, step-decks and hot-shots busy out of Midland–Odessa when drilling runs hot, Houston's fabrication yards ship steel and equipment nationwide, and wind-energy components move constantly across the plains. Distances are the discipline here — West Texas deadhead can devour a good rate, so we plan fuel, reloads and the way home before you commit. One more Texas nuance: purely intrastate operation requires TxDMV intrastate authority rather than just federal MC — we'll flag which side your freight plan actually needs.",
    ],
    ratesNote:
      "// Typical 2026 spot ranges: triangle van $2.00–$2.40/mi (short legs, value the day), Laredo→DFW $2.20–$2.70, RGV produce reefer $2.50–$3.10 in season, oilfield flatbed day-rates negotiated per project. Estimates, not promises.",
    lanesTitle: "Typical TX flow — triangle + border rotation",
    lanes: [
      { label: "LAREDO TX", hot: true },
      { label: "SAN ANTONIO TX" },
      { label: "DALLAS–FT WORTH" },
      { label: "HOUSTON TX" },
      { label: "BACK TO LAREDO", hot: true },
    ],
    requirementsHeading: "Running Texas with us",
    requirements: [
      "Active MC/DOT authority (interstate) — or TxDMV intrastate authority for TX-only operation",
      "$1M auto liability / $100K cargo insurance",
      "TxTag/EZ TAG/TollTag for metro toll roads (DFW and Houston use them heavily)",
      "Border work: broker/yard check-in procedures — we walk you through them",
      "Flatbed energy work: securement gear rated for steel and equipment",
      "W-9 and voided check or factoring NOA",
    ],
    faq: [
      [
        "Can you keep a truck busy inside Texas only?",
        "Yes — the triangle plus Laredo is a complete business model, and some of our carriers never cross a state line. Note that TX-only operation runs under TxDMV intrastate authority; we'll help you confirm which registration your plan requires.",
      ],
      [
        "Is Laredo border freight worth learning?",
        "It's some of the steadiest volume in the country, northbound and southbound. The learning curve is yard procedures and paperwork, not driving skill. After your first few pulls it's routine — and the lanes pay for the expertise.",
      ],
      [
        "How do you handle oilfield and energy freight?",
        "Selectively. When drilling activity is hot, Permian flatbed and hot-shot rates are excellent; when it cools, we don't leave you stranded in Odessa. Energy freight is a component of a Texas plan, not the whole plan.",
      ],
      [
        "Short triangle loads kill my RPM. Why book them?",
        "Because revenue-per-day beats revenue-per-mile. Two 250-mile triangle legs at $2.20 out-earn one 500-mile leg at $2.40 with less fuel burned waiting. We show you the day math on every multi-load plan.",
      ],
    ],
    blurb:
      "Texas dispatch at Texas scale: triangle rotation valued per day, Laredo border lanes, Houston port and energy-sector freight, with intrastate-authority guidance. Flat 5% per load.",
  },

  illinois: {
    slug: "illinois",
    code: "ST-06",
    name: "Illinois Truck Dispatch",
    stateName: "Illinois",
    abbr: "IL",
    metaTitle:
      "Illinois Truck Dispatch Service — Chicago Intermodal, I-80 Corridor & Midwest Lanes | PickLoads",
    metaDescription:
      "Dispatch for Illinois carriers: Chicago's rail-intermodal capital, the Joliet/Elwood warehouse belt, I-80/I-55 lanes and winter-smart Midwest planning. Flat 5% per load.",
    heroLead:
      "Chicago is where America's freight changes trains — the only place six of the seven Class I railroads meet — and every container that comes off a train needs a truck. Add the I-80 warehouse belt and the Midwest manufacturing ring, and Illinois carriers sit on some of the most repeatable freight in the country.",
    introHeading: "The crossroads market, worked all four seasons.",
    intro: [
      "Freight geography made Chicago inevitable: the rail networks of the East and West Coasts meet here, and the intermodal yards at Joliet, Elwood, Cicero, Bedford Park and Harvey turn that meeting into millions of annual container lifts. Around them grew the I-80 corridor warehouse belt — CenterPoint's Joliet/Elwood inland port is among the largest logistics parks in North America — plus the food-industry cluster that still earns Chicago its candy-and-CPG reputation. For van and reefer operators, that means transload and distribution freight with genuine week-after-week repeatability.",
      "Working it well is a timing game. Intermodal-adjacent freight surges with train schedules; morning positioning near the right yard beats afternoon scrambling across the metro's legendary congestion. We plan Chicagoland days around yard queues, appointment windows and the Tri-State's tolls (I-PASS is non-negotiable), and we keep an eye on the container market — when import volumes swell, transload rates follow, and we push. Outbound, Chicago's board is deep in every direction: Ohio Valley manufacturing, Minneapolis and Wisconsin food lanes, St. Louis and Kansas City distribution, Detroit automotive.",
      "Then there's winter. December through March, Midwest freight keeps moving through lake-effect snow and negative wind chills — and rates improve as fair-weather capacity thins out. We dispatch winter honestly: chains, idle plans, realistic transit times and the judgment to sit out a storm rather than force a delivery. Carriers who run Illinois year-round with a dispatcher who respects the season build shipper relationships that summer-only trucks never see. Downstate, agricultural flows (grain products, food processing around Decatur and the corn belt) and the St. Louis metro's cross-river freight round out a market that rarely leaves a truck idle.",
    ],
    ratesNote:
      "// Typical 2026 spot ranges: Chicago outbound van $2.00–$2.50/mi (winter premiums +20–40¢), intermodal transloads $2.10–$2.60, reefer food lanes $2.40–$2.90. Estimates, not promises — container surges move the board and we watch them.",
    lanesTitle: "Typical IL flow — intermodal belt rotation",
    lanes: [
      { label: "JOLIET/ELWOOD IL", hot: true },
      { label: "CHICAGO METRO" },
      { label: "INDIANAPOLIS IN" },
      { label: "COLUMBUS OH" },
      { label: "MILWAUKEE WI" },
      { label: "BACK TO CHICAGO", hot: true },
    ],
    requirementsHeading: "Running Illinois with us",
    requirements: [
      "Active MC/DOT authority in good standing",
      "$1M auto liability / $100K cargo insurance",
      "I-PASS/E-ZPass transponder (Tri-State and metro tollways)",
      "Winter readiness: chains where required, cold-weather idle/fuel plan",
      "Intermodal-adjacent work: UIIA participation optional but opens container freight",
      "W-9 and voided check or factoring NOA",
    ],
    faq: [
      [
        "What makes Chicago freight 'repeatable'?",
        "Rail schedules. Intermodal containers arrive on timetables, transload warehouses work on rhythms, and the same freight needs trucks every week. Once we place you in that rotation, planning gets easier instead of harder.",
      ],
      [
        "Do I need intermodal experience to benefit from the rail hub?",
        "No. Full container drayage requires UIIA interchange agreements, but the transload economy around the yards — container freight re-loaded onto 53' trailers — is standard van work at intermodal volume. That's where most of our IL carriers earn.",
      ],
      [
        "Is winter dispatch really workable?",
        "It's often the best-paying season, precisely because capacity thins. We plan it with real transit times, weather monitoring and no hero runs — a load delivered a half-day late beats a truck in a ditch, and our brokers hear that from us, not from you.",
      ],
      [
        "Which outbound lanes work best from Chicagoland?",
        "The Ohio Valley (Indianapolis, Columbus, Cincinnati), Wisconsin/Minneapolis food lanes, St. Louis and Detroit all reload well. We rotate them based on the week's boards rather than forcing a fixed loop.",
      ],
    ],
    blurb:
      "Illinois dispatch centered on the Chicago intermodal engine: transload freight in the Joliet/Elwood belt, deep outbound boards, and winter-smart Midwest planning at a flat 5% per load.",
  },
};

export function getStateContent(slug: string): StateContent | null {
  return (STATE_CONTENT as Record<string, StateContent | undefined>)[slug] ?? null;
}
