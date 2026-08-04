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
  /* ---- M-52: /create-account chooser + carrier registration ---- */
  "Get started with PickLoads": {
    es: "Empieza con PickLoads",
    fr: "Commencez avec PickLoads",
  },
  "Pick the account that matches how you move freight — it takes about two minutes.":
    {
      es: "Elige la cuenta que corresponde a cómo mueves tu carga — toma unos dos minutos.",
      fr: "Choisissez le compte qui correspond à votre façon de transporter le fret — environ deux minutes.",
    },
  "Carrier Account": {
    es: "Cuenta de Carrier",
    fr: "Compte Transporteur",
  },
  "Shipper Account": {
    es: "Cuenta de Shipper",
    fr: "Compte Expéditeur",
  },
  "I run trucks": {
    es: "Tengo camiones",
    fr: "J'ai des camions",
  },
  "I ship freight": {
    es: "Envío carga",
    fr: "J'expédie du fret",
  },
  "Owner-operators and small fleets — with authority active, pending, or not started yet. We route you to the right next step.":
    {
      es: "Owner-operators y flotas pequeñas — con autoridad activa, pendiente o sin empezar. Te llevamos al siguiente paso correcto.",
      fr: "Owner-operators et petites flottes — autorité active, en attente ou pas encore lancée. Nous vous guidons vers la bonne étape.",
    },
  "Authority active? Straight to onboarding.": {
    es: "¿Autoridad activa? Directo al onboarding.",
    fr: "Autorité active ? Directement à l'onboarding.",
  },
  "Application pending? We track it with you.": {
    es: "¿Solicitud pendiente? La seguimos contigo.",
    fr: "Demande en attente ? Nous la suivons avec vous.",
  },
  "No authority yet? We help you launch.": {
    es: "¿Sin autoridad todavía? Te ayudamos a lanzarte.",
    fr: "Pas encore d'autorité ? Nous vous aidons à démarrer.",
  },
  "Create Carrier Account →": {
    es: "Crear cuenta de Carrier →",
    fr: "Créer un compte transporteur →",
  },
  "Create Shipper Account →": {
    es: "Crear cuenta de Shipper →",
    fr: "Créer un compte expéditeur →",
  },
  "Already have an account? Sign in →": {
    es: "¿Ya tienes cuenta? Inicia sesión →",
    fr: "Vous avez déjà un compte ? Connectez-vous →",
  },
  "Get quotes and coordinate freight with vetted carriers — track every request and rate in your own portal.":
    {
      es: "Solicita cotizaciones y coordina tu carga con carriers verificados — sigue cada solicitud y tarifa en tu propio portal.",
      fr: "Demandez des devis et coordonnez votre fret avec des transporteurs vérifiés — suivez chaque demande et tarif dans votre portail.",
    },
  "A dispatcher calls back within one business hour": {
    es: "Un dispatcher te devuelve la llamada en una hora hábil",
    fr: "Un dispatcher vous rappelle dans l'heure ouvrée",
  },
  "Shipper accounts are invite-only right now. Request a quote and we'll set you up personally.":
    {
      es: "Las cuentas de shipper son solo por invitación por ahora. Solicita una cotización y te configuramos personalmente.",
      fr: "Les comptes expéditeur sont sur invitation pour le moment. Demandez un devis et nous vous installons personnellement.",
    },
  "Prefer a human? Call (908) 404-5373 and we'll set your account up over the phone.":
    {
      es: "¿Prefieres hablar con alguien? Llama al (908) 404-5373 y configuramos tu cuenta por teléfono.",
      fr: "Vous préférez parler à quelqu'un ? Appelez le (908) 404-5373 et nous créerons votre compte par téléphone.",
    },
  "Create your carrier account": {
    es: "Crea tu cuenta de carrier",
    fr: "Créez votre compte transporteur",
  },
  "Tell us where your authority stands and we'll route you to the right next step — onboarding, tracking, or launch help.":
    {
      es: "Cuéntanos cómo va tu autoridad y te llevamos al siguiente paso correcto — onboarding, seguimiento o ayuda de lanzamiento.",
      fr: "Dites-nous où en est votre autorité et nous vous guidons vers la bonne étape — onboarding, suivi ou aide au lancement.",
    },
  "Your carrier account": {
    es: "Tu cuenta de carrier",
    fr: "Votre compte transporteur",
  },
  "About 2 minutes. Onboarding — documents and the dispatch agreement — continues after your email is verified.":
    {
      es: "Unos 2 minutos. El onboarding — documentos y acuerdo de dispatch — continúa cuando verifiques tu correo.",
      fr: "Environ 2 minutes. L'onboarding — documents et accord de dispatch — continue après la vérification de votre e-mail.",
    },
  "Where does your authority stand?": {
    es: "¿Cómo va tu autoridad?",
    fr: "Où en est votre autorité ?",
  },
  "My MC authority is active": {
    es: "Mi autoridad MC está activa",
    fr: "Mon autorité MC est active",
  },
  "I filed with FMCSA — authority pending": {
    es: "Ya apliqué con FMCSA — autoridad pendiente",
    fr: "J'ai déposé auprès de la FMCSA — autorité en attente",
  },
  "No authority yet — help me start": {
    es: "Sin autoridad todavía — ayúdenme a empezar",
    fr: "Pas encore d'autorité — aidez-moi à démarrer",
  },
  "I'm leased on to another authority": {
    es: "Trabajo leased-on bajo otra autoridad",
    fr: "Je roule en leased-on sous une autre autorité",
  },
  "MC #": {
    es: "MC #",
    fr: "N° MC",
  },
  "Phone": {
    es: "Teléfono",
    fr: "Téléphone",
  },
  "Your Full Name": {
    es: "Tu nombre completo",
    fr: "Votre nom complet",
  },
  "Password (8+ characters)": {
    es: "Contraseña (8+ caracteres)",
    fr: "Mot de passe (8+ caractères)",
  },
  "No authority yet? You still get a full account — plus the launch checklist and a same-day call from a dispatcher.":
    {
      es: "¿Sin autoridad todavía? Igual recibes una cuenta completa — más el checklist de lanzamiento y una llamada de un dispatcher el mismo día.",
      fr: "Pas encore d'autorité ? Vous recevez quand même un compte complet — plus la checklist de lancement et l'appel d'un dispatcher le jour même.",
    },
  "Leased-on setups are reviewed personally — a dispatcher confirms how your lease works before dispatch starts.":
    {
      es: "Los esquemas leased-on se revisan personalmente — un dispatcher confirma cómo funciona tu lease antes de empezar el dispatch.",
      fr: "Les configurations leased-on sont vérifiées personnellement — un dispatcher confirme votre lease avant de commencer le dispatch.",
    },
  "Create Account →": {
    es: "Crear cuenta →",
    fr: "Créer le compte →",
  },
  "Creating account…": {
    es: "Creando cuenta…",
    fr: "Création du compte…",
  },
  "Already have an account?": {
    es: "¿Ya tienes cuenta?",
    fr: "Vous avez déjà un compte ?",
  },
  "Sign In →": {
    es: "Iniciar sesión →",
    fr: "Se connecter →",
  },
  "This preview environment isn't connected to the account service — no account was created. Call (908) 404-5373 and we'll set you up directly.":
    {
      es: "Este entorno de vista previa no está conectado al servicio de cuentas — no se creó ninguna cuenta. Llama al (908) 404-5373 y te configuramos directamente.",
      fr: "Cet environnement de prévisualisation n'est pas connecté au service de comptes — aucun compte n'a été créé. Appelez le (908) 404-5373 et nous vous installons directement.",
    },
  "✓ ACCOUNT CREATED — Check your inbox and click the verification link, then sign in.":
    {
      es: "✓ CUENTA CREADA — Revisa tu correo y haz clic en el enlace de verificación; luego inicia sesión.",
      fr: "✓ COMPTE CRÉÉ — Vérifiez votre boîte mail et cliquez sur le lien de vérification, puis connectez-vous.",
    },
  "✓ ACCOUNT CREATED — You're signed in.": {
    es: "✓ CUENTA CREADA — Ya iniciaste sesión.",
    fr: "✓ COMPTE CRÉÉ — Vous êtes connecté.",
  },
  "Next: finish onboarding — your documents and dispatch agreement take about 10 minutes.":
    {
      es: "Siguiente: termina el onboarding — tus documentos y el acuerdo de dispatch toman unos 10 minutos.",
      fr: "Ensuite : terminez l'onboarding — vos documents et l'accord de dispatch prennent environ 10 minutes.",
    },
  "Your MC application is pending — our team verifies it and activates dispatch. Sign in any time to track your documents.":
    {
      es: "Tu solicitud de MC está pendiente — nuestro equipo la verifica y activa el dispatch. Inicia sesión cuando quieras para seguir tus documentos.",
      fr: "Votre demande MC est en attente — notre équipe la vérifie et active le dispatch. Connectez-vous à tout moment pour suivre vos documents.",
    },
  "We'll help you launch: your checklist is ready, and a dispatcher calls you the same day.":
    {
      es: "Te ayudamos a lanzarte: tu checklist está lista y un dispatcher te llama el mismo día.",
      fr: "Nous vous aidons à démarrer : votre checklist est prête et un dispatcher vous appelle le jour même.",
    },
  "Because you run leased-on, a dispatcher reviews your setup personally and calls you — usually the same day.":
    {
      es: "Como trabajas leased-on, un dispatcher revisa tu configuración personalmente y te llama — normalmente el mismo día.",
      fr: "Comme vous roulez en leased-on, un dispatcher vérifie votre configuration personnellement et vous appelle — généralement le jour même.",
    },
  "Continue to onboarding →": {
    es: "Continuar al onboarding →",
    fr: "Continuer vers l'onboarding →",
  },
  "See your launch checklist →": {
    es: "Ver tu checklist de lanzamiento →",
    fr: "Voir votre checklist de lancement →",
  },
  "New to PickLoads? Create your carrier account →": {
    es: "¿Nuevo en PickLoads? Crea tu cuenta de carrier →",
    fr: "Nouveau chez PickLoads ? Créez votre compte transporteur →",
  },
  "✓ Email verified — you can sign in now.": {
    es: "✓ Correo verificado — ya puedes iniciar sesión.",
    fr: "✓ E-mail vérifié — vous pouvez vous connecter.",
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
