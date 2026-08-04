/*
 * M-16 — Equipment page content (typed TS module, chosen over MDX: the
 * template needs structured fields (lanes, requirements, FAQ tuples) that a
 * typed object gives us for free, JSON-LD and the sitemap import from the
 * same source, and no MDX pipeline enters the bundle. See
 * docs/modules/M-16-equipment-pages.md.
 *
 * Content is original English long-form (500–800 words/page) — the ×5-locale
 * translation is the O-03 content workstream (native RU/HT review pending,
 * arch §9). UI chrome (headings, CTA band) still translates via the V4 bridge.
 * Rates are typical 2026 spot-market ranges and are labeled as estimates.
 */

export const EQUIPMENT_SLUGS = [
  "dry-van",
  "reefer",
  "flatbed",
  "step-deck",
  "power-only",
  "hot-shot",
  "box-truck",
  "sprinter-van",
] as const;

export type EquipmentSlug = (typeof EQUIPMENT_SLUGS)[number];

export interface EquipmentLaneNode {
  label: string;
  hot?: boolean;
}

export interface EquipmentContent {
  slug: EquipmentSlug;
  code: string;
  /** Exact V4 card title — also the tv() key for the localized H1. */
  name: string;
  metaTitle: string;
  metaDescription: string;
  heroLead: string;
  introHeading: string;
  intro: string[];
  ratesNote: string;
  lanesTitle: string;
  lanes: EquipmentLaneNode[];
  requirementsHeading: string;
  requirements: string[];
  faq: ReadonlyArray<readonly [string, string]>;
  blurb: string;
}

export const EQUIPMENT_CONTENT: Record<EquipmentSlug, EquipmentContent> = {
  "dry-van": {
    slug: "dry-van",
    code: "EQ-01",
    name: "Dry Van Dispatch",
    metaTitle: "Dry Van Dispatch Service — 53' Van Loads & Lanes | PickLoads",
    metaDescription:
      "Dedicated dry van dispatch for owner-operators and small fleets. 53' van load booking, broker vetting, rate negotiation and paperwork — one flat 5% fee, no forced dispatch.",
    heroLead:
      "The 53' dry van is the backbone of American freight — and the most crowded lane on every load board. Winning with a van isn't about finding loads; it's about booking the right ones, back to back, with brokers who actually pay.",
    introHeading: "Booked back to back, not load to load.",
    intro: [
      "Dry van is the highest-volume segment in trucking: general freight, packaged food, paper, retail goods, e-commerce replenishment — anything palletized that doesn't need temperature control. That volume cuts both ways. There are more van loads posted than any other equipment type, but there are also more trucks chasing them, which is why undispatched van operators so often end up hauling cheap freight with 200-mile deadheads between loads.",
      "Our dispatchers work vans differently. We build a lane plan around your home base and home-time needs, then book round-trip economics — not one-way rates. A $2.60/mile load that strands you in a dead market is worse than a $2.20 load that puts you back inside a freight cluster. We check the reload market before we commit you to the first leg, and we verify every broker's authority, bond and credit score before you ever load.",
      "A standard 53' van gives you roughly 3,400 cubic feet, a 52'8\" x 98.5\" floor and around 45,000 lbs of legal payload — 26 standard pallets floor-loaded, up to 30 turned. Drop-and-hook, no-touch freight makes vans the most driver-friendly equipment in the industry: most of our van operators never break a seal. We push hard for no-touch and drop-and-hook appointments when we negotiate, because your hours are worth more than a lumper receipt.",
    ],
    ratesNote:
      "// Typical 2026 spot ranges we're seeing for 53' vans: ~$2.00–$2.60/mi on strong lanes, dipping to $1.70s in soft outbound markets. Estimates, not promises — every lane is negotiated live.",
    lanesTitle: "Typical dry van flow — Northeast base",
    lanes: [
      { label: "NJ / NYC METRO", hot: true },
      { label: "ATLANTA GA" },
      { label: "CHARLOTTE NC" },
      { label: "CHICAGO IL" },
      { label: "COLUMBUS OH" },
      { label: "BACK HOME NJ", hot: true },
    ],
    requirementsHeading: "What you need to run vans with us",
    requirements: [
      "Active MC/DOT authority in good standing",
      "53' dry van trailer (48' workable, fewer loads)",
      "$1M auto liability / $100K cargo insurance",
      "W-9 and voided check or factoring NOA",
      "ELD-compliant tractor",
      "Load locks or straps for freight securement",
    ],
    faq: [
      [
        "How much does dry van dispatch cost?",
        "5% of gross per load for owner-operators, 4.5% for small fleets. No setup fee, no monthly minimum, and nothing on loads you decline. You see every rate confirmation before we book.",
      ],
      [
        "Can you keep a van loaded every week?",
        "Van freight is the deepest market in the country — the honest challenge isn't finding a load, it's finding the right one. We plan reloads before booking the outbound leg, so you're not sitting in a dead market waiting.",
      ],
      [
        "Do you book drop-and-hook freight?",
        "Wherever it exists, yes. Large shippers and trailer-pool brokers post drop-and-hook van freight daily; we prioritize it because it protects your clock and your back.",
      ],
      [
        "What if my van is a 48-footer?",
        "We can dispatch it — plenty of freight still fits — but roughly a quarter of postings specify 53'. Expect a somewhat thinner board and we'll plan lanes accordingly.",
      ],
    ],
    blurb:
      "Dedicated dispatch for 53' dry van owner-operators: lane planning, broker vetting, rate negotiation and full paperwork support at a flat 5% per load.",
  },

  reefer: {
    slug: "reefer",
    code: "EQ-02",
    name: "Reefer Dispatch",
    metaTitle: "Reefer Dispatch Service — Refrigerated Loads & Lanes | PickLoads",
    metaDescription:
      "Refrigerated dispatch for owner-operators: produce, food and pharma loads, temp-protocol discipline, broker vetting and round-trip lane planning. Flat 5% per load.",
    heroLead:
      "Reefer freight pays more because it demands more: temperature protocols, pre-cools, pulp checks, strict appointment windows — and claims that can eat a month's profit if the paperwork is sloppy. Good dispatch is the difference.",
    introHeading: "Cold chain discipline, load after load.",
    intro: [
      "Refrigerated freight consistently outpays dry van because the shipper is buying reliability, not just a trailer. Produce out of Florida, Georgia and the Carolinas, frozen food from Midwest cold-storage hubs, dairy, meat and pharma-adjacent loads — a well-run reefer rarely has an empty calendar, and unlike vans, a reefer can also haul dry freight when the temp market cools, which effectively doubles your board.",
      "The discipline is in the details, and it's exactly what our dispatchers manage load by load: verifying the temp on the rate con (continuous vs. cycle/start-stop matters and we get it in writing), confirming pre-cool before you drive to the shipper, reminding on pulp temps at loading, and documenting everything so a rejected pallet doesn't turn into a five-figure claim against your cargo policy. FSMA sanitary-transport rules make the paper trail mandatory, not optional — we keep it clean.",
      "A 53' reefer typically nets around 43,500 lbs of payload after the unit and insulation, with modern units holding setpoints from -20°F for deep-frozen to +65°F for candy and flowers. Produce season flips the map every year — South Florida and the Rio Grande Valley in winter and spring, Georgia and the Carolinas into summer — and we plan your lanes around those surges instead of letting you chase them a week late.",
    ],
    ratesNote:
      "// Typical 2026 spot ranges for 53' reefers: ~$2.40–$3.00/mi on produce-season lanes, ~$2.10–$2.50 off-peak. In-season Florida outbound spikes higher. Estimates — negotiated per load.",
    lanesTitle: "Typical reefer rotation — East Coast produce",
    lanes: [
      { label: "NJ COLD STORAGE", hot: true },
      { label: "MIAMI / S. FLORIDA" },
      { label: "PRODUCE RELOAD", hot: true },
      { label: "ATLANTA GA" },
      { label: "PHILLY / NEWARK MARKETS" },
      { label: "BACK HOME NJ", hot: true },
    ],
    requirementsHeading: "What you need to run reefer with us",
    requirements: [
      "Active MC/DOT authority in good standing",
      "53' reefer with working unit + current annual inspection",
      "$1M auto liability / $100K cargo incl. reefer breakdown coverage",
      "Calibrated temp recorder / unit download capability",
      "W-9 and voided check or factoring NOA",
      "Willingness to run FSMA-compliant washouts between loads",
    ],
    faq: [
      [
        "Does reefer breakdown insurance matter?",
        "Yes — many brokers won't load you without it, and a unit failure on a $60K protein load without breakdown coverage is a business-ending event. We'll flag it during onboarding if your cargo policy excludes it.",
      ],
      [
        "Continuous or cycle — who decides?",
        "The shipper's temp protocol on the rate con decides, and we make sure it's written there before you load. Running cycle on a continuous-required produce load is the fastest route to a rejected load.",
      ],
      [
        "Can I haul dry freight in my reefer?",
        "Absolutely, and we do it deliberately in soft temp markets — a reefer is a premium dry van when the produce board thins out. It keeps your revenue floor higher than a van operator's.",
      ],
      [
        "How do you handle produce-season planning?",
        "We follow the harvest calendar — Florida and Texas winter/spring, Southeast summer — and position your reloads into surge markets a week ahead of the rate spike, not behind it.",
      ],
    ],
    blurb:
      "Refrigerated dispatch with temp-protocol discipline: produce, food and pharma lanes, reefer-specific paperwork and claims prevention at a flat 5% per load.",
  },

  flatbed: {
    slug: "flatbed",
    code: "EQ-03",
    name: "Flatbed Dispatch",
    metaTitle: "Flatbed Dispatch Service — Steel, Lumber & Machinery | PickLoads",
    metaDescription:
      "Flatbed dispatch for owner-operators: steel, lumber and machinery loads, securement-aware booking, tarp pay negotiated up front. Flat 5% per load, no forced dispatch.",
    heroLead:
      "Flatbed pays a premium for skill — securement, tarping, oversize awareness — and punishes carelessness the same way. We book freight that respects both your rate floor and Chapter 393 reality.",
    introHeading: "Open deck freight, booked by people who know securement.",
    intro: [
      "Flatbed is construction and industry on wheels: steel coil and beam, lumber packages, drywall, machinery, pipe, pre-cast concrete. Demand tracks building season, which means strong spring-through-fall boards out of mill towns and ports, and it consistently prices above dry van because fewer drivers can do the work properly. If you have the securement skills, flatbed is one of the best margins in open-deck freight.",
      "Our dispatchers book flatbed like flatbed — not like a van with no roof. Before we commit you, we confirm what the load actually needs: number of straps or chains under FMCSA 393 working-load-limit math, coil racks for steel, edge protection, and whether the shipper loads with overhead crane or forklift. Tarp jobs get tarp pay negotiated on the rate con — typically $50–$150 depending on lumber vs. steel tarps — because free tarping is a rate cut you never agreed to.",
      "A standard 48' x 102\" flatbed runs about a 60\" deck height, leaving roughly 8'6\" of legal freight height and around 48,000 lbs of payload on a properly spec'd rig. Anything taller, wider than 8'6\", or heavier moves into permit territory — we'll book legal-max all day and only take you into oversize work if that's a lane you want, with permits priced into the rate.",
    ],
    ratesNote:
      "// Typical 2026 spot ranges for 48' flatbeds: ~$2.50–$3.10/mi in building season, ~$2.20–$2.60 winter. Tarp pay and detention negotiated separately on the rate con. Estimates only.",
    lanesTitle: "Typical flatbed flow — steel & building materials",
    lanes: [
      { label: "NJ / PHILLY PORTS", hot: true },
      { label: "PITTSBURGH STEEL" },
      { label: "OHIO VALLEY MILLS" },
      { label: "CAROLINAS CONSTRUCTION", hot: true },
      { label: "VA / MD REBAR" },
      { label: "BACK HOME NJ", hot: true },
    ],
    requirementsHeading: "What you need to run flatbed with us",
    requirements: [
      "Active MC/DOT authority in good standing",
      "48' or 53' flatbed (or conestoga — more freight, same board)",
      "$1M auto liability / $100K cargo insurance",
      "Chains, binders, straps and edge protection to 393 spec",
      "Lumber and steel tarps (or conestoga curtain)",
      "Coil racks if you want coil freight (it pays extra)",
    ],
    faq: [
      [
        "Do you negotiate tarp pay?",
        "Every time tarps come out. Tarp pay goes on the rate confirmation before booking — if a broker refuses to put it in writing, that tells us what the rest of the transaction will look like, and we move on.",
      ],
      [
        "Will you book me on oversize loads?",
        "Only if you want that work. Legal-max flatbed keeps you moving without permits; if you're set up for overwidth or overheight, we price permits, escorts and curfew time into the rate before accepting.",
      ],
      [
        "Is a conestoga worth it?",
        "It opens both boards — flatbed freight plus no-tarp premium loads that van freight can't touch (machinery that needs top loading). If you already own one, we'll work both markets for you.",
      ],
      [
        "What about coil loads?",
        "Steel coil pays a premium for a reason: it's unforgiving. We only book you on coil if you carry racks and know the securement, and we confirm the coil weight and eye direction on every rate con.",
      ],
    ],
    blurb:
      "Flatbed dispatch built around securement reality: steel, lumber and machinery lanes with tarp pay and detention negotiated up front. Flat 5% per load.",
  },

  "step-deck": {
    slug: "step-deck",
    code: "EQ-04",
    name: "Step Deck Dispatch",
    metaTitle: "Step Deck Dispatch — Over-Height Freight & Equipment | PickLoads",
    metaDescription:
      "Step deck dispatch for owner-operators: machinery and over-height freight up to 10', legal-max planning, permit-aware booking and ramp loads. Flat 5% per load.",
    heroLead:
      "A step deck is a flatbed with ten feet of legal height — which puts machinery, ag equipment and construction iron on your board that straight flatbeds have to pass on. We book the freight that uses that advantage.",
    introHeading: "Ten feet of legal height. A board flatbeds can't touch.",
    intro: [
      "Step decks (single-drops) exist for one reason: height. The lower deck sits around 36–40\" off the ground versus a flatbed's 60\", which turns the same 13'6\" legal ceiling into roughly 10' of usable freight height. That opens the loads flatbeds can't legally take — wheeled and tracked equipment, agricultural machinery, industrial tanks, HVAC units, crated machinery — a market with fewer competing trucks and consistently stronger rates than standard open deck.",
      "The typical 48' step runs an 10–11' upper deck over the kingpin and a 37' lower deck, with about 48,000 lbs of payload on a two-axle setup. Load planning matters more than on any dry freight: axle weights shift fast when a 30,000-lb excavator sits on the lower deck, and we talk through positioning with the shipper before you arrive, not at the scale. If your trailer carries ramps, self-propelled equipment becomes drive-on revenue — some of the best-paying repeatable freight in the segment.",
      "Our dispatchers treat the 10' line as the profit line. Legal-max step freight books fast and moves without permits; anything above goes into over-dimensional territory with permits, routing surveys and escort math. We'll run you legal all week by default, and if you want OD work we price every permit and curfew hour into the rate before you accept — never after.",
    ],
    ratesNote:
      "// Typical 2026 spot ranges for step decks: ~$2.70–$3.30/mi on machinery lanes, more with ramps or OD surcharges. Estimates — machinery freight is quoted load by load.",
    lanesTitle: "Typical step deck flow — equipment corridors",
    lanes: [
      { label: "NJ / PORT NEWARK", hot: true },
      { label: "PA EQUIPMENT AUCTIONS" },
      { label: "OHIO / INDIANA MFG" },
      { label: "SOUTHEAST DEALERS", hot: true },
      { label: "AG BELT RELOAD" },
      { label: "BACK HOME NJ", hot: true },
    ],
    requirementsHeading: "What you need to run step deck with us",
    requirements: [
      "Active MC/DOT authority in good standing",
      "48' or 53' step deck; ramps a strong plus",
      "$1M auto liability / $100K cargo insurance",
      "Chains, binders and straps rated for equipment work",
      "Height pole or measuring stick — verify before you pull",
      "Comfort loading/securing wheeled & tracked machinery",
    ],
    faq: [
      [
        "How tall can my freight legally be on a step?",
        "Rule of thumb: about 10' on the lower deck against a 13'6\" ceiling (11'6\" ceiling states like a few western routes change the math). We confirm actual deck height plus freight height on every load — a claimed 9'8\" machine that's really 10'4\" is your problem at the first bridge, so we make it the shipper's problem first.",
      ],
      [
        "Do I need ramps?",
        "Not required, but they change your board: drive-on/drive-off equipment loads often specify ramps and pay for the convenience. If you have them, we filter for that freight deliberately.",
      ],
      [
        "Will you book over-dimensional loads?",
        "Only with your sign-off and with permits, escorts and curfew time priced into the rate up front. OD pays well when it's quoted right and destroys weeks when it isn't — we quote it right or skip it.",
      ],
      [
        "Step deck vs. flatbed — is the premium real?",
        "Yes. Fewer trucks can take height freight, so postings sit longer and brokers pay up. Expect a meaningful premium over comparable flatbed lanes, more when ramps or OD capability are involved.",
      ],
    ],
    blurb:
      "Step deck dispatch for over-height and machinery freight: legal-max planning up to 10', permit-aware OD booking and ramp loads. Flat 5% per load.",
  },

  "power-only": {
    slug: "power-only",
    code: "EQ-05",
    name: "Power Only Dispatch",
    metaTitle: "Power Only Dispatch — Drop & Hook Trailer Pools | PickLoads",
    metaDescription:
      "Power-only dispatch for tractor owner-operators: drop-and-hook trailer-pool freight from major shippers and brokers, minimal deadhead, no trailer payment. Flat 5% per load.",
    heroLead:
      "No trailer? That's the business model, not the problem. Power-only freight — pulling shippers' and brokers' preloaded trailers — has become one of the fastest-growing segments in truckload, and it runs almost entirely drop-and-hook.",
    introHeading: "Your tractor. Their trailers. Zero wasted dock hours.",
    intro: [
      "Power only means you bring the tractor and the network brings the trailer: preloaded dry vans and occasionally reefers staged in trailer pools by large shippers, 3PLs and digital brokers. Since the pandemic reshaped retail logistics, the big networks have invested heavily in pool capacity, and they need reliable tractors to keep those trailers cycling. For an owner-operator, it removes a $700–$900/month trailer payment plus maintenance from your cost sheet entirely.",
      "The economics read differently than standard van work, and we're straight about it: the per-mile rate typically runs $0.20–$0.40 under comparable live-load van freight. What the rate line hides is that power-only runs are overwhelmingly drop-and-hook — you're not burning two hours at a dock on each end, detention disputes mostly disappear, and consistent round-trip tours are common. Measured in revenue per working hour rather than per mile, well-planned power only frequently beats the van board.",
      "The operational catch is trailer condition and interchange liability: pull a pool trailer with a bad tire or lights out, and the roadside inspection goes on your record. Our dispatchers confirm trailer interchange terms up front, make sure your insurance carries non-owned trailer coverage (usually $20K–$30K limits are specified), and we document trailer condition at hook with photos so damage claims land where they belong — not on you.",
    ],
    ratesNote:
      "// Typical 2026 power-only ranges: ~$1.80–$2.30/mi, offset by near-zero dock time and dense round-trip tours. Estimates — tour programs are priced as packages, not single loads.",
    lanesTitle: "Typical power-only tour — pool network",
    lanes: [
      { label: "NJ DISTRIBUTION HUB", hot: true },
      { label: "DROP / HOOK PA" },
      { label: "DROP / HOOK OH" },
      { label: "RETAIL DC LOOP", hot: true },
      { label: "DROP / HOOK MD" },
      { label: "BACK HOME NJ", hot: true },
    ],
    requirementsHeading: "What you need to run power only with us",
    requirements: [
      "Active MC/DOT authority in good standing",
      "Tractor with fifth wheel in good order (no trailer needed)",
      "$1M auto liability / $100K cargo insurance",
      "Non-owned / trailer interchange coverage (~$20–30K)",
      "ELD-compliant tractor",
      "Discipline on hook/drop condition photos (we'll show you our checklist)",
    ],
    faq: [
      [
        "Why would I take a lower per-mile rate?",
        "Because you're paid to drive, not to wait. Drop-and-hook tours eliminate most dock hours and detention fights, and removing trailer ownership costs changes your break-even math. We'll run your numbers both ways during onboarding.",
      ],
      [
        "Whose insurance covers the trailer?",
        "Interchange terms decide, which is why we confirm them before booking and why non-owned trailer coverage is on our requirements list. Never assume the pool owner covers damage while it's hooked to you.",
      ],
      [
        "What happens if the pool trailer is a wreck?",
        "You refuse it — and we back you. Photos at hook, a call to the broker, swap or repower. A DOT out-of-service on someone else's trailer still lands on your CSA score, so condition discipline is non-negotiable.",
      ],
      [
        "Is power-only freight steady enough to live on?",
        "The pool networks run year-round and prize dependable tractors — reliability gets you into recurring tours. It's arguably the most schedule-stable segment we dispatch.",
      ],
    ],
    blurb:
      "Power-only dispatch: drop-and-hook trailer-pool freight from major networks, interchange terms verified, condition documented. Flat 5% per load, no trailer required.",
  },

  "hot-shot": {
    slug: "hot-shot",
    code: "EQ-06",
    name: "Hot Shot Dispatch",
    metaTitle: "Hot Shot Dispatch — Expedited 40' Gooseneck Loads | PickLoads",
    metaDescription:
      "Hot shot dispatch for dually + gooseneck operators: expedited partials, equipment and oilfield-style freight, LTL-flatbed premiums, deadhead-aware planning. 8% per load.",
    heroLead:
      "Hot shot is the expedited end of open deck: a dually and a 40' gooseneck moving urgent partials that can't wait for a full flatbed to fill. Speed is the product — and the rate reflects it when the dispatch is right.",
    introHeading: "Stacked partials, expedited premiums, managed deadhead.",
    intro: [
      "The classic hot shot rig — a 1-ton dually (F-350/450, Ram 3500-class) pulling a 40' gooseneck — exists to move freight that is too urgent, too small or too awkward for the full-size flatbed market: a skid steer a contractor needs tomorrow, two pallets of oilfield fittings, a replacement industrial motor that's holding up a production line. Shippers pay expedited premiums for exactly one thing: the load leaves now.",
      "The economics are unforgiving about deadhead and partial-fill, which is where dispatch earns its keep. A 40' deck with roughly 16,000–17,000 lbs of realistic payload wants to be stacked with two or three compatible partials moving the same direction — that's how hot shot operators post strong weeks while solo-load operators starve. We hunt LTL-flatbed combinations aggressively and plan your next partial before the current one delivers.",
      "Know your regulatory line: most 40' gooseneck combinations behind a 1-ton put the GCWR over 26,001 lbs, which means a CDL, a USDOT medical card and full ELD compliance — 'non-CDL hot shot' only genuinely works on smaller trailer setups, and we dispatch to what your credentials actually allow. Our fee for hot shot is 8% per load, reflecting the higher booking volume of partial freight; you still approve every load, and there's still no charge on loads you decline.",
    ],
    ratesNote:
      "// Typical 2026 hot shot ranges: ~$1.60–$2.20/mi all-miles on stacked partials; single urgent loads can print $2.50+ short-haul. Fuel burn on a dually changes the math — we plan net, not gross.",
    lanesTitle: "Typical hot shot flow — expedited partials",
    lanes: [
      { label: "NJ / NY URGENT", hot: true },
      { label: "PARTIAL #1 PA" },
      { label: "PARTIAL #2 VA", hot: true },
      { label: "CAROLINAS DROP" },
      { label: "RELOAD PARTIAL" },
      { label: "BACK HOME NJ", hot: true },
    ],
    requirementsHeading: "What you need to run hot shot with us",
    requirements: [
      "Active MC/DOT authority in good standing",
      "1-ton dually + 35–40' gooseneck (air ride preferred)",
      "CDL-A if combination GCWR exceeds 26,001 lbs (most 40' setups do)",
      "$1M auto liability / $100K cargo insurance",
      "Straps, chains and securement for equipment partials",
      "ELD compliance (personal-conveyance rules understood)",
    ],
    faq: [
      [
        "Why is the hot shot fee 8% instead of 5%?",
        "Volume of work per revenue dollar. Stacking two or three partials per deck means multiple bookings, negotiations and paperwork sets per trip — the fee matches the FAQ-published tier for box trucks and hot shots. You still approve every load.",
      ],
      [
        "Do I really need a CDL for hot shot?",
        "If your truck-plus-loaded-trailer rating crosses 26,001 lbs GCWR — and a 1-ton with a 40' gooseneck almost always does — yes. We verify your setup during onboarding and only dispatch inside your legal envelope.",
      ],
      [
        "Can you actually keep a hot shot busy outside oil country?",
        "Yes — the Northeast corridor runs on urgent construction equipment, industrial parts and machinery partials. It's a different mix than Permian oilfield work, but the expedited premium is the same product.",
      ],
      [
        "How do partials get priced?",
        "Per load, stacked. Three compatible partials at $500–$900 each on one 800-mile run routinely out-earn one full-deck load — the skill is compatibility (weights, dimensions, sequence), and that's our job.",
      ],
    ],
    blurb:
      "Hot shot dispatch for dually + gooseneck rigs: expedited partials stacked for revenue, CDL-envelope aware, deadhead-managed. 8% per load, approve every booking.",
  },

  "box-truck": {
    slug: "box-truck",
    code: "EQ-07",
    name: "Box Truck Dispatch",
    metaTitle: "Box Truck Dispatch — 26' Straight Truck Loads | PickLoads",
    metaDescription:
      "26' box truck dispatch: expedited partials, final-mile and dock-height freight, liftgate loads, broker vetting for a thin market. 8% per load, no forced dispatch.",
    heroLead:
      "The 26-footer lives in the gap between parcel and truckload — expedited partials, store deliveries, trade-show freight and anything that needs a liftgate where no dock exists. Thin board, real niches: dispatch quality decides everything.",
    introHeading: "Freight that pays for the service, not just the space.",
    intro: [
      "Box truck freight is the most misunderstood market we dispatch. The load boards look full until you filter honestly: a large share of 'box truck' postings are underpriced van partials fishing for desperate capacity. The real 26' market is narrower and better — expedited partials that can't wait for an LTL network, final-mile retail and residential deliveries needing a liftgate, trade-show and event freight with hard install windows, and recurring store-replenishment routes.",
      "A 26' straight truck at 26,000 lbs GVWR — the non-CDL ceiling — realistically nets around 9,000–10,000 lbs of payload and 12 standard pallets ahead of typical body and liftgate weight. That non-CDL accessibility is why the segment is crowded at the bottom and why brokers try $1.10/mile fishing rates. Our job is refusing that freight and building your week from the loads that price the service, not the space: liftgate deliveries, inside/white-glove work, time-critical partials.",
      "Because margins are structurally tighter than tractor-trailer work, broker vetting matters even more — a single 45-day no-pay on a $1,800 load is a week's profit. Every broker gets authority, bond and credit checked before booking, same as our semi freight, and we push detention and extra-stop pay onto the rate con up front. Our fee for box trucks is 8% per load, the published tier for this equipment class, with no charge on loads you decline.",
    ],
    ratesNote:
      "// Typical 2026 box truck ranges: ~$1.30–$1.90/mi on legitimate expedited/final-mile freight; recurring dedicated routes quoted as weekly packages. Ignore the $1.10 fishing posts — we do.",
    lanesTitle: "Typical box truck week — metro + regional",
    lanes: [
      { label: "NJ METRO BASE", hot: true },
      { label: "FINAL-MILE ROUTE AM" },
      { label: "EXPEDITED PARTIAL PA", hot: true },
      { label: "STORE DELIVERIES" },
      { label: "TRADE SHOW / EVENT" },
      { label: "BACK HOME NIGHTLY", hot: true },
    ],
    requirementsHeading: "What you need to run a box truck with us",
    requirements: [
      "Active MC/DOT authority in good standing",
      "24–26' box, dock height strongly preferred",
      "Liftgate + pallet jack (they unlock the best-paying work)",
      "$1M auto liability / $100K cargo insurance",
      "E-track or straps for load securement",
      "ELD if your vehicle/operation requires it — we'll confirm at onboarding",
    ],
    faq: [
      [
        "Can a box truck really stay busy on load boards alone?",
        "Not well — that's the honest answer, and it's why our box truck program leans on expedited partials, liftgate/final-mile work and recurring routes rather than board-scraping. Expect a build-up period while we establish your repeat freight.",
      ],
      [
        "Why is the fee 8% for box trucks?",
        "Same reason as hot shot: more bookings and coordination per revenue dollar, per our published tier structure. Multi-stop final-mile days involve real dispatch labor. You approve every load; declines cost nothing.",
      ],
      [
        "Do I need a liftgate?",
        "Need — no; want — absolutely. Liftgate plus pallet jack is the difference between competing for the cheapest partials and qualifying for residential, storefront and inside-delivery freight that prices the service.",
      ],
      [
        "Is my box truck non-CDL?",
        "At 26,000 lbs GVWR or below, yes, no CDL required — which is exactly why the segment is crowded. Watch your actual payload though: overweight tickets at 26K GVWR come fast with 12 dense pallets.",
      ],
    ],
    blurb:
      "26' box truck dispatch focused on freight that pays the service: expedited partials, liftgate final-mile and recurring routes, with full broker vetting. 8% per load.",
  },

  "sprinter-van": {
    slug: "sprinter-van",
    code: "EQ-08",
    name: "Sprinter Van Dispatch",
    metaTitle: "Sprinter Van Dispatch — Expedited Cargo Van Loads | PickLoads",
    metaDescription:
      "Cargo van dispatch for expedited freight: 2–3 pallet urgent loads, medical and automotive runs, direct-drive service, deadhead-managed. 5% per load.",
    heroLead:
      "Sprinter freight is pure speed: two or three pallets that must be somewhere today, driven straight through, no terminal, no cross-dock. It's the smallest equipment we dispatch and the most service-intensive market there is.",
    introHeading: "Loads covered in minutes. Returns planned before delivery.",
    intro: [
      "The expedited cargo van market exists because supply chains break daily in small, urgent ways: a production line down for a $900 part, surgical kits needed for tomorrow's first case, an automotive plant sequencing failure, aircraft-on-ground components. Freight forwarders and expedite brokers pay direct-drive rates for a van that leaves within the hour and drives through — that immediacy is the entire product, and it's why sprinter work behaves nothing like the truckload board.",
      "A typical 170\"-wheelbase high-roof cargo van hauls up to three standard pallets and roughly 3,000–3,500 lbs, fits anywhere a car fits, and — critically for expedite — under current federal rules a van at 10,000 lbs GVWR or less operating as interstate for-hire still means operating authority, insurance and marked compliance, which most casual competitors never complete. Having your paperwork genuinely in order is a competitive weapon in this segment, and it's the first thing we verify.",
      "Dispatch discipline in expedite is about position and response time. Loads post and cover in minutes, so we pre-position you near freight-dense zones — Northeast pharma corridors, airport cargo complexes, automotive tiers — and answer postings in seconds, not minutes. Deadhead discipline decides profitability: a 400-mile empty return kills a great outbound rate, so we work reload partners and forwarder relationships to cover the way back before you deliver. Team setups unlock the long-haul end of the market, where round-the-clock driving pays a visible premium.",
    ],
    ratesNote:
      "// Typical 2026 cargo-van ranges: ~$0.95–$1.40/mi solo, $1.50+ team and medical-priority runs; short urgent hops often flat-rated well above per-mile math. Estimates — expedite is quoted per event.",
    lanesTitle: "Typical sprinter pattern — expedite network",
    lanes: [
      { label: "NJ PHARMA CORRIDOR", hot: true },
      { label: "AIRPORT CARGO EWR/JFK" },
      { label: "DIRECT DRIVE OH/MI", hot: true },
      { label: "AUTOMOTIVE TIER STOP" },
      { label: "RELOAD VIA FORWARDER" },
      { label: "BACK HOME NJ", hot: true },
    ],
    requirementsHeading: "What you need to run a sprinter with us",
    requirements: [
      "Operating authority & insurance appropriate to for-hire interstate work",
      "High-roof cargo van, 2–3 pallet capacity (170\" WB ideal)",
      "Cargo insurance per broker programs (typically $25–100K)",
      "E-track, straps and blankets; pallet jack a plus",
      "Smartphone + tracking app comfort (expedite runs on location pings)",
      "Willingness for on-call windows — speed is the product",
    ],
    faq: [
      [
        "How fast do I need to respond to load offers?",
        "Minutes matter — expedite loads routinely cover within 5–10 minutes of posting. That's precisely what you're hiring us for: we sit on the boards and broker channels so you can drive while we answer in seconds.",
      ],
      [
        "Is medical courier work part of this?",
        "Yes — medical and pharma runs are a core Northeast van market and often the best-paying. Some programs require TSA/STA clearances, OSHA bloodborne-pathogen awareness or validated temp packaging; we'll tell you which credentials unlock which freight.",
      ],
      [
        "Solo or team — does it change the board?",
        "Dramatically. Solo work is regional day-runs; a team van legally drives round-the-clock and qualifies for coast-to-coast direct drives at premium rates. If you have a co-driver, tell us at onboarding — it's a different lane plan.",
      ],
      [
        "What does dispatch cost for a sprinter?",
        "5% of gross per load — the standard owner-operator tier. No monthly minimum, and on-call windows where nothing books cost you nothing.",
      ],
    ],
    blurb:
      "Expedited cargo van dispatch: 2–3 pallet urgent freight, medical and automotive expedite, second-fast load response and deadhead-managed returns. 5% per load.",
  },
};

export function getEquipmentContent(slug: string): EquipmentContent | null {
  for (const s of EQUIPMENT_SLUGS) {
    if (s === slug) return EQUIPMENT_CONTENT[s];
  }
  return null;
}
