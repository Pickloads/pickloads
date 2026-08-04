/**
 * Extracts the V4 prototype's translation dictionaries (T = plain strings,
 * RICH = HTML strings) into next-intl message catalogs.
 *
 * Keys are deterministic slugs of the English source string, so the V4
 * dictionary remains the single source of truth (audit U-08). Rich strings are
 * converted to next-intl tag syntax (<br> → <br></br>; inline style attrs
 * stripped — styling lives in components, not messages).
 *
 * Usage: node scripts/extract-i18n.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const html = readFileSync("reference/pickloadssitev4.html", "utf8");
const LOCALES = ["es", "fr", "ru", "ht"];

function grabObject(startMarker) {
  const start = html.indexOf(startMarker);
  if (start === -1) throw new Error(`marker not found: ${startMarker}`);
  const braceStart = html.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      depth--;
      if (depth === 0) return html.slice(braceStart, i + 1);
    }
  }
  throw new Error("unbalanced braces");
}

// The prototype defines: `var T = {...}` then two `Object.assign(T, {...})`
// blocks, plus `var RICH = {...}` — hunt them all down.
const dicts = [];
dicts.push(grabObject("var T ="));
let idx = 0;
while ((idx = html.indexOf("Object.assign(T,", idx)) !== -1) {
  dicts.push(grabObject(html.slice(idx, idx + 20)) ? grabObject2(idx) : "");
  idx += 10;
}
function grabObject2(from) {
  const braceStart = html.indexOf("{", from + "Object.assign(T,".length - 1);
  let depth = 0;
  for (let i = braceStart; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") {
      depth--;
      if (depth === 0) return html.slice(braceStart, i + 1);
    }
  }
  throw new Error("unbalanced");
}
let rich = {};
if (html.includes("var RICH")) {
  rich = Function(`"use strict"; return (${grabObject("var RICH =")})`)();
}

const flat = {};
for (const src of dicts) {
  if (!src) continue;
  const obj = Function(`"use strict"; return (${src})`)();
  Object.assign(flat, obj);
}

export function slugify(en) {
  return en
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56)
    .replace(/_+$/g, "") || "s";
}

function toRichSyntax(s) {
  return s
    .replace(/&nbsp;/g, "\u00a0")
    .replace(/&amp;/g, "&")
    .replace(/<br\s*\/?>/g, "<br></br>")
    .replace(/<b\s+style="[^"]*">/g, "<b>")
    .replace(/<em\s+style="[^"]*">/g, "<em>");
}

const catalogs = Object.fromEntries(["en", ...LOCALES].map((l) => [l, {}]));
const keyIndex = {};
const seen = new Set();

function addEntry(en, translations, isRich) {
  let key = slugify(en);
  while (seen.has(key) && keyIndex[key] !== en) key += "_x";
  seen.add(key);
  keyIndex[key] = en;
  catalogs.en[key] = isRich ? toRichSyntax(en) : en;
  for (const l of LOCALES) {
    const v = translations?.[l];
    catalogs[l][key] = v ? (isRich ? toRichSyntax(v) : v) : catalogs.en[key];
  }
}

for (const [en, tr] of Object.entries(flat)) addEntry(en, tr, false);

/*
 * M-42: supplemental strings — the most visible public copy on Phase 2/3
 * pages composed AFTER the V4 prototype froze (become-a-carrier,
 * start-your-trucking-company). es/fr are provided; ru/ht intentionally
 * fall back to English pending native review (addEntry copies English for
 * missing locales) — tracked as a content prerequisite in
 * docs/LAUNCH-RUNBOOK.md. Portal/admin strings stay English by design.
 */
const SUPPLEMENTAL = {
  "Four steps, about 10 minutes: your company info, your documents, a plain-English agreement and your own portal. A dispatcher calls you the same day.":
    {
      es: "Cuatro pasos, unos 10 minutos: los datos de tu empresa, tus documentos, un acuerdo en lenguaje claro y tu propio portal. Un dispatcher te llama el mismo día.",
      fr: "Quatre étapes, environ 10 minutes : les infos de votre entreprise, vos documents, un accord en langage clair et votre propre portail. Un dispatcher vous appelle le jour même.",
    },
  "Prefer a human? Call (908) 404-5373 and we'll complete onboarding with you over the phone.":
    {
      es: "¿Prefieres hablar con alguien? Llama al (908) 404-5373 y completamos tu registro por teléfono.",
      fr: "Vous préférez parler à quelqu'un ? Appelez le (908) 404-5373 et nous finaliserons votre inscription par téléphone.",
    },
  "Your launch checklist": {
    es: "Tu checklist de lanzamiento",
    fr: "Votre checklist de lancement",
  },
  "From paperwork to first load.": {
    es: "Del papeleo a la primera carga.",
    fr: "De la paperasse au premier chargement.",
  },
  "Form the company": {
    es: "Constituye la empresa",
    fr: "Créez la société",
  },
  "File your authority": {
    es: "Presenta tu autoridad",
    fr: "Déposez votre autorité MC",
  },
  "Get insured": {
    es: "Consigue tu seguro",
    fr: "Obtenez votre assurance",
  },
  "Activate & dispatch": {
    es: "Activación y dispatch",
    fr: "Activation et dispatch",
  },
  "Before you start": {
    es: "Antes de empezar",
    fr: "Avant de commencer",
  },
  "Straight talk:": {
    es: "Hablando claro:",
    fr: "Parlons franchement :",
  },
  /* ---- M-51: /portal selection page + header/footer auth entries ---- */
  "Portal": {
    es: "Portal",
    fr: "Portail",
  },
  "Login": {
    es: "Iniciar sesión",
    fr: "Connexion",
  },
  "Support": {
    es: "Soporte",
    fr: "Support",
  },
  "Choose your portal": {
    es: "Elige tu portal",
    fr: "Choisissez votre portail",
  },
  "Carriers and shippers each have their own workspace — pick yours to sign in or create an account.":
    {
      es: "Carriers y shippers tienen cada uno su propio espacio de trabajo — elige el tuyo para iniciar sesión o crear una cuenta.",
      fr: "Transporteurs et expéditeurs ont chacun leur propre espace — choisissez le vôtre pour vous connecter ou créer un compte.",
    },
  "Carrier Portal": {
    es: "Portal del Carrier",
    fr: "Portail Transporteur",
  },
  "Shipper Portal": {
    es: "Portal del Shipper",
    fr: "Portail Expéditeur",
  },
  "Your dispatch back office: document review, agreement status and your loads — in one place.":
    {
      es: "Tu back office de dispatch: revisión de documentos, estado del acuerdo y tus cargas — todo en un solo lugar.",
      fr: "Votre back-office dispatch : vérification des documents, statut de l'accord et vos chargements — au même endroit.",
    },
  "Track document review and insurance status": {
    es: "Sigue la revisión de documentos y el estado del seguro",
    fr: "Suivez la vérification des documents et le statut d'assurance",
  },
  "See your dispatch agreement status": {
    es: "Consulta el estado de tu acuerdo de dispatch",
    fr: "Consultez le statut de votre accord de dispatch",
  },
  "Follow your loads and dispatch fees": {
    es: "Sigue tus cargas y tarifas de dispatch",
    fr: "Suivez vos chargements et frais de dispatch",
  },
  "Upload replacement documents any time": {
    es: "Sube documentos de reemplazo cuando quieras",
    fr: "Téléversez des documents de remplacement à tout moment",
  },
  "Carrier Sign In →": {
    es: "Iniciar sesión — Carrier →",
    fr: "Connexion transporteur →",
  },
  "New to PickLoads? Become a carrier →": {
    es: "¿Nuevo en PickLoads? Hazte carrier →",
    fr: "Nouveau chez PickLoads ? Devenez transporteur →",
  },
  "Request quotes and coordinate freight with vetted carriers — and follow every request in one place.":
    {
      es: "Solicita cotizaciones y coordina tu carga con carriers verificados — y sigue cada solicitud en un solo lugar.",
      fr: "Demandez des devis et coordonnez votre fret avec des transporteurs vérifiés — et suivez chaque demande au même endroit.",
    },
  "Track your quote requests and statuses": {
    es: "Sigue tus solicitudes de cotización y sus estados",
    fr: "Suivez vos demandes de devis et leurs statuts",
  },
  "See quoted rates as they come in": {
    es: "Mira las tarifas cotizadas en cuanto llegan",
    fr: "Consultez les tarifs proposés dès leur arrivée",
  },
  "Request new quotes in minutes": {
    es: "Solicita nuevas cotizaciones en minutos",
    fr: "Demandez de nouveaux devis en quelques minutes",
  },
  "Talk to a dispatcher about any shipment": {
    es: "Habla con un dispatcher sobre cualquier envío",
    fr: "Parlez à un dispatcher de n'importe quelle expédition",
  },
  "Shipper Sign In →": {
    es: "Iniciar sesión — Shipper →",
    fr: "Connexion expéditeur →",
  },
  "New here? Request your first quote →": {
    es: "¿Primera vez? Solicita tu primera cotización →",
    fr: "Nouveau ici ? Demandez votre premier devis →",
  },
  "PickLoads staff sign in through the same door — your account's role routes you to the right desk.":
    {
      es: "El equipo de PickLoads inicia sesión por la misma puerta — el rol de tu cuenta te lleva al escritorio correcto.",
      fr: "L'équipe PickLoads se connecte par la même porte — le rôle de votre compte vous dirige vers le bon espace.",
    },
};
for (const [en, tr] of Object.entries(SUPPLEMENTAL)) addEntry(en, tr, false);
// RICH entries are keyed by data-i18n id (hero.title etc.) with per-locale HTML;
// English source is the element's innerHTML — we keep the id-based key.
const RICH_EN = {
  "hero.title": "Your truck stays <em>loaded</em>.<br>We handle everything else.",
  "hero.note": "<b>■ DISPATCH ACTIVE NOW</b> &nbsp;·&nbsp; Brokerage division launches with FMCSA MC authority & BMC-84 bond — in process.",
  "svc.d.p": "We act as your back office: finding freight, negotiating rates and handling the paperwork under <b>your</b> operating authority.",
  "boards.p": "<b>Your dispatcher works every major load source</b> — plus direct broker relationships built lane by lane.",
  "ab.p2": 'We started with a simple standard: <b>treat every truck like it\'s our own.</b> That means verifying the broker before booking, negotiating like the margin is ours, planning lanes around a driver\'s home time — and answering the phone at 2am when something goes wrong.',
  "ct.hours": "Mon–Fri 8am–6pm ET · Sat 9am–2pm ET<br>Dispatch support: 24/7, including holidays",
};
for (const [id, en] of Object.entries(RICH_EN)) {
  const key = "rich_" + id.replace(/\./g, "_");
  catalogs.en[key] = toRichSyntax(en);
  for (const l of LOCALES) {
    const v = rich[id]?.[l];
    catalogs[l][key] = v ? toRichSyntax(v) : catalogs.en[key];
  }
  keyIndex[key] = en;
}

mkdirSync("messages", { recursive: true });
for (const [l, cat] of Object.entries(catalogs)) {
  const sorted = Object.fromEntries(Object.entries(cat).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(`messages/${l}.json`, JSON.stringify({ v4: sorted }, null, 2) + "\n");
}
writeFileSync("messages/_key-index.json", JSON.stringify(keyIndex, null, 2) + "\n");
console.log(`extracted ${Object.keys(catalogs.en).length} strings × ${1 + LOCALES.length} locales`);
