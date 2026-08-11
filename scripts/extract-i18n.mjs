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
  // ── Approved response wording (business-supplied). Replaces the previous
  // "within one business hour" promise on every quote surface. Defined once in
  // src/lib/copy/response-promise.ts; translated here so the four non-English
  // locales do not silently fall back to the English sentence.
  "A PickLoads representative will review your request and follow up with you promptly.":
    {
      es: "Un representante de PickLoads revisará tu solicitud y se pondrá en contacto contigo a la brevedad.",
      fr: "Un représentant PickLoads examinera votre demande et vous recontactera dans les meilleurs délais.",
    },
  "✓ RECEIVED — A PickLoads representative will review your request and follow up with you promptly.":
    {
      es: "✓ RECIBIDO — Un representante de PickLoads revisará tu solicitud y se pondrá en contacto contigo a la brevedad.",
      fr: "✓ REÇU — Un représentant PickLoads examinera votre demande et vous recontactera dans les meilleurs délais.",
    },
  "Tell us about your shipment.": {
    es: "Cuéntanos sobre tu envío.",
    fr: "Parlez-nous de votre expédition.",
  },
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
  /* ---- M-53: shipper registration ---- */
  "Create your shipper account": {
    es: "Crea tu cuenta de shipper",
    fr: "Créez votre compte expéditeur",
  },
  "Request quotes, see rates as they land, and coordinate freight with vetted carriers — from your own portal.":
    {
      es: "Solicita cotizaciones, mira las tarifas en cuanto llegan y coordina tu carga con carriers verificados — desde tu propio portal.",
      fr: "Demandez des devis, consultez les tarifs dès leur arrivée et coordonnez votre fret avec des transporteurs vérifiés — depuis votre portail.",
    },
  "Your shipper account": {
    es: "Tu cuenta de shipper",
    fr: "Votre compte expéditeur",
  },
  "About 2 minutes. Request quotes and coordinate freight with vetted carriers — a dispatcher reviews every request personally.":
    {
      es: "Unos 2 minutos. Solicita cotizaciones y coordina tu carga con carriers verificados — un dispatcher revisa cada solicitud personalmente.",
      fr: "Environ 2 minutes. Demandez des devis et coordonnez votre fret avec des transporteurs vérifiés — un dispatcher examine chaque demande personnellement.",
    },
  "Industry": {
    es: "Industria",
    fr: "Secteur",
  },
  "Shipping Frequency": {
    es: "Frecuencia de envío",
    fr: "Fréquence d'expédition",
  },
  "Select…": {
    es: "Selecciona…",
    fr: "Sélectionnez…",
  },
  "Construction & building materials": {
    es: "Construcción y materiales",
    fr: "Construction et matériaux",
  },
  "Other": {
    es: "Otro",
    fr: "Autre",
  },
  "Seasonal": {
    es: "Estacional",
    fr: "Saisonnier",
  },
  "Shipping Regions (check all that apply)": {
    es: "Regiones de envío (marca todas las que apliquen)",
    fr: "Régions d'expédition (cochez toutes celles qui s'appliquent)",
  },
  "Northeast": {
    es: "Noreste",
    fr: "Nord-Est",
  },
  "Southeast": {
    es: "Sureste",
    fr: "Sud-Est",
  },
  "Midwest": {
    es: "Medio Oeste",
    fr: "Midwest",
  },
  "Southwest": {
    es: "Suroeste",
    fr: "Sud-Ouest",
  },
  "West": {
    es: "Oeste",
    fr: "Ouest",
  },
  "Nationwide": {
    es: "Todo el país",
    fr: "Tout le pays",
  },
  "Your shipper portal tracks every quote request and rate — and any quotes you already requested under this email get linked automatically.":
    {
      es: "Tu portal de shipper sigue cada solicitud de cotización y tarifa — y las cotizaciones que ya pediste con este correo se vinculan automáticamente.",
      fr: "Votre portail expéditeur suit chaque demande de devis et tarif — et les devis déjà demandés avec cet e-mail sont liés automatiquement.",
    },
  "New here? Create your shipper account →": {
    es: "¿Primera vez? Crea tu cuenta de shipper →",
    fr: "Nouveau ici ? Créez votre compte expéditeur →",
  },
  "No quote requests yet. Request your first quote and it shows up here — along with any past requests made under your verified email.":
    {
      es: "Aún no hay solicitudes de cotización. Pide tu primera cotización y aparecerá aquí — junto con las solicitudes anteriores hechas con tu correo verificado.",
      fr: "Pas encore de demande de devis. Demandez votre premier devis et il apparaîtra ici — avec les demandes passées faites avec votre e-mail vérifié.",
    },
  /* ---- M-54: clear auth states on /login ---- */
  "Your account is suspended. Call (908) 404-5373 or email support@pickloads.com to resolve it.":
    {
      es: "Tu cuenta está suspendida. Llama al (908) 404-5373 o escribe a support@pickloads.com para resolverlo.",
      fr: "Votre compte est suspendu. Appelez le (908) 404-5373 ou écrivez à support@pickloads.com pour le résoudre.",
    },
  "Your session expired — sign in again to continue.": {
    es: "Tu sesión expiró — inicia sesión de nuevo para continuar.",
    fr: "Votre session a expiré — reconnectez-vous pour continuer.",
  },
  "Sign in to continue where you left off.": {
    es: "Inicia sesión para continuar donde quedaste.",
    fr: "Connectez-vous pour reprendre où vous en étiez.",
  },
  "Verify your email first — click the confirmation link we sent you, then sign in.":
    {
      es: "Primero verifica tu correo — haz clic en el enlace de confirmación que te enviamos y luego inicia sesión.",
      fr: "Vérifiez d'abord votre e-mail — cliquez sur le lien de confirmation que nous vous avons envoyé, puis connectez-vous.",
    },
  /* ---- M-55: carrier portal completion (nav, overview, fleet, agreements,
     invoices, notifications, support, settings). Portal strings authored
     es/fr; ru/ht mirror English pending native review (M-42 precedent). ---- */
  "Overview": { es: "Resumen", fr: "Vue d'ensemble" },
  "Company Profile": { es: "Perfil de la empresa", fr: "Profil de l'entreprise" },
  "Trucks & Equipment": { es: "Camiones y equipo", fr: "Camions et équipement" },
  "Drivers": { es: "Conductores", fr: "Conducteurs" },
  "Documents": { es: "Documentos", fr: "Documents" },
  "Agreements": { es: "Acuerdos", fr: "Accords" },
  "Loads": { es: "Cargas", fr: "Chargements" },
  "Invoices & Payments": { es: "Facturas y pagos", fr: "Factures et paiements" },
  "Notifications": { es: "Notificaciones", fr: "Notifications" },
  "Account Settings": { es: "Configuración de cuenta", fr: "Paramètres du compte" },
  "Site": { es: "Sitio", fr: "Site" },
  "Back to pickloads.com": { es: "Volver a pickloads.com", fr: "Retour à pickloads.com" },
  "Sign out": { es: "Cerrar sesión", fr: "Se déconnecter" },
  "Request a quote": { es: "Solicitar cotización", fr: "Demander un devis" },
  "My Documents": { es: "Mis documentos", fr: "Mes documents" },
  "My Quotes": { es: "Mis cotizaciones", fr: "Mes devis" },
  "Active carrier": { es: "Carrier activo", fr: "Transporteur actif" },
  "Onboarding in progress": { es: "Onboarding en curso", fr: "Intégration en cours" },
  "Pending verification": { es: "Verificación pendiente", fr: "Vérification en attente" },
  "Onboarding steps complete": { es: "Pasos de onboarding completos", fr: "Étapes d'intégration terminées" },
  "Onboarding progress": { es: "Progreso del onboarding", fr: "Progression de l'intégration" },
  "Account created": { es: "Cuenta creada", fr: "Compte créé" },
  "MC / USDOT on file": { es: "MC / USDOT registrados", fr: "MC / USDOT enregistrés" },
  "Required documents uploaded": { es: "Documentos requeridos subidos", fr: "Documents requis téléversés" },
  "Dispatch agreement signed": { es: "Acuerdo de dispatch firmado", fr: "Accord de dispatch signé" },
  "Carrier activated for dispatch": { es: "Carrier activado para dispatch", fr: "Transporteur activé pour le dispatch" },
  "Done": { es: "Hecho", fr: "Fait" },
  "To do": { es: "Pendiente", fr: "À faire" },
  "Documents in review": { es: "Documentos en revisión", fr: "Documents en révision" },
  "Reviewed within one business day": { es: "Se revisan en un día hábil", fr: "Révisés sous un jour ouvré" },
  "Missing documents": { es: "Documentos faltantes", fr: "Documents manquants" },
  "Upload documents": { es: "Subir documentos", fr: "Téléverser des documents" },
  "MC Authority Letter": { es: "Carta de autoridad MC", fr: "Lettre d'autorité MC" },
  "Certificate of Insurance": { es: "Certificado de seguro", fr: "Certificat d'assurance" },
  "W-9 Form": { es: "Formulario W-9", fr: "Formulaire W-9" },
  "Voided Check": { es: "Cheque anulado", fr: "Chèque annulé" },
  "Active loads": { es: "Cargas activas", fr: "Chargements actifs" },
  "Recently completed": { es: "Completadas recientemente", fr: "Terminés récemment" },
  "Delivered loads appear here with their dispatch fee.": {
    es: "Las cargas entregadas aparecen aquí con su tarifa de dispatch.",
    fr: "Les chargements livrés apparaissent ici avec leurs frais de dispatch.",
  },
  "Outstanding invoices": { es: "Facturas pendientes", fr: "Factures en attente" },
  "Nothing due": { es: "Nada pendiente", fr: "Rien à payer" },
  "Insurance expiry": { es: "Vencimiento del seguro", fr: "Échéance de l'assurance" },
  "All loads": { es: "Todas las cargas", fr: "Tous les chargements" },
  "All notifications": { es: "Todas las notificaciones", fr: "Toutes les notifications" },
  "Message support": { es: "Escribir a soporte", fr: "Écrire au support" },
  "Your dispatcher": { es: "Tu dispatcher", fr: "Votre dispatcher" },
  "No dispatcher assigned yet — you'll see yours here once dispatch starts. Meanwhile: (908) 404-5373.": {
    es: "Aún no tienes dispatcher asignado — aparecerá aquí cuando empiece el dispatch. Mientras tanto: (908) 404-5373.",
    fr: "Pas encore de dispatcher assigné — le vôtre apparaîtra ici dès le début du dispatch. En attendant : (908) 404-5373.",
  },
  "Nothing yet — document reviews, load updates and invoices show up here.": {
    es: "Nada todavía — las revisiones de documentos, novedades de cargas y facturas aparecen aquí.",
    fr: "Rien pour l'instant — les révisions de documents, mises à jour de chargements et factures s'affichent ici.",
  },
  "New": { es: "Nuevo", fr: "Nouveau" },
  "Mark all read": { es: "Marcar todo leído", fr: "Tout marquer comme lu" },
  "Signed": { es: "Firmado", fr: "Signé" },
  "Awaiting signature": { es: "Esperando firma", fr: "En attente de signature" },
  "Awaiting signature — check your email, or call us": {
    es: "Esperando firma — revisa tu correo o llámanos",
    fr: "En attente de signature — vérifiez votre e-mail ou appelez-nous",
  },
  // "Dispatch agreement" resolves to the existing V4 "Dispatch Agreement"
  // key at runtime (identical slug + meaning) — deliberately not re-added.
  "Dispatch service agreement": { es: "Acuerdo de servicio de dispatch", fr: "Accord de service de dispatch" },
  "Sent / viewed": { es: "Enviado / visto", fr: "Envoyé / consulté" },
  "Delivered by email and completed — dates below.": {
    es: "Entregado por correo y completado — fechas abajo.",
    fr: "Livré par e-mail et complété — dates ci-dessous.",
  },
  "Signature requests go out by email — we don't track open/view timestamps, so check your inbox (and spam).": {
    es: "Las solicitudes de firma salen por correo — no registramos fechas de apertura, así que revisa tu bandeja (y spam).",
    fr: "Les demandes de signature partent par e-mail — nous n'enregistrons pas les dates d'ouverture, vérifiez votre boîte (et les spams).",
  },
  "Executed copies": { es: "Copias firmadas", fr: "Exemplaires signés" },
  "Your signed agreement appears here for download once it's executed.": {
    es: "Tu acuerdo firmado aparecerá aquí para descargar en cuanto esté ejecutado.",
    fr: "Votre accord signé apparaîtra ici en téléchargement dès qu'il sera exécuté.",
  },
  "Your signed copy hasn't been filed here yet — it's in your signature-request email, or ask support and we'll upload it.": {
    es: "Tu copia firmada aún no está archivada aquí — está en el correo de la solicitud de firma, o pídela a soporte y la subimos.",
    fr: "Votre exemplaire signé n'est pas encore archivé ici — il est dans l'e-mail de demande de signature, ou demandez au support et nous le téléverserons.",
  },
  "Re-send signature request": { es: "Reenviar solicitud de firma", fr: "Renvoyer la demande de signature" },
  "✓ Sent — check your inbox for the signature request.": {
    es: "✓ Enviado — revisa tu bandeja para la solicitud de firma.",
    fr: "✓ Envoyé — la demande de signature est dans votre boîte mail.",
  },
  "Your rate": { es: "Tu tarifa", fr: "Votre taux" },
  "of gross per load": { es: "del bruto por carga", fr: "du brut par chargement" },
  "snapshotted per load at booking, never retroactive.": {
    es: "fijada por carga al reservar, nunca retroactiva.",
    fr: "figé par chargement à la réservation, jamais rétroactif.",
  },
  "Dispatch fee": { es: "Tarifa de dispatch", fr: "Frais de dispatch" },
  "Outstanding": { es: "Pendiente de pago", fr: "En attente de paiement" },
  "Paid to date": { es: "Pagado a la fecha", fr: "Payé à ce jour" },
  "Invoices total": { es: "Facturas en total", fr: "Total des factures" },
  "No invoices yet. After a delivered load, your dispatch-fee invoice shows up here with a secure payment link.": {
    es: "Aún no hay facturas. Tras una carga entregada, tu factura de tarifa de dispatch aparece aquí con un enlace de pago seguro.",
    fr: "Pas encore de facture. Après un chargement livré, votre facture de frais de dispatch apparaît ici avec un lien de paiement sécurisé.",
  },
  "Only the dispatch fee is invoiced through PickLoads. Freight payments go broker → you (or your factoring company) and never touch us.": {
    es: "Solo la tarifa de dispatch se factura por PickLoads. Los pagos del flete van del broker a ti (o a tu factoring) y nunca pasan por nosotros.",
    fr: "Seuls les frais de dispatch sont facturés via PickLoads. Les paiements du fret vont du broker à vous (ou à votre société d'affacturage) et ne passent jamais par nous.",
  },
  "Issued": { es: "Emitida", fr: "Émise" },
  "Load": { es: "Carga", fr: "Chargement" },
  "Amount": { es: "Monto", fr: "Montant" },
  "Due": { es: "Vence", fr: "Échéance" },
  "Pay invoice →": { es: "Pagar factura →", fr: "Payer la facture →" },
  "View →": { es: "Ver →", fr: "Voir →" },
  "Open": { es: "Abierta", fr: "Ouverte" },
  "Paid": { es: "Pagada", fr: "Payée" },
  "Draft": { es: "Borrador", fr: "Brouillon" },
  "Void": { es: "Anulada", fr: "Annulée" },
  "Uncollectible": { es: "Incobrable", fr: "Irrécouvrable" },
  "Booked": { es: "Reservada", fr: "Réservé" },
  "In transit": { es: "En tránsito", fr: "En transit" },
  "Delivered": { es: "Entregada", fr: "Livré" },
  "Invoiced": { es: "Facturada", fr: "Facturé" },
  "Cancelled": { es: "Cancelada", fr: "Annulé" },
  "Contact info": { es: "Datos de contacto", fr: "Coordonnées" },
  "Change it in Account Settings.": { es: "Cámbialo en Configuración de cuenta.", fr: "Modifiez-le dans Paramètres du compte." },
  "Dispatch preferences": { es: "Preferencias de dispatch", fr: "Préférences de dispatch" },
  "Your dispatcher plans lanes around these — update them any time.": {
    es: "Tu dispatcher planifica las rutas con esto — actualízalo cuando quieras.",
    fr: "Votre dispatcher planifie les lignes avec ces infos — modifiez-les à tout moment.",
  },
  "Preferred lanes": { es: "Rutas preferidas", fr: "Lignes préférées" },
  "Home time": { es: "Tiempo en casa", fr: "Temps à la maison" },
  "e.g. Midwest → Southeast, no NYC": { es: "ej. Midwest → Southeast, sin NYC", fr: "ex. Midwest → Southeast, pas de NYC" },
  "e.g. Home weekends, based in Charlotte NC": { es: "ej. En casa los fines de semana, base en Charlotte NC", fr: "ex. À la maison le week-end, basé à Charlotte NC" },
  "Save contact info": { es: "Guardar datos", fr: "Enregistrer les coordonnées" },
  "Save preferences": { es: "Guardar preferencias", fr: "Enregistrer les préférences" },
  "Save changes": { es: "Guardar cambios", fr: "Enregistrer les modifications" },
  "Save settings": { es: "Guardar configuración", fr: "Enregistrer les paramètres" },
  "Saving…": { es: "Guardando…", fr: "Enregistrement…" },
  "Sending…": { es: "Enviando…", fr: "Envoi…" },
  "✓ Saved.": { es: "✓ Guardado.", fr: "✓ Enregistré." },
  "Regulated company data": { es: "Datos regulados de la empresa", fr: "Données réglementées de l'entreprise" },
  "These fields are verified by our compliance team — request a change below and we'll apply it after review.": {
    es: "Estos campos los verifica nuestro equipo de cumplimiento — solicita un cambio abajo y lo aplicamos tras revisarlo.",
    fr: "Ces champs sont vérifiés par notre équipe conformité — demandez une modification ci-dessous et nous l'appliquerons après vérification.",
  },
  "Request a change": { es: "Solicitar un cambio", fr: "Demander une modification" },
  "What needs to change?": { es: "¿Qué necesitas cambiar?", fr: "Que faut-il modifier ?" },
  "Describe the change": { es: "Describe el cambio", fr: "Décrivez la modification" },
  "New value, effective date, and anything we should verify.": {
    es: "Nuevo valor, fecha de vigencia y lo que debamos verificar.",
    fr: "Nouvelle valeur, date d'effet et tout élément à vérifier.",
  },
  "Submit change request": { es: "Enviar solicitud de cambio", fr: "Envoyer la demande de modification" },
  "✓ Request received. Our team verifies regulated changes and applies them — you'll hear back in Support.": {
    es: "✓ Solicitud recibida. Nuestro equipo verifica los cambios regulados y los aplica — te respondemos en Soporte.",
    fr: "✓ Demande reçue. Notre équipe vérifie les modifications réglementées et les applique — réponse dans Support.",
  },
  "MC number": { es: "Número MC", fr: "Numéro MC" },
  "USDOT number": { es: "Número USDOT", fr: "Numéro USDOT" },
  "USDOT #": { es: "N.º USDOT", fr: "N° USDOT" },
  "EIN / tax info": { es: "EIN / datos fiscales", fr: "EIN / infos fiscales" },
  "Insurance / COI": { es: "Seguro / COI", fr: "Assurance / COI" },
  "Factoring company": { es: "Empresa de factoring", fr: "Société d'affacturage" },
  "Other regulated detail": { es: "Otro dato regulado", fr: "Autre donnée réglementée" },
  "EIN": { es: "EIN", fr: "EIN" },
  "on file (encrypted)": { es: "registrado (cifrado)", fr: "enregistré (chiffré)" },
  "Add a truck": { es: "Agregar un camión", fr: "Ajouter un camion" },
  "Edit truck": { es: "Editar camión", fr: "Modifier le camion" },
  "Add truck": { es: "Agregar camión", fr: "Ajouter le camion" },
  "Add a driver": { es: "Agregar un conductor", fr: "Ajouter un conducteur" },
  "Edit driver": { es: "Editar conductor", fr: "Modifier le conducteur" },
  "Add driver": { es: "Agregar conductor", fr: "Ajouter le conducteur" },
  "Unit #": { es: "Unidad #", fr: "Unité n°" },
  "Equipment": { es: "Equipo", fr: "Équipement" },
  "Year": { es: "Año", fr: "Année" },
  "Make": { es: "Marca", fr: "Marque" },
  "Model": { es: "Modelo", fr: "Modèle" },
  "VIN": { es: "VIN", fr: "VIN" },
  "Plate": { es: "Placa", fr: "Plaque" },
  "Plate state": { es: "Estado de la placa", fr: "État de la plaque" },
  "Truck": { es: "Camión", fr: "Camion" },
  "In service": { es: "En servicio", fr: "En service" },
  "Out of service": { es: "Fuera de servicio", fr: "Hors service" },
  "Status": { es: "Estado", fr: "Statut" },
  "Actions": { es: "Acciones", fr: "Actions" },
  "Edit": { es: "Editar", fr: "Modifier" },
  "Remove": { es: "Quitar", fr: "Retirer" },
  "Confirm remove": { es: "Confirmar", fr: "Confirmer" },
  "Cancel": { es: "Cancelar", fr: "Annuler" },
  "No trucks on file yet — add your first unit above so dispatch knows what you run.": {
    es: "Aún no hay camiones registrados — agrega tu primera unidad arriba para que dispatch sepa qué manejas.",
    fr: "Pas encore de camion enregistré — ajoutez votre première unité ci-dessus pour que le dispatch sache ce que vous conduisez.",
  },
  "No drivers on file yet — add your drivers so dispatch can plan hours and home time.": {
    es: "Aún no hay conductores registrados — agrégalos para que dispatch planifique horas y tiempo en casa.",
    fr: "Pas encore de conducteur enregistré — ajoutez-les pour que le dispatch planifie les heures et le temps à la maison.",
  },
  "Driver": { es: "Conductor", fr: "Conducteur" },
  "Full name": { es: "Nombre completo", fr: "Nom complet" },
  "Contact": { es: "Contacto", fr: "Contact" },
  "CDL #": { es: "CDL #", fr: "CDL n°" },
  "CDL state": { es: "Estado del CDL", fr: "État du CDL" },
  "CDL expiry": { es: "Vencimiento del CDL", fr: "Échéance du CDL" },
  "Medical card": { es: "Tarjeta médica", fr: "Carte médicale" },
  "Medical card expiry": { es: "Vencimiento de tarjeta médica", fr: "Échéance de la carte médicale" },
  "exp.": { es: "vence", fr: "éch." },
  "Active": { es: "Activo", fr: "Actif" },
  "Inactive": { es: "Inactivo", fr: "Inactif" },
  "Support": { es: "Soporte", fr: "Support" },
  "Send us a message": { es: "Envíanos un mensaje", fr: "Envoyez-nous un message" },
  "Subject": { es: "Asunto", fr: "Objet" },
  "Message": { es: "Mensaje", fr: "Message" },
  "What do you need help with?": { es: "¿Con qué necesitas ayuda?", fr: "De quoi avez-vous besoin ?" },
  "Send message": { es: "Enviar mensaje", fr: "Envoyer le message" },
  "Send reply": { es: "Enviar respuesta", fr: "Envoyer la réponse" },
  "Reply": { es: "Respuesta", fr: "Réponse" },
  "✓ Message sent. A dispatcher answers here in the portal — usually within one business hour (8am–6pm ET).": {
    es: "✓ Mensaje enviado. Un dispatcher responde aquí en el portal — normalmente dentro de una hora hábil (8am–6pm ET).",
    fr: "✓ Message envoyé. Un dispatcher répond ici dans le portail — généralement sous une heure ouvrée (8h–18h ET).",
  },
  "Your conversations": { es: "Tus conversaciones", fr: "Vos conversations" },
  "All conversations": { es: "Todas las conversaciones", fr: "Toutes les conversations" },
  "No conversations yet — send us a message above and the answer lands right here.": {
    es: "Aún no hay conversaciones — envíanos un mensaje arriba y la respuesta llega justo aquí.",
    fr: "Pas encore de conversation — envoyez-nous un message ci-dessus et la réponse arrive juste ici.",
  },
  "This conversation is closed. Start a new one any time — we keep the history here.": {
    es: "Esta conversación está cerrada. Abre una nueva cuando quieras — el historial queda aquí.",
    fr: "Cette conversation est fermée. Ouvrez-en une nouvelle à tout moment — l'historique reste ici.",
  },
  "Answered": { es: "Respondida", fr: "Répondu" },
  "Closed": { es: "Cerrada", fr: "Fermé" },
  "Updated": { es: "Actualizada", fr: "Mis à jour" },
  "You": { es: "Tú", fr: "Vous" },
  "PickLoads": { es: "PickLoads", fr: "PickLoads" },
  "Dispatch support: 24/7 · Office Mon–Fri 8am–6pm ET": {
    es: "Soporte de dispatch: 24/7 · Oficina Lun–Vie 8am–6pm ET",
    fr: "Support dispatch : 24/7 · Bureau lun–ven 8h–18h ET",
  },
  "Password": { es: "Contraseña", fr: "Mot de passe" },
  "Signed in as": { es: "Sesión iniciada como", fr: "Connecté en tant que" },
  "Change password": { es: "Cambiar contraseña", fr: "Changer le mot de passe" },
  "✓ Password updated.": { es: "✓ Contraseña actualizada.", fr: "✓ Mot de passe mis à jour." },
  "Language & email": { es: "Idioma y correo", fr: "Langue et e-mail" },
  "Preferred language": { es: "Idioma preferido", fr: "Langue préférée" },
  "Email notifications": { es: "Notificaciones por correo", fr: "Notifications par e-mail" },
  "Load status updates": { es: "Novedades de estado de cargas", fr: "Mises à jour des chargements" },
  "Document review results": { es: "Resultados de revisión de documentos", fr: "Résultats de révision des documents" },
  "News and offers": { es: "Novedades y ofertas", fr: "Actualités et offres" },
  /* M-25/M-42 leftovers now backfilled (previously English fallback). */
  "New password": { es: "Nueva contraseña", fr: "Nouveau mot de passe" },
  "Confirm new password": { es: "Confirma la nueva contraseña", fr: "Confirmez le nouveau mot de passe" },
  "File": { es: "Archivo", fr: "Fichier" },
  "Uploaded": { es: "Subido", fr: "Téléversé" },
  "Your account isn't linked to a carrier record yet. If you just onboarded, our team activates the link during document review — or call (908) 404-5373.":
    {
      es: "Tu cuenta aún no está vinculada a un registro de carrier. Si acabas de hacer el onboarding, nuestro equipo activa el vínculo durante la revisión de documentos — o llama al (908) 404-5373.",
      fr: "Votre compte n'est pas encore lié à un dossier transporteur. Si vous venez de finir l'intégration, notre équipe active le lien pendant la révision des documents — ou appelez le (908) 404-5373.",
    },
  "No loads yet — your dispatcher books them here as soon as you're rolling.":
    {
      es: "Aún no hay cargas — tu dispatcher las reserva aquí en cuanto estés rodando.",
      fr: "Pas encore de chargement — votre dispatcher les réserve ici dès que vous roulez.",
    },
  /* ---- M-56: shipper portal completion (overview, full quote form, quotes
     timeline, documents/billing honest states, company settings). ---- */
  "Billing": { es: "Facturación", fr: "Facturation" },
  "Company Settings": { es: "Configuración de empresa", fr: "Paramètres de l'entreprise" },
  // "Request a Quote" / "Pickup date" / "Pallets / pieces" resolve to the
  // existing identical-slug keys — deliberately not re-added.
  "Quote requests": { es: "Solicitudes de cotización", fr: "Demandes de devis" },
  "Pending review": { es: "Pendientes de revisión", fr: "En attente de révision" },
  "Rates quoted": { es: "Tarifas cotizadas", fr: "Tarifs proposés" },
  "Quoted rate": { es: "Tarifa cotizada", fr: "Tarif proposé" },
  "Received": { es: "Recibida", fr: "Reçue" },
  "In review": { es: "En revisión", fr: "En révision" },
  "Quoted": { es: "Cotizada", fr: "Devis envoyé" },
  "Requested": { es: "Solicitada", fr: "Demandée" },
  "Lane": { es: "Ruta", fr: "Ligne" },
  "Progress": { es: "Progreso", fr: "Progression" },
  "Deadline": { es: "Fecha límite", fr: "Date limite" },
  "Pickup": { es: "Recogida", fr: "Enlèvement" },
  "Delivery": { es: "Entrega", fr: "Livraison" },
  "Shipments & tracking": { es: "Envíos y seguimiento", fr: "Expéditions et suivi" },
  "Launching soon": { es: "Muy pronto", fr: "Bientôt disponible" },
  "Tracking activates with your first booked shipment — your dispatcher shares live status here.": {
    es: "El seguimiento se activa con tu primer envío reservado — tu dispatcher comparte el estado en vivo aquí.",
    fr: "Le suivi s'active avec votre première expédition réservée — votre dispatcher partage le statut en direct ici.",
  },
  "Our brokerage division launches once our FMCSA authority and BMC-84 bond are active — you're on the early list, and shipment tracking appears right here. Until then we quote and coordinate every request personally.": {
    es: "Nuestra división de brokerage se lanza cuando nuestra autoridad FMCSA y el bono BMC-84 estén activos — ya estás en la lista, y el seguimiento de envíos aparecerá justo aquí. Mientras tanto cotizamos y coordinamos cada solicitud personalmente.",
    fr: "Notre division courtage démarrera dès que notre autorité FMCSA et la caution BMC-84 seront actives — vous êtes sur la liste, et le suivi des expéditions apparaîtra ici même. D'ici là, nous chiffrons et coordonnons chaque demande personnellement.",
  },
  "Quick links": { es: "Enlaces rápidos", fr: "Liens rapides" },
  "A dispatcher reviews every request and calls back with a firm rate — usually within one business hour (8am–6pm ET).": {
    es: "Un dispatcher revisa cada solicitud y te llama con una tarifa firme — normalmente dentro de una hora hábil (8am–6pm ET).",
    fr: "Un dispatcher examine chaque demande et vous rappelle avec un tarif ferme — généralement sous une heure ouvrée (8h–18h ET).",
  },
  "The more detail you give, the faster the firm rate — a dispatcher reviews every request personally.": {
    es: "Cuanto más detalle des, más rápida la tarifa firme — un dispatcher revisa cada solicitud personalmente.",
    fr: "Plus vous donnez de détails, plus vite arrive le tarif ferme — un dispatcher examine chaque demande personnellement.",
  },
  "Pickup company / facility": { es: "Empresa / instalación de recogida", fr: "Entreprise / site d'enlèvement" },
  "Delivery company / facility": { es: "Empresa / instalación de entrega", fr: "Entreprise / site de livraison" },
  "Street address": { es: "Dirección", fr: "Adresse" },
  "City": { es: "Ciudad", fr: "Ville" },
  "State": { es: "Estado", fr: "État" },
  "ZIP": { es: "Código postal", fr: "Code postal" },
  "Delivery deadline": { es: "Fecha límite de entrega", fr: "Date limite de livraison" },
  "Freight details": { es: "Detalles de la carga", fr: "Détails du fret" },
  "Commodity": { es: "Mercancía", fr: "Marchandise" },
  "Weight (lbs)": { es: "Peso (lbs)", fr: "Poids (lbs)" },
  "Dimensions (if oversized or partial)": { es: "Dimensiones (si es sobredimensionada o parcial)", fr: "Dimensions (si hors gabarit ou partiel)" },
  "Length (in)": { es: "Largo (pulg)", fr: "Longueur (po)" },
  "Width (in)": { es: "Ancho (pulg)", fr: "Largeur (po)" },
  "Height (in)": { es: "Alto (pulg)", fr: "Hauteur (po)" },
  "Temperature controlled": { es: "Temperatura controlada", fr: "Température dirigée" },
  "Hazmat (placarded)": { es: "Hazmat (con placas)", fr: "Matières dangereuses (placardées)" },
  "Min temp (°F)": { es: "Temp. mín (°F)", fr: "Temp. min (°F)" },
  "Max temp (°F)": { es: "Temp. máx (°F)", fr: "Temp. max (°F)" },
  "Special instructions": { es: "Instrucciones especiales", fr: "Instructions particulières" },
  "Appointments, liftgate, driver assist, references…": {
    es: "Citas, liftgate, ayuda del conductor, referencias…",
    fr: "Rendez-vous, hayon, aide du chauffeur, références…",
  },
  "Contact name": { es: "Nombre de contacto", fr: "Nom du contact" },
  "Not sure — recommend one": { es: "No estoy seguro — recomiéndenme", fr: "Pas sûr — recommandez-moi" },
  "Request Quote →": { es: "Solicitar cotización →", fr: "Demander le devis →" },
  "✓ REQUEST RECEIVED — A dispatcher reviews it and calls back with a firm rate, usually within one business hour (8am–6pm ET).": {
    es: "✓ SOLICITUD RECIBIDA — Un dispatcher la revisa y te llama con una tarifa firme, normalmente dentro de una hora hábil (8am–6pm ET).",
    fr: "✓ DEMANDE REÇUE — Un dispatcher l'examine et vous rappelle avec un tarif ferme, généralement sous une heure ouvrée (8h–18h ET).",
  },
  "Track it in My Quotes": { es: "Síguela en Mis cotizaciones", fr: "Suivez-la dans Mes devis" },
  "e.g. Packaged food, palletized": { es: "ej. Alimentos empacados, en pallets", fr: "ex. Aliments emballés, palettisés" },
  "Acme Warehouse": { es: "Almacén Acme", fr: "Entrepôt Acme" },
  "Shipment paperwork — rate confirmations, BOLs and PODs — appears here as your shipments run. Nothing on file yet.": {
    es: "La documentación de envíos — confirmaciones de tarifa, BOLs y PODs — aparece aquí cuando corran tus envíos. Aún no hay nada archivado.",
    fr: "Les documents d'expédition — confirmations de tarif, BOL et POD — apparaissent ici au fil de vos expéditions. Rien au dossier pour l'instant.",
  },
  "Shipment paperwork (rate confirmations, BOLs, PODs) lands here once our brokerage division is live. Need a document from a quoted shipment today? Message support and we'll email it.": {
    es: "La documentación (confirmaciones de tarifa, BOLs, PODs) llegará aquí cuando nuestra división de brokerage esté activa. ¿Necesitas un documento hoy? Escribe a soporte y te lo enviamos por correo.",
    fr: "Les documents (confirmations de tarif, BOL, POD) arriveront ici dès que notre division courtage sera active. Besoin d'un document aujourd'hui ? Écrivez au support et nous l'enverrons par e-mail.",
  },
  "Invoices appear here once your first shipment is booked — nothing has been billed to your account. Rate quotes are always free.": {
    es: "Las facturas aparecen aquí cuando se reserve tu primer envío — no se ha facturado nada a tu cuenta. Las cotizaciones siempre son gratis.",
    fr: "Les factures apparaissent ici dès votre première expédition réservée — rien n'a été facturé sur votre compte. Les devis sont toujours gratuits.",
  },
  "Prefer the phone?": { es: "¿Prefieres el teléfono?", fr: "Vous préférez le téléphone ?" },
  "Save company info": { es: "Guardar datos de la empresa", fr: "Enregistrer les infos de l'entreprise" },
  "Billing email": { es: "Correo de facturación", fr: "E-mail de facturation" },
  "Your account was set up by our team and isn't linked to a company record yet — quotes are matched by your sign-in email. Call (908) 404-5373 to link it.": {
    es: "Tu cuenta la creó nuestro equipo y aún no está vinculada a un registro de empresa — las cotizaciones se emparejan con tu correo de acceso. Llama al (908) 404-5373 para vincularla.",
    fr: "Votre compte a été créé par notre équipe et n'est pas encore lié à un dossier d'entreprise — les devis sont associés à votre e-mail de connexion. Appelez le (908) 404-5373 pour le lier.",
  },
  "No quote requests found for this email address. Quotes are matched to your sign-in email": {
    es: "No se encontraron solicitudes de cotización para este correo. Las cotizaciones se emparejan con tu correo de acceso",
    fr: "Aucune demande de devis trouvée pour cet e-mail. Les devis sont associés à votre e-mail de connexion",
  },
  // ---- M-59 supplemental (skip link + portal drawer) ----
  "Skip to main content": { es: "Saltar al contenido principal", fr: "Aller au contenu principal" },
  "Menu": { es: "Menú", fr: "Menu" },
  "Close menu": { es: "Cerrar menú", fr: "Fermer le menu" },
  "Portal navigation": { es: "Navegación del portal", fr: "Navigation du portail" },
  "Process steps (scrollable)": { es: "Pasos del proceso (desplazable)", fr: "Étapes du processus (défilement)" },
  "if you requested one under a different address, call (908) 404-5373 and we'll link it.": {
    es: "si la pediste con otra dirección, llama al (908) 404-5373 y la vinculamos.",
    fr: "si vous l'avez demandée avec une autre adresse, appelez le (908) 404-5373 et nous la lierons.",
  },
  /* ---- M-69 (P-1): newsletter unsubscribe page. Public-facing and legally
     load-bearing (CAN-SPAM), so es/fr are authored here; ru/ht mirror
     English pending native review, flagged in docs/LAUNCH-RUNBOOK.md exactly
     like the M-42/M-55 precedent. ---- */
  "Unsubscribe": {
    es: "Cancelar suscripción",
    fr: "Se désabonner",
  },
  "Marketing emails only. Account, document and load notifications you asked for are separate and keep working.":
    {
      es: "Solo correos de marketing. Las notificaciones de cuenta, documentos y cargas que pediste son aparte y siguen funcionando.",
      fr: "E-mails marketing uniquement. Les notifications de compte, de documents et de chargements que vous avez demandées sont distinctes et continuent de fonctionner.",
    },
  "This unsubscribe link isn't complete or is no longer valid. Email support@pickloads.com and we'll take you off the list by hand — no account needed.":
    {
      es: "Este enlace para cancelar la suscripción está incompleto o ya no es válido. Escribe a support@pickloads.com y te quitamos de la lista manualmente — sin necesidad de cuenta.",
      fr: "Ce lien de désabonnement est incomplet ou n'est plus valide. Écrivez à support@pickloads.com et nous vous retirerons de la liste manuellement — aucun compte requis.",
    },
  "We can't reach the subscriber list right now, so nothing was changed. Try again in a few minutes, or email support@pickloads.com and we'll remove you.":
    {
      es: "Ahora mismo no podemos acceder a la lista de suscriptores, así que no se cambió nada. Inténtalo en unos minutos o escribe a support@pickloads.com y te damos de baja.",
      fr: "Nous ne pouvons pas accéder à la liste d'abonnés pour le moment, rien n'a donc été modifié. Réessayez dans quelques minutes ou écrivez à support@pickloads.com et nous vous retirerons.",
    },
  "This address is already off the Freight Insights list — nothing more to do.":
    {
      es: "Esta dirección ya está fuera de la lista de Freight Insights — no hay nada más que hacer.",
      fr: "Cette adresse est déjà retirée de la liste Freight Insights — rien de plus à faire.",
    },
  "Confirm below and we'll stop sending Freight Insights to this address. This takes effect immediately.":
    {
      es: "Confirma abajo y dejaremos de enviar Freight Insights a esta dirección. Surte efecto de inmediato.",
      fr: "Confirmez ci-dessous et nous cesserons d'envoyer Freight Insights à cette adresse. L'effet est immédiat.",
    },
  "Yes, unsubscribe me": {
    es: "Sí, cancelar mi suscripción",
    fr: "Oui, désabonnez-moi",
  },
  "Removing you…": {
    es: "Dándote de baja…",
    fr: "Désabonnement en cours…",
  },
  "✓ UNSUBSCRIBED — You're off the Freight Insights list. You may still receive account and load emails you asked for.":
    {
      es: "✓ BAJA CONFIRMADA — Ya no estás en la lista de Freight Insights. Puedes seguir recibiendo los correos de cuenta y cargas que pediste.",
      fr: "✓ DÉSABONNEMENT CONFIRMÉ — Vous n'êtes plus sur la liste Freight Insights. Vous pouvez toujours recevoir les e-mails de compte et de chargements que vous avez demandés.",
    },
  "Too many requests from your network. Wait a few minutes, or email support@pickloads.com and we'll remove you.":
    {
      es: "Demasiadas solicitudes desde tu red. Espera unos minutos o escribe a support@pickloads.com y te damos de baja.",
      fr: "Trop de requêtes depuis votre réseau. Attendez quelques minutes ou écrivez à support@pickloads.com et nous vous retirerons.",
    },
  "This unsubscribe link is no longer valid. Email support@pickloads.com and we'll remove you by hand.":
    {
      es: "Este enlace para cancelar la suscripción ya no es válido. Escribe a support@pickloads.com y te damos de baja manualmente.",
      fr: "Ce lien de désabonnement n'est plus valide. Écrivez à support@pickloads.com et nous vous retirerons manuellement.",
    },
  "We couldn't reach the subscriber list just now — nothing was changed. Try again, or email support@pickloads.com.":
    {
      es: "No pudimos acceder a la lista de suscriptores — no se cambió nada. Inténtalo de nuevo o escribe a support@pickloads.com.",
      fr: "Nous n'avons pas pu accéder à la liste d'abonnés — rien n'a été modifié. Réessayez ou écrivez à support@pickloads.com.",
    },
  /* ---- M-69 (P-6): the restored testimonials band reuses the V4
     prototype's own eyebrow ("What carriers say") and heading ("Word of
     mouth is our load board.") — both are already in the extracted V4
     dictionary in all five locales, so they are deliberately NOT re-declared
     here. Re-declaring them would overwrite the prototype's ru/ht wording. --- */
  /* ---- M-69 (P-7): honest RPM label on the carrier loads table. ---- */
  "Loaded RPM": {
    es: "RPM cargado",
    fr: "RPM chargé",
  },

  /* ---- M-74 (§11): shipper shipment list + detail + dashboard tiles.
     PORTAL CHROME ONLY. Every shipment VOCABULARY string — the 18 statuses,
     the 9 milestones, the event types, the D-6 phrase library, the §30
     honest labels, the §23 a11y sentences — comes from the `shipment`
     namespace M-73 authored further down this file, and is deliberately NOT
     re-declared here. A second set of status words would drift on the first
     rename and would give /track and the portal different English.
     es/fr authored; ru/ht mirror English pending native review, the M-42 /
     M-55 / M-69 / M-73 precedent recorded in docs/LAUNCH-RUNBOOK.md. ---- */
  Shipments: { es: "Envíos", fr: "Expéditions" },
  "All shipments": { es: "Todos los envíos", fr: "Toutes les expéditions" },
  "View all shipments": {
    es: "Ver todos los envíos",
    fr: "Voir toutes les expéditions",
  },
  "Back to the newest updates": {
    es: "Volver a las actualizaciones más recientes",
    fr: "Revenir aux mises à jour les plus récentes",
  },
  "Your shipments": { es: "Tus envíos", fr: "Vos expéditions" },
  "Filter shipments": { es: "Filtrar envíos", fr: "Filtrer les expéditions" },
  "PO or reference": {
    es: "Orden de compra o referencia",
    fr: "Bon de commande ou référence",
  },
  "Pickup from": { es: "Recogida desde", fr: "Chargement à partir du" },
  "Pickup to": { es: "Recogida hasta", fr: "Chargement jusqu'au" },
  "All statuses": { es: "Todos los estados", fr: "Tous les statuts" },
  "Delayed only": { es: "Solo con retraso", fr: "Uniquement en retard" },
  "Delivered only": { es: "Solo entregados", fr: "Uniquement livrées" },
  "Apply filters": { es: "Aplicar filtros", fr: "Appliquer les filtres" },
  "Clear filters": { es: "Borrar filtros", fr: "Effacer les filtres" },
  "Estimated delivery": { es: "Entrega estimada", fr: "Livraison estimée" },
  "Shipment pages": {
    es: "Páginas de envíos",
    fr: "Pages d'expéditions",
  },
  Page: { es: "Página", fr: "Page" },
  of: { es: "de", fr: "sur" },
  Previous: { es: "Anterior", fr: "Précédent" },
  Next: { es: "Siguiente", fr: "Suivant" },
  "Showing your most recent shipments.": {
    es: "Mostrando tus envíos más recientes.",
    fr: "Affichage de vos expéditions les plus récentes.",
  },
  "No shipments match.": {
    es: "Ningún envío coincide.",
    fr: "Aucune expédition ne correspond.",
  },
  "No shipments match these filters. Clear them to see everything on your account.":
    {
      es: "Ningún envío coincide con estos filtros. Bórralos para ver todo lo de tu cuenta.",
      fr: "Aucune expédition ne correspond à ces filtres. Effacez-les pour tout voir sur votre compte.",
    },
  "No shipments yet. Once a dispatcher books your first load it appears here with its tracking number and milestones.":
    {
      es: "Aún no hay envíos. Cuando un dispatcher reserve tu primera carga, aparecerá aquí con su número de seguimiento y sus hitos.",
      fr: "Pas encore d'expédition. Dès qu'un régulateur réserve votre premier chargement, il apparaît ici avec son numéro de suivi et ses étapes.",
    },
  "Nothing could be loaded.": {
    es: "No se pudo cargar nada.",
    fr: "Rien n'a pu être chargé.",
  },
  "We couldn't load your shipments just now. Refresh the page, or call (908) 404-5373 and a dispatcher will read them to you.":
    {
      es: "No pudimos cargar tus envíos en este momento. Actualiza la página o llama al (908) 404-5373 y un dispatcher te los leerá.",
      fr: "Nous n'avons pas pu charger vos expéditions pour le moment. Actualisez la page ou appelez le (908) 404-5373 et un régulateur vous les lira.",
    },
  "Your account isn't linked to a company record yet, so there are no shipments to show. Call (908) 404-5373 and we'll link it — your quotes are already matched by your sign-in email.":
    {
      es: "Tu cuenta aún no está vinculada a un registro de empresa, así que no hay envíos que mostrar. Llama al (908) 404-5373 y la vinculamos — tus cotizaciones ya se asocian por tu correo de acceso.",
      fr: "Votre compte n'est pas encore rattaché à une fiche entreprise, il n'y a donc aucune expédition à afficher. Appelez le (908) 404-5373 et nous ferons le lien — vos devis sont déjà associés à votre e-mail de connexion.",
    },
  "Dispatch customers: your loads are tracked inside the Carrier Portal, not here.":
    {
      es: "Clientes de dispatch: tus cargas se siguen dentro del Portal del Carrier, no aquí.",
      fr: "Clients dispatch : vos chargements sont suivis dans le Portail Transporteur, pas ici.",
    },
  "New brokerage bookings are paused. Shipments already in progress are shown below and continue to be dispatched normally.":
    {
      es: "Las nuevas reservas de brokerage están pausadas. Los envíos ya en curso se muestran abajo y se siguen gestionando con normalidad.",
      fr: "Les nouvelles réservations de courtage sont suspendues. Les expéditions déjà en cours sont affichées ci-dessous et continuent d'être gérées normalement.",
    },

  /* ---- detail page ---- */
  Location: { es: "Ubicación", fr: "Localisation" },
  "Origin address": { es: "Dirección de origen", fr: "Adresse d'origine" },
  "Destination address": {
    es: "Dirección de destino",
    fr: "Adresse de destination",
  },
  "Open a support thread": {
    es: "Abrir una conversación de soporte",
    fr: "Ouvrir une demande d'assistance",
  },
  "Shipment documents — BOL, proof of delivery and approved paperwork — aren't available for download yet. Ask your dispatcher and they'll email them to you.":
    {
      es: "Los documentos del envío — conocimiento de embarque, prueba de entrega y papeleo aprobado — todavía no se pueden descargar. Pídeselos a tu dispatcher y te los envía por correo.",
      fr: "Les documents d'expédition — lettre de voiture, preuve de livraison et pièces validées — ne sont pas encore téléchargeables. Demandez-les à votre régulateur, il vous les enverra par e-mail.",
    },
  "Invoice status": { es: "Estado de la factura", fr: "Statut de la facture" },
  "No invoice has been raised for this shipment yet.": {
    es: "Todavía no se ha emitido ninguna factura para este envío.",
    fr: "Aucune facture n'a encore été émise pour cette expédition.",
  },
  "We couldn't read your invoices just now.": {
    es: "No pudimos leer tus facturas en este momento.",
    fr: "Nous n'avons pas pu lire vos factures pour le moment.",
  },
  "Not yet issued": { es: "Aún no emitida", fr: "Pas encore émise" },
  "Awaiting payment": { es: "Pendiente de pago", fr: "En attente de paiement" },
  Paid: { es: "Pagada", fr: "Payée" },
  "On hold — please call us": {
    es: "En espera — llámanos, por favor",
    fr: "En suspens — merci de nous appeler",
  },
  Issued: { es: "Emitida", fr: "Émise" },
  "Shipment contacts": {
    es: "Contactos del envío",
    fr: "Contacts de l'expédition",
  },
  "No contacts have been recorded for this shipment yet.": {
    es: "Todavía no se han registrado contactos para este envío.",
    fr: "Aucun contact n'a encore été enregistré pour cette expédition.",
  },
  "Contact through dispatch": {
    es: "Contactar a través de dispatch",
    fr: "Contacter via la régulation",
  },
  Role: { es: "Función", fr: "Rôle" },
  Contact: { es: "Contacto", fr: "Contact" },
  "Show older updates": {
    es: "Ver actualizaciones anteriores",
    fr: "Voir les mises à jour plus anciennes",
  },

  /* ---- §11 dashboard tiles ---- */
  /* NOTE — ten labels this module renders are deliberately ABSENT here:
     Paid · Cancelled · Amount · Issued · Due · Company · Contact · Booked ·
     In transit · Outstanding invoices. All ten already exist in the extracted
     V4 dictionary with the prototype's own five-locale wording (including
     ru/ht, which this catalogue can only mirror in English). Re-declaring
     them would OVERWRITE those translations — the exact hazard M-69 recorded
     above for "What carriers say". `tv()` finds them where they are. */
  "Pickups today": { es: "Recogidas hoy", fr: "Chargements aujourd'hui" },
  "In transit": { es: "En tránsito", fr: "En transit" },
  Delayed: { es: "Con retraso", fr: "En retard" },
  "Deliveries today": { es: "Entregas hoy", fr: "Livraisons aujourd'hui" },
  Completed: { es: "Completados", fr: "Terminées" },
  "Documents awaiting review": {
    es: "Documentos pendientes de revisión",
    fr: "Documents en attente de vérification",
  },
  "Document uploads aren't live yet": {
    es: "La carga de documentos aún no está activa",
    fr: "Le dépôt de documents n'est pas encore actif",
  },
  "Not available right now": {
    es: "No disponible ahora mismo",
    fr: "Indisponible pour le moment",
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


/* ==========================================================================
 * M-73 — the `shipment` namespace (DIRECTIVE-tracking §24, §30; decision D-6)
 *
 * WHY IT LIVES IN THE GENERATOR AND NOT IN `messages/*.json`.
 * `messages/{en,es,fr,ru,ht}.json` are BUILD ARTIFACTS: the last statement of
 * this file overwrites all five. A namespace hand-edited into those files
 * would survive exactly until the next `node scripts/extract-i18n.mjs`, and
 * then vanish without a diff anybody reviewed. The generator stays the single
 * source of truth (audit U-08), so the namespace is declared here.
 *
 * WHY IT IS NESTED WHERE `v4` IS FLAT. The v4 namespace is keyed by slugs of
 * English sentences; this one is keyed by MACHINE IDENTIFIERS that
 * `src/lib/shipments/types.ts` already generates (`statusKey()`,
 * `eventTypeKey()`, `exceptionTypeKey()`, `exceptionSeverityKey()`) plus
 * M-73's own `milestoneKey()` and `phraseKey()`. Those builders return dotted
 * paths, which next-intl resolves against nested objects — so the shape here
 * is dictated by code that shipped in M-70, not chosen.
 *
 * LOCALE POLICY, stated honestly. `en`, `es` and `fr` are AUTHORED. `ru` and
 * `ht` MIRROR ENGLISH and are flagged for native review in
 * docs/LAUNCH-RUNBOOK.md — the established M-42 / M-55 / M-69 precedent, and
 * the only alternative to machine translation, which §24 forbids for exactly
 * this kind of content. A Russian visitor sees English words rather than
 * plausible-sounding machine Russian describing where their freight is.
 *
 * DECISION D-6 lives in the `phrase.*` branch: a curated library of operator
 * sentences, translated like any other UI string, which is what makes a
 * dispatcher's status note readable in five languages without translating
 * anything at request time. `label.dispatch_written` is the other half — the
 * honest label on free text that is NOT in the library.
 * ========================================================================== */
const SHIPMENT = {
  /* ---- §6 statuses (M-70 `statusKey()`) ---------------------------------- */
  "status.quote_requested": { en: "Quote requested", es: "Cotización solicitada", fr: "Devis demandé" },
  "status.quote_sent": { en: "Quote sent", es: "Cotización enviada", fr: "Devis envoyé" },
  "status.quote_accepted": { en: "Quote accepted", es: "Cotización aceptada", fr: "Devis accepté" },
  "status.carrier_search": { en: "Finding a carrier", es: "Buscando transportista", fr: "Recherche d'un transporteur" },
  "status.carrier_assigned": { en: "Carrier assigned", es: "Transportista asignado", fr: "Transporteur assigné" },
  "status.dispatched": { en: "Dispatched", es: "Despachado", fr: "Camion envoyé" },
  "status.en_route_to_pickup": { en: "En route to pickup", es: "En camino a la recogida", fr: "En route vers le chargement" },
  "status.arrived_at_pickup": { en: "Arrived at pickup", es: "Llegó a la recogida", fr: "Arrivé au chargement" },
  "status.loading": { en: "Loading", es: "Cargando", fr: "Chargement en cours" },
  "status.picked_up": { en: "Picked up", es: "Recogido", fr: "Chargé" },
  "status.in_transit": { en: "In transit", es: "En tránsito", fr: "En transit" },
  "status.delayed": { en: "Delayed", es: "Retrasado", fr: "Retardé" },
  "status.arrived_at_delivery": { en: "Arrived at delivery", es: "Llegó a la entrega", fr: "Arrivé à la livraison" },
  "status.unloading": { en: "Unloading", es: "Descargando", fr: "Déchargement en cours" },
  "status.delivered": { en: "Delivered", es: "Entregado", fr: "Livré" },
  "status.pod_uploaded": { en: "Proof of delivery received", es: "Prueba de entrega recibida", fr: "Preuve de livraison reçue" },
  "status.completed": { en: "Completed", es: "Completado", fr: "Terminé" },
  "status.cancelled": { en: "Cancelled", es: "Cancelado", fr: "Annulé" },

  /* ---- §8 milestones (M-73 `milestoneKey()`) ----------------------------
   * Separate from `status.*` on purpose: §8's ninth step is "POD Available"
   * (a fact about the customer's paperwork), while the status is "Proof of
   * delivery received" (a fact about an operator's action). One key serving
   * both would force one of them to be wrong in five languages. */
  "milestone.quote_accepted": { en: "Quote accepted", es: "Cotización aceptada", fr: "Devis accepté" },
  "milestone.carrier_assigned": { en: "Carrier assigned", es: "Transportista asignado", fr: "Transporteur assigné" },
  "milestone.dispatched": { en: "Dispatched", es: "Despachado", fr: "Camion envoyé" },
  "milestone.arrived_at_pickup": { en: "Arrived at pickup", es: "Llegada a la recogida", fr: "Arrivée au chargement" },
  "milestone.picked_up": { en: "Picked up", es: "Recogido", fr: "Chargé" },
  "milestone.in_transit": { en: "In transit", es: "En tránsito", fr: "En transit" },
  "milestone.arrived_at_delivery": { en: "Arrived at delivery", es: "Llegada a la entrega", fr: "Arrivée à la livraison" },
  "milestone.delivered": { en: "Delivered", es: "Entregado", fr: "Livré" },
  "milestone.pod_uploaded": { en: "POD available", es: "Prueba de entrega disponible", fr: "Preuve de livraison disponible" },

  /* ---- §7 event types (M-70 `eventTypeKey()`) --------------------------- */
  "event.shipment_created": { en: "Shipment created", es: "Envío creado", fr: "Expédition créée" },
  "event.status_change": { en: "Status updated", es: "Estado actualizado", fr: "Statut mis à jour" },
  "event.location_update": { en: "Location updated", es: "Ubicación actualizada", fr: "Position mise à jour" },
  "event.eta_update": { en: "Estimated time updated", es: "Hora estimada actualizada", fr: "Heure estimée mise à jour" },
  "event.appointment_set": { en: "Appointment set", es: "Cita programada", fr: "Rendez-vous fixé" },
  "event.appointment_rescheduled": { en: "Appointment rescheduled", es: "Cita reprogramada", fr: "Rendez-vous reporté" },
  "event.assignment_created": { en: "Carrier assigned", es: "Transportista asignado", fr: "Transporteur assigné" },
  "event.assignment_released": { en: "Carrier released", es: "Transportista liberado", fr: "Transporteur libéré" },
  "event.document_uploaded": { en: "Document uploaded", es: "Documento cargado", fr: "Document téléversé" },
  "event.document_approved": { en: "Document approved", es: "Documento aprobado", fr: "Document approuvé" },
  "event.pod_requested": { en: "Proof of delivery requested", es: "Prueba de entrega solicitada", fr: "Preuve de livraison demandée" },
  "event.exception_opened": { en: "Issue reported", es: "Incidencia reportada", fr: "Incident signalé" },
  "event.exception_resolved": { en: "Issue resolved", es: "Incidencia resuelta", fr: "Incident résolu" },
  "event.public_update": { en: "Update from dispatch", es: "Actualización de dispatch", fr: "Mise à jour de la régulation" },
  "event.internal_note": { en: "Internal note", es: "Nota interna", fr: "Note interne" },
  "event.call_logged": { en: "Call logged", es: "Llamada registrada", fr: "Appel enregistré" },
  "event.email_logged": { en: "Email logged", es: "Correo registrado", fr: "E-mail enregistré" },
  "event.notification_sent": { en: "Notification sent", es: "Notificación enviada", fr: "Notification envoyée" },
  "event.correction": { en: "Record corrected", es: "Registro corregido", fr: "Enregistrement corrigé" },
  "event.cancellation": { en: "Shipment cancelled", es: "Envío cancelado", fr: "Expédition annulée" },

  /* ---- §21 exception types (M-70 `exceptionTypeKey()`) ------------------ */
  "exception.pickup_delay": { en: "Pickup delay", es: "Retraso en la recogida", fr: "Retard au chargement" },
  "exception.delivery_delay": { en: "Delivery delay", es: "Retraso en la entrega", fr: "Retard à la livraison" },
  "exception.mechanical_issue": { en: "Mechanical issue", es: "Problema mecánico", fr: "Problème mécanique" },
  "exception.weather": { en: "Weather", es: "Clima", fr: "Météo" },
  "exception.traffic": { en: "Traffic", es: "Tráfico", fr: "Circulation" },
  "exception.facility_delay": { en: "Facility delay", es: "Retraso en las instalaciones", fr: "Retard sur le site" },
  "exception.rejected_freight": { en: "Freight refused", es: "Carga rechazada", fr: "Marchandise refusée" },
  "exception.damaged_freight": { en: "Freight damage", es: "Daño en la carga", fr: "Marchandise endommagée" },
  "exception.missing_appointment": { en: "Appointment missing", es: "Falta la cita", fr: "Rendez-vous manquant" },
  "exception.driver_unavailable": { en: "Driver unavailable", es: "Conductor no disponible", fr: "Chauffeur indisponible" },
  "exception.carrier_cancellation": { en: "Carrier cancellation", es: "Cancelación del transportista", fr: "Annulation du transporteur" },
  "exception.documentation_issue": { en: "Document issue", es: "Problema de documentación", fr: "Problème de document" },
  "exception.other": { en: "Other issue", es: "Otra incidencia", fr: "Autre incident" },

  /* ---- §21 severities (M-70 `exceptionSeverityKey()`) ------------------- */
  "severity.low": { en: "Low", es: "Baja", fr: "Faible" },
  "severity.medium": { en: "Medium", es: "Media", fr: "Moyenne" },
  "severity.high": { en: "High", es: "Alta", fr: "Élevée" },
  "severity.critical": { en: "Critical", es: "Crítica", fr: "Critique" },
  /* ---- §18 party roles (M-70 `partyRoleKey()`, first rendered by M-74) ----
     §11's shipment detail shows "shipment contacts", which means rendering
     `shipment_parties.party_role` to a customer in five languages. M-70
     shipped the enum and M-74 added the key builder beside its four
     siblings; the labels are authored here rather than in the v4
     supplemental catalogue because they are shipment VOCABULARY, and the
     dispatcher board (M-75) and broker portal (M-81) will render the same
     six words. */
  "party.shipper": { en: "Shipper", es: "Remitente", fr: "Expéditeur" },
  "party.consignee": {
    en: "Consignee",
    es: "Destinatario",
    fr: "Destinataire",
  },
  "party.broker_partner": {
    en: "Broker partner",
    es: "Socio broker",
    fr: "Partenaire courtier",
  },
  "party.carrier": { en: "Carrier", es: "Transportista", fr: "Transporteur" },
  "party.billing": {
    en: "Billing contact",
    es: "Contacto de facturación",
    fr: "Contact de facturation",
  },
  "party.third_party": { en: "Third party", es: "Tercero", fr: "Tiers" },

  /* ---- §30 honest labels ------------------------------------------------
   * The six the directive quotes verbatim, plus D-6's free-text label. Every
   * one of them exists to stop the page over-claiming: none says "live", none
   * says "AI", and `last_updated_by_dispatch` says out loud that a human typed
   * the last update. */
  "label.last_updated_by_dispatch": { en: "Last updated by dispatch", es: "Última actualización de dispatch", fr: "Dernière mise à jour par la régulation" },
  "label.milestone_tracking": { en: "Milestone tracking", es: "Seguimiento por hitos", fr: "Suivi par étapes" },
  "label.live_location_available": { en: "Live location available", es: "Ubicación en vivo disponible", fr: "Position en direct disponible" },
  "label.location_unavailable": { en: "Location temporarily unavailable", es: "Ubicación no disponible temporalmente", fr: "Position temporairement indisponible" },
  "label.eta_by_dispatcher": { en: "ETA provided by dispatcher", es: "Hora estimada proporcionada por el dispatcher", fr: "Heure estimée fournie par le régulateur" },
  "label.tracking_link_expired": { en: "Tracking link expired", es: "El enlace de seguimiento ha caducado", fr: "Lien de suivi expiré" },
  "label.dispatch_written": { en: "Written by dispatch, in English", es: "Escrito por dispatch, en inglés", fr: "Rédigé par la régulation, en anglais" },

  /* ---- D-6 curated phrase library --------------------------------------
   * Keys mirror `PUBLIC_PHRASES` in src/lib/shipments/phrases.ts exactly;
   * tests/unit/shipment-phrases.test.ts fails if the two ever diverge. */
  "phrase.update.carrier_assigned": { en: "A carrier has been assigned to this shipment.", es: "Se ha asignado un transportista a este envío.", fr: "Un transporteur a été assigné à cette expédition." },
  "phrase.update.dispatched": { en: "The truck is on its way to the pickup location.", es: "El camión va en camino al lugar de recogida.", fr: "Le camion est en route vers le lieu de chargement." },
  "phrase.update.arrived_at_pickup": { en: "The truck has arrived at the pickup location.", es: "El camión ha llegado al lugar de recogida.", fr: "Le camion est arrivé au lieu de chargement." },
  "phrase.update.picked_up": { en: "The freight has been picked up.", es: "La carga ha sido recogida.", fr: "La marchandise a été chargée." },
  "phrase.update.in_transit": { en: "The shipment is in transit.", es: "El envío está en tránsito.", fr: "L'expédition est en transit." },
  "phrase.update.arrived_at_delivery": { en: "The truck has arrived at the delivery location.", es: "El camión ha llegado al lugar de entrega.", fr: "Le camion est arrivé au lieu de livraison." },
  "phrase.update.delivered": { en: "The shipment has been delivered.", es: "El envío ha sido entregado.", fr: "L'expédition a été livrée." },
  "phrase.update.pod_requested": { en: "Dispatch has requested proof of delivery.", es: "Dispatch ha solicitado la prueba de entrega.", fr: "La régulation a demandé la preuve de livraison." },
  "phrase.update.eta_updated": { en: "The estimated delivery time has been updated.", es: "La hora estimada de entrega ha sido actualizada.", fr: "L'heure de livraison estimée a été mise à jour." },
  "phrase.delay.traffic": { en: "Traffic is slowing the truck down.", es: "El tráfico está retrasando al camión.", fr: "La circulation ralentit le camion." },
  "phrase.delay.weather": { en: "Weather is slowing the truck down.", es: "El clima está retrasando al camión.", fr: "La météo ralentit le camion." },
  "phrase.delay.facility": { en: "The truck is waiting at the facility.", es: "El camión está esperando en las instalaciones.", fr: "Le camion attend sur le site." },
  "phrase.delay.mechanical": { en: "The truck needs a repair before it can continue.", es: "El camión necesita una reparación antes de continuar.", fr: "Le camion doit être réparé avant de repartir." },
  "phrase.delay.appointment": { en: "The truck is waiting for its appointment time.", es: "El camión está esperando su hora de cita.", fr: "Le camion attend l'heure de son rendez-vous." },
  "phrase.delay.previous_stop": { en: "The truck is running late from an earlier stop.", es: "El camión viene retrasado de una parada anterior.", fr: "Le camion a pris du retard à un arrêt précédent." },
  "phrase.delay.paperwork": { en: "Paperwork is being completed at the facility.", es: "Se está completando el papeleo en las instalaciones.", fr: "Les documents sont en cours de finalisation sur le site." },
  "phrase.delay.driver_hours": { en: "The driver is taking a required rest break.", es: "El conductor está tomando un descanso obligatorio.", fr: "Le chauffeur prend une pause obligatoire." },
  "phrase.exception.pickup_delay": { en: "Pickup is running later than scheduled. Dispatch is confirming a new time.", es: "La recogida va más tarde de lo previsto. Dispatch está confirmando una nueva hora.", fr: "Le chargement a du retard. La régulation confirme un nouvel horaire." },
  "phrase.exception.delivery_delay": { en: "Delivery is running later than scheduled. Dispatch is confirming a new time.", es: "La entrega va más tarde de lo previsto. Dispatch está confirmando una nueva hora.", fr: "La livraison a du retard. La régulation confirme un nouvel horaire." },
  "phrase.exception.mechanical_issue": { en: "The truck needs a repair. Dispatch is arranging the fix or a replacement truck.", es: "El camión necesita una reparación. Dispatch está gestionando el arreglo o un camión de reemplazo.", fr: "Le camion doit être réparé. La régulation organise la réparation ou un camion de remplacement." },
  "phrase.exception.weather": { en: "Weather is affecting this route. Dispatch is monitoring conditions.", es: "El clima está afectando esta ruta. Dispatch está vigilando las condiciones.", fr: "La météo affecte cet itinéraire. La régulation surveille les conditions." },
  "phrase.exception.traffic": { en: "Traffic is affecting this route. Dispatch is monitoring the delay.", es: "El tráfico está afectando esta ruta. Dispatch está vigilando el retraso.", fr: "La circulation affecte cet itinéraire. La régulation surveille le retard." },
  "phrase.exception.facility_delay": { en: "The facility is taking longer than expected. Dispatch is in contact with them.", es: "Las instalaciones están tardando más de lo esperado. Dispatch está en contacto con ellas.", fr: "Le site prend plus de temps que prévu. La régulation est en contact avec lui." },
  "phrase.exception.rejected_freight": { en: "The receiver did not accept part of this shipment. Dispatch is working on next steps.", es: "El destinatario no aceptó parte de este envío. Dispatch está trabajando en los siguientes pasos.", fr: "Le destinataire n'a pas accepté une partie de cette expédition. La régulation travaille sur la suite." },
  "phrase.exception.damaged_freight": { en: "Damage was reported on this shipment. Dispatch is documenting it with the carrier.", es: "Se reportó un daño en este envío. Dispatch lo está documentando con el transportista.", fr: "Un dommage a été signalé sur cette expédition. La régulation le documente avec le transporteur." },
  "phrase.exception.missing_appointment": { en: "An appointment time still needs to be confirmed. Dispatch is arranging it.", es: "Aún falta confirmar una hora de cita. Dispatch la está gestionando.", fr: "Un horaire de rendez-vous reste à confirmer. La régulation s'en occupe." },
  "phrase.exception.driver_unavailable": { en: "The assigned driver is unavailable. Dispatch is arranging coverage.", es: "El conductor asignado no está disponible. Dispatch está organizando la cobertura.", fr: "Le chauffeur assigné est indisponible. La régulation organise un remplacement." },
  "phrase.exception.carrier_cancellation": { en: "The assigned carrier can no longer run this load. Dispatch is sourcing another truck.", es: "El transportista asignado ya no puede llevar esta carga. Dispatch está buscando otro camión.", fr: "Le transporteur assigné ne peut plus assurer ce chargement. La régulation cherche un autre camion." },
  "phrase.exception.documentation_issue": { en: "A document for this shipment needs correcting. Dispatch is handling it.", es: "Un documento de este envío necesita corrección. Dispatch se está encargando.", fr: "Un document de cette expédition doit être corrigé. La régulation s'en charge." },

  /* ---- page copy -------------------------------------------------------- */
  "page.eyebrow": { en: "Shipment tracking", es: "Seguimiento de envíos", fr: "Suivi d'expédition" },
  "page.title": { en: "Track a shipment", es: "Rastrea un envío", fr: "Suivre une expédition" },
  "page.intro": { en: "Enter your PickLoads tracking number and the delivery ZIP code — or the access code from your confirmation — to see where your freight is.", es: "Introduce tu número de seguimiento de PickLoads y el código postal de entrega — o el código de acceso de tu confirmación — para ver dónde está tu carga.", fr: "Saisissez votre numéro de suivi PickLoads et le code postal de livraison — ou le code d'accès de votre confirmation — pour voir où se trouve votre marchandise." },
  "page.meta_title": { en: "Track a Shipment — PickLoads", es: "Rastrea un envío — PickLoads", fr: "Suivre une expédition — PickLoads" },
  "page.meta_description": { en: "Track a PickLoads shipment with your tracking number and delivery ZIP code. Milestone updates entered by our dispatch team — no account needed.", es: "Rastrea un envío de PickLoads con tu número de seguimiento y el código postal de entrega. Actualizaciones por hitos ingresadas por nuestro equipo de dispatch — sin cuenta.", fr: "Suivez une expédition PickLoads avec votre numéro de suivi et le code postal de livraison. Mises à jour par étapes saisies par notre équipe de régulation — sans compte." },
  "page.gate_notice": { en: "PickLoads brokerage shipments begin once our FMCSA broker authority and BMC-84 bond are active. If you are a dispatch customer, your loads are tracked inside the Carrier Portal.", es: "Los envíos de brokerage de PickLoads comenzarán cuando nuestra autoridad de broker FMCSA y la fianza BMC-84 estén activas. Si eres cliente de dispatch, tus cargas se siguen dentro del Portal del Carrier.", fr: "Les expéditions de courtage PickLoads débuteront dès l'activation de notre autorité de courtier FMCSA et de notre caution BMC-84. Si vous êtes client dispatch, vos chargements sont suivis dans le Portail Transporteur." },
  "page.help_title": { en: "Can't find your shipment?", es: "¿No encuentras tu envío?", fr: "Vous ne trouvez pas votre expédition ?" },
  "page.help_body": { en: "Your tracking number is on your confirmation email and on the bill of lading. If the delivery ZIP code doesn't work, try the access code from the same email. Still stuck? Call (908) 404-5373 — a dispatcher answers 24/7.", es: "Tu número de seguimiento está en tu correo de confirmación y en el conocimiento de embarque. Si el código postal de entrega no funciona, prueba con el código de acceso del mismo correo. ¿Sigues atascado? Llama al (908) 404-5373 — un dispatcher responde 24/7.", fr: "Votre numéro de suivi figure dans votre e-mail de confirmation et sur la lettre de voiture. Si le code postal de livraison ne fonctionne pas, essayez le code d'accès du même e-mail. Toujours bloqué ? Appelez le (908) 404-5373 — un régulateur répond 24h/24." },
  "page.privacy_note": { en: "We ask for two pieces of information because a tracking number on its own is not a password. We log every lookup attempt.", es: "Pedimos dos datos porque un número de seguimiento por sí solo no es una contraseña. Registramos cada intento de consulta.", fr: "Nous demandons deux informations car un numéro de suivi seul n'est pas un mot de passe. Chaque tentative de consultation est enregistrée." },

  /* ---- lookup form ------------------------------------------------------ */
  "form.legend": { en: "Shipment lookup", es: "Consulta de envío", fr: "Recherche d'expédition" },
  "form.tracking_number": { en: "Tracking number", es: "Número de seguimiento", fr: "Numéro de suivi" },
  "form.tracking_number_hint": { en: "Format: PL-2026-000458", es: "Formato: PL-2026-000458", fr: "Format : PL-2026-000458" },
  "form.secondary": { en: "Delivery ZIP code or access code", es: "Código postal de entrega o código de acceso", fr: "Code postal de livraison ou code d'accès" },
  "form.secondary_hint": { en: "The ZIP code of the delivery address, or the access code on your confirmation email.", es: "El código postal de la dirección de entrega, o el código de acceso de tu correo de confirmación.", fr: "Le code postal de l'adresse de livraison, ou le code d'accès de votre e-mail de confirmation." },
  "form.submit": { en: "Track shipment", es: "Rastrear envío", fr: "Suivre l'expédition" },
  "form.submitting": { en: "Checking…", es: "Consultando…", fr: "Vérification…" },

  /* ---- result view ------------------------------------------------------ */
  "result.tracking_number": { en: "Tracking number", es: "Número de seguimiento", fr: "Numéro de suivi" },
  "result.current_status": { en: "Current status", es: "Estado actual", fr: "Statut actuel" },
  "result.shipment_type": { en: "Shipment type", es: "Tipo de envío", fr: "Type d'expédition" },
  "result.origin": { en: "Origin", es: "Origen", fr: "Origine" },
  "result.destination": { en: "Destination", es: "Destino", fr: "Destination" },
  "result.estimated_delivery": { en: "Estimated delivery", es: "Entrega estimada", fr: "Livraison estimée" },
  "result.last_update": { en: "Last update", es: "Última actualización", fr: "Dernière mise à jour" },
  "result.timeline_title": { en: "Progress", es: "Progreso", fr: "Progression" },
  "result.summary_title": { en: "Shipment summary", es: "Resumen del envío", fr: "Récapitulatif de l'expédition" },
  "result.contact_title": { en: "Questions about this shipment?", es: "¿Preguntas sobre este envío?", fr: "Des questions sur cette expédition ?" },
  "result.contact_body": { en: "Our dispatch team answers 24/7, including holidays.", es: "Nuestro equipo de dispatch responde 24/7, incluidos los días festivos.", fr: "Notre équipe de régulation répond 24h/24 et 7j/7, jours fériés compris." },
  "result.pickup_appointment": { en: "Pickup appointment", es: "Cita de recogida", fr: "Rendez-vous de chargement" },
  "result.delivery_appointment": { en: "Delivery appointment", es: "Cita de entrega", fr: "Rendez-vous de livraison" },
  "result.equipment": { en: "Equipment", es: "Equipo", fr: "Équipement" },
  "result.commodity": { en: "Commodity", es: "Mercancía", fr: "Marchandise" },
  "result.weight": { en: "Weight", es: "Peso", fr: "Poids" },
  "result.pallets": { en: "Pallets", es: "Palés", fr: "Palettes" },
  "result.reference": { en: "Your reference", es: "Tu referencia", fr: "Votre référence" },
  "result.po_number": { en: "PO number", es: "Número de orden de compra", fr: "Numéro de commande" },
  "result.carrier": { en: "Carrier", es: "Transportista", fr: "Transporteur" },
  "result.carrier_assigned": { en: "Assigned", es: "Asignado", fr: "Assigné" },
  "result.carrier_pending": { en: "Not yet assigned", es: "Aún no asignado", fr: "Pas encore assigné" },
  "result.not_provided": { en: "Not provided", es: "No indicado", fr: "Non renseigné" },
  "result.weight_unit": { en: "lbs", es: "lb", fr: "lb" },
  "result.timeline_truncated": { en: "Showing the most recent updates only.", es: "Mostrando solo las actualizaciones más recientes.", fr: "Seules les mises à jour les plus récentes sont affichées." },
  "result.timeline_empty": { en: "No public updates have been recorded for this shipment yet.", es: "Todavía no se han registrado actualizaciones públicas para este envío.", fr: "Aucune mise à jour publique n'a encore été enregistrée pour cette expédition." },
  "result.delay_title": { en: "This shipment is running late", es: "Este envío va con retraso", fr: "Cette expédition a du retard" },
  "result.delay_minutes": { en: "Running about {minutes} minutes behind schedule.", es: "Aproximadamente {minutes} minutos de retraso.", fr: "Environ {minutes} minutes de retard." },
  "result.exception_title": { en: "There is an issue with this shipment", es: "Hay una incidencia con este envío", fr: "Il y a un problème avec cette expédition" },
  "result.cancelled_title": { en: "This shipment was cancelled", es: "Este envío fue cancelado", fr: "Cette expédition a été annulée" },
  "result.cancelled_body": { en: "Call (908) 404-5373 if you were expecting this freight.", es: "Llama al (908) 404-5373 si esperabas esta carga.", fr: "Appelez le (908) 404-5373 si vous attendiez cette marchandise." },
  "result.search_again": { en: "Track another shipment", es: "Rastrear otro envío", fr: "Suivre une autre expédition" },
  "result.updates_are_manual": { en: "Updates are entered by our dispatch team as milestones are confirmed. This page does not show a live GPS position.", es: "Las actualizaciones las introduce nuestro equipo de dispatch a medida que se confirman los hitos. Esta página no muestra una posición GPS en vivo.", fr: "Les mises à jour sont saisies par notre équipe de régulation à mesure que les étapes sont confirmées. Cette page n'affiche pas de position GPS en direct." },

  /* ---- support message (§8 button, reusing the contact write path) ------ */
  "support.button": { en: "Message support about this shipment", es: "Escribir a soporte sobre este envío", fr: "Écrire au support à propos de cette expédition" },
  "support.title": { en: "Message PickLoads support", es: "Escribir a soporte de PickLoads", fr: "Écrire au support PickLoads" },
  "support.intro": { en: "We reply within one business day — usually much faster. Urgent? Call (908) 404-5373.", es: "Respondemos en un día hábil — normalmente mucho antes. ¿Urgente? Llama al (908) 404-5373.", fr: "Nous répondons sous un jour ouvré — généralement bien plus vite. Urgent ? Appelez le (908) 404-5373." },
  "support.email": { en: "Your email", es: "Tu correo electrónico", fr: "Votre e-mail" },
  "support.name": { en: "Your name", es: "Tu nombre", fr: "Votre nom" },
  "support.message": { en: "Message", es: "Mensaje", fr: "Message" },
  "support.message_placeholder": { en: "What would you like to know about this shipment?", es: "¿Qué te gustaría saber sobre este envío?", fr: "Que souhaitez-vous savoir sur cette expédition ?" },
  "support.send": { en: "Send message", es: "Enviar mensaje", fr: "Envoyer le message" },
  "support.sending": { en: "Sending…", es: "Enviando…", fr: "Envoi…" },
  "support.sent": { en: "Sent — we'll reply to the email address you gave us. Urgent? Call (908) 404-5373.", es: "Enviado — responderemos al correo que nos diste. ¿Urgente? Llama al (908) 404-5373.", fr: "Envoyé — nous répondrons à l'adresse e-mail indiquée. Urgent ? Appelez le (908) 404-5373." },
  "support.close": { en: "Close", es: "Cerrar", fr: "Fermer" },

  /* ---- accessibility (§23) --------------------------------------------- */
  "a11y.timeline_label": { en: "Shipment progress", es: "Progreso del envío", fr: "Progression de l'expédition" },
  "a11y.timeline_summary": { en: "{completed} of {total} steps complete. Current step: {current}.", es: "{completed} de {total} pasos completados. Paso actual: {current}.", fr: "{completed} étapes sur {total} terminées. Étape actuelle : {current}." },
  "a11y.timeline_summary_exception": { en: "{completed} of {total} steps complete. Current step: {current}, which needs attention.", es: "{completed} de {total} pasos completados. Paso actual: {current}, que requiere atención.", fr: "{completed} étapes sur {total} terminées. Étape actuelle : {current}, qui nécessite une attention." },
  "a11y.timeline_summary_cancelled": { en: "This shipment was cancelled after {completed} of {total} steps.", es: "Este envío fue cancelado tras {completed} de {total} pasos.", fr: "Cette expédition a été annulée après {completed} étapes sur {total}." },
  "a11y.timeline_summary_not_started": { en: "No tracking steps have been recorded for this shipment yet.", es: "Aún no se ha registrado ningún paso de seguimiento para este envío.", fr: "Aucune étape de suivi n'a encore été enregistrée pour cette expédition." },
  "a11y.step_complete": { en: "Completed", es: "Completado", fr: "Terminé" },
  "a11y.step_current": { en: "Current step", es: "Paso actual", fr: "Étape actuelle" },
  "a11y.step_exception": { en: "Current step, needs attention", es: "Paso actual, requiere atención", fr: "Étape actuelle, nécessite une attention" },
  "a11y.step_upcoming": { en: "Not started", es: "No iniciado", fr: "Non commencé" },
  "a11y.status_region": { en: "Shipment tracking result", es: "Resultado del seguimiento del envío", fr: "Résultat du suivi d'expédition" },
  "a11y.event_list": { en: "Update history", es: "Historial de actualizaciones", fr: "Historique des mises à jour" },

  /* ---- errors (§19 — ONE refusal, whatever went wrong) ------------------ */
  "error.refused": { en: "We couldn't match that tracking number and verification value. Check both and try again, or call (908) 404-5373.", es: "No pudimos encontrar esa combinación de número de seguimiento y valor de verificación. Revisa ambos e inténtalo de nuevo, o llama al (908) 404-5373.", fr: "Nous n'avons pas pu faire correspondre ce numéro de suivi et cette valeur de vérification. Vérifiez les deux et réessayez, ou appelez le (908) 404-5373." },
  "error.rate_limited": { en: "Too many tracking attempts from your network. Please wait a few minutes and try again — or call (908) 404-5373.", es: "Demasiados intentos de seguimiento desde tu red. Espera unos minutos e inténtalo de nuevo — o llama al (908) 404-5373.", fr: "Trop de tentatives de suivi depuis votre réseau. Attendez quelques minutes et réessayez — ou appelez le (908) 404-5373." },
  "error.turnstile": { en: "We couldn't verify your submission. Please refresh the page and try again.", es: "No pudimos verificar tu envío. Actualiza la página e inténtalo de nuevo.", fr: "Nous n'avons pas pu vérifier votre envoi. Actualisez la page et réessayez." },
  "error.unavailable": { en: "Tracking is temporarily unavailable. Please try again shortly, or call (908) 404-5373.", es: "El seguimiento no está disponible temporalmente. Inténtalo de nuevo en breve, o llama al (908) 404-5373.", fr: "Le suivi est temporairement indisponible. Réessayez sous peu, ou appelez le (908) 404-5373." },
  "error.invalid": { en: "Enter your tracking number and the delivery ZIP or access code.", es: "Introduce tu número de seguimiento y el código postal de entrega o el código de acceso.", fr: "Saisissez votre numéro de suivi et le code postal de livraison ou le code d'accès." },

  /* ======================================================================
   * M-76 — §13's carrier + driver update experience.
   *
   * SAME LOCALE POLICY as M-73's block above: en/es/fr AUTHORED, ru/ht
   * MIRROR ENGLISH and are flagged for native review in
   * docs/LAUNCH-RUNBOOK.md. §24 forbids silent machine translation, and a
   * driver reading plausible-sounding machine Russian about which freight to
   * pick up is exactly the failure that rule exists to prevent.
   *
   * WHY THE DRIVER PAGE IS IN THE CATALOGUE AT ALL. It is the most
   * customer-facing surface this system has: no account, one hand, a phone at
   * a dock. The plan's own words — drivers are "exactly the population the
   * 5-locale requirement exists for". Every string a driver can see is here;
   * `src/app/actions/driver-updates.ts` returns message KEYS rather than
   * English sentences so a refusal is translated too, which is M-73's rule
   * for /track applied to the one surface that needs it more.
   * ====================================================================== */

  /* ---- §13's allowed actions (`carrier-updates.ts` label keys) ---------- */
  "action.confirm_dispatch": { en: "Confirm dispatch", es: "Confirmar despacho", fr: "Confirmer la prise en charge" },
  "action.en_route_to_pickup": { en: "En route to pickup", es: "En camino a la recogida", fr: "En route vers le chargement" },
  "action.arrived_at_pickup": { en: "Arrived at pickup", es: "Llegué a la recogida", fr: "Arrivé au chargement" },
  "action.loaded": { en: "Loaded", es: "Cargado", fr: "Chargé" },
  "action.departed_pickup": { en: "Departed pickup", es: "Salí de la recogida", fr: "Parti du chargement" },
  "action.in_transit": { en: "In transit", es: "En tránsito", fr: "En transit" },
  "action.delayed": { en: "Report a delay", es: "Reportar un retraso", fr: "Signaler un retard" },
  "action.arrived_at_delivery": { en: "Arrived at delivery", es: "Llegué a la entrega", fr: "Arrivé à la livraison" },
  "action.unloading": { en: "Unloading", es: "Descargando", fr: "Déchargement" },
  "action.delivered": { en: "Delivered", es: "Entregado", fr: "Livré" },
  "action.update_eta": { en: "Update ETA", es: "Actualizar la hora estimada", fr: "Mettre à jour l'heure estimée" },
  "action.submit_exception": { en: "Report a problem", es: "Reportar un problema", fr: "Signaler un problème" },
  "action.upload_bol": { en: "Upload BOL", es: "Subir el conocimiento de embarque", fr: "Téléverser la lettre de voiture" },
  "action.upload_pod": { en: "Upload POD", es: "Subir la prueba de entrega", fr: "Téléverser la preuve de livraison" },

  /* ---- §9/§13 consent states (M-70's `TrackingConsentStatus`) ---------- */
  "consent.pending": { en: "Not answered yet", es: "Sin responder", fr: "Sans réponse" },
  "consent.granted": { en: "Sharing location", es: "Compartiendo ubicación", fr: "Partage de position activé" },
  "consent.denied": { en: "Not sharing location", es: "Sin compartir ubicación", fr: "Partage de position refusé" },
  "consent.revoked": { en: "Sharing withdrawn", es: "Compartir retirado", fr: "Partage retiré" },
  "consent.expired": { en: "Consent expired", es: "Consentimiento caducado", fr: "Consentement expiré" },
  "consent.not_required": { en: "Not required", es: "No necesario", fr: "Non requis" },

  /* ---- the driver page (§13, §22 phone-first, §23, §30) ---------------- */
  "driver.meta_title": { en: "Shipment update — PickLoads", es: "Actualizar envío — PickLoads", fr: "Mise à jour d'expédition — PickLoads" },
  "driver.title": { en: "Shipment update", es: "Actualizar el envío", fr: "Mise à jour de l'expédition" },
  "driver.intro": { en: "Tap what just happened. Dispatch sees it straight away.", es: "Toca lo que acaba de pasar. Dispatch lo ve enseguida.", fr: "Touchez ce qui vient de se passer. La régulation le voit aussitôt." },
  "driver.for_driver": { en: "Link for {name}", es: "Enlace para {name}", fr: "Lien pour {name}" },
  "driver.shipment": { en: "Shipment", es: "Envío", fr: "Expédition" },
  "driver.current_status": { en: "Right now", es: "Ahora mismo", fr: "En ce moment" },
  "driver.pickup": { en: "Pickup", es: "Recogida", fr: "Chargement" },
  "driver.delivery": { en: "Delivery", es: "Entrega", fr: "Livraison" },
  "driver.equipment": { en: "Equipment", es: "Equipo", fr: "Équipement" },
  "driver.appointment": { en: "Appointment", es: "Cita", fr: "Rendez-vous" },
  "driver.expires": { en: "This link stops working on {when}.", es: "Este enlace deja de funcionar el {when}.", fr: "Ce lien cesse de fonctionner le {when}." },
  "driver.no_money": { en: "This page never shows rates, invoices or anything about the customer's price.", es: "Esta página nunca muestra tarifas, facturas ni el precio del cliente.", fr: "Cette page n'affiche jamais de tarifs, de factures ni le prix du client." },
  "driver.honest_note": { en: "Updates are what you type here. This page does not track your phone and does not show a live GPS position.", es: "Las actualizaciones son lo que escribes aquí. Esta página no rastrea tu teléfono ni muestra una posición GPS en vivo.", fr: "Les mises à jour sont ce que vous saisissez ici. Cette page ne suit pas votre téléphone et n'affiche aucune position GPS en direct." },
  "driver.docs_deferred": { en: "Photo upload for BOL and POD is not built yet — send those to dispatch the way you do today.", es: "La carga de fotos del conocimiento de embarque y la prueba de entrega aún no está lista — envíalos a dispatch como siempre.", fr: "L'envoi de photos de la lettre de voiture et de la preuve de livraison n'existe pas encore — transmettez-les à la régulation comme d'habitude." },
  "driver.call": { en: "Call dispatch", es: "Llamar a dispatch", fr: "Appeler la régulation" },

  /* ---- the update form ------------------------------------------------- */
  "driver.status_legend": { en: "What just happened?", es: "¿Qué acaba de pasar?", fr: "Que vient-il de se passer ?" },
  "driver.no_actions": { en: "There is nothing to update on this shipment right now. Call (908) 404-5373 if that looks wrong.", es: "Ahora mismo no hay nada que actualizar en este envío. Llama al (908) 404-5373 si crees que es un error.", fr: "Il n'y a rien à mettre à jour sur cette expédition pour le moment. Appelez le (908) 404-5373 si cela vous semble incorrect." },
  "driver.note": { en: "Anything dispatch should know? (optional)", es: "¿Algo que dispatch deba saber? (opcional)", fr: "Quelque chose à signaler à la régulation ? (facultatif)" },
  "driver.note_placeholder": { en: "Door 14, waiting on a forklift", es: "Puerta 14, esperando un montacargas", fr: "Quai 14, en attente d'un chariot élévateur" },
  "driver.location_legend": { en: "Where are you?", es: "¿Dónde estás?", fr: "Où êtes-vous ?" },
  "driver.city": { en: "City", es: "Ciudad", fr: "Ville" },
  "driver.state": { en: "State", es: "Estado", fr: "État" },
  "driver.submit": { en: "Send update", es: "Enviar actualización", fr: "Envoyer la mise à jour" },
  "driver.sending": { en: "Sending…", es: "Enviando…", fr: "Envoi…" },
  "driver.saved": { en: "Sent. Dispatch has it.", es: "Enviado. Dispatch ya lo tiene.", fr: "Envoyé. La régulation l'a reçu." },
  "driver.reported": { en: "Reported. Dispatch will call you if they need more.", es: "Reportado. Dispatch te llamará si necesita más.", fr: "Signalé. La régulation vous appellera si besoin." },

  /* ---- §9/§13 consent, actively granted -------------------------------- */
  "driver.consent_title": { en: "Sharing your location", es: "Compartir tu ubicación", fr: "Partage de votre position" },
  "driver.consent_body": { en: "You choose. If you turn this on, the city and state you type are shared with dispatch and with the customer's tracking page. Nothing is read from your phone, and you can turn it off again at any time.", es: "Tú decides. Si lo activas, la ciudad y el estado que escribas se comparten con dispatch y con la página de seguimiento del cliente. No se lee nada de tu teléfono y puedes desactivarlo cuando quieras.", fr: "C'est vous qui décidez. Si vous l'activez, la ville et l'état que vous saisissez sont partagés avec la régulation et avec la page de suivi du client. Rien n'est lu depuis votre téléphone et vous pouvez le désactiver à tout moment." },
  "driver.consent_checkbox": { en: "Share the city and state I type", es: "Compartir la ciudad y el estado que escriba", fr: "Partager la ville et l'état que je saisis" },
  "driver.consent_save": { en: "Save my choice", es: "Guardar mi decisión", fr: "Enregistrer mon choix" },
  "driver.consent_state": { en: "Your choice", es: "Tu decisión", fr: "Votre choix" },
  "driver.consent_on": { en: "Saved — you are sharing the city and state you type.", es: "Guardado — estás compartiendo la ciudad y el estado que escribas.", fr: "Enregistré — vous partagez la ville et l'état que vous saisissez." },
  "driver.consent_off": { en: "Saved — your location stays off. You can still send status updates.", es: "Guardado — tu ubicación queda desactivada. Puedes seguir enviando actualizaciones de estado.", fr: "Enregistré — votre position reste désactivée. Vous pouvez toujours envoyer des mises à jour de statut." },
  "driver.consent_required": { en: "Turn on location sharing above before sending a city and state — or send the update without them.", es: "Activa arriba el compartir ubicación antes de enviar una ciudad y un estado — o envía la actualización sin ellos.", fr: "Activez le partage de position ci-dessus avant d'envoyer une ville et un état — ou envoyez la mise à jour sans eux." },

  /* ---- ETA + exception ------------------------------------------------- */
  "driver.eta_legend": { en: "Update your ETA", es: "Actualizar tu hora estimada", fr: "Mettre à jour votre heure estimée" },
  "driver.eta_kind": { en: "Which stop?", es: "¿Qué parada?", fr: "Quel arrêt ?" },
  "driver.eta_at": { en: "New estimated time", es: "Nueva hora estimada", fr: "Nouvelle heure estimée" },
  "driver.delay_minutes": { en: "Minutes behind (optional)", es: "Minutos de retraso (opcional)", fr: "Minutes de retard (facultatif)" },
  "driver.eta_submit": { en: "Send ETA", es: "Enviar la hora estimada", fr: "Envoyer l'heure estimée" },
  "driver.exception_legend": { en: "Report a problem", es: "Reportar un problema", fr: "Signaler un problème" },
  "driver.exception_type": { en: "What is wrong?", es: "¿Qué pasa?", fr: "Quel est le problème ?" },
  "driver.exception_description": { en: "Tell dispatch what happened", es: "Cuéntale a dispatch qué pasó", fr: "Expliquez à la régulation ce qui s'est passé" },
  "driver.exception_submit": { en: "Send to dispatch", es: "Enviar a dispatch", fr: "Envoyer à la régulation" },
  "driver.exception_note": { en: "Dispatch decides how urgent this is and tells the customer.", es: "Dispatch decide qué tan urgente es y avisa al cliente.", fr: "La régulation évalue l'urgence et informe le client." },

  /* ---- refusals (§13 non-enumerable — ONE message for four causes) ----- */
  "driver.expired_body": { en: "This link no longer works. Ask dispatch to send you a new one, or call (908) 404-5373.", es: "Este enlace ya no funciona. Pídele a dispatch uno nuevo o llama al (908) 404-5373.", fr: "Ce lien ne fonctionne plus. Demandez-en un nouveau à la régulation ou appelez le (908) 404-5373." },
  "driver.rate_limited": { en: "Too many tries from this network. Wait a few minutes, or call (908) 404-5373.", es: "Demasiados intentos desde esta red. Espera unos minutos o llama al (908) 404-5373.", fr: "Trop de tentatives depuis ce réseau. Attendez quelques minutes ou appelez le (908) 404-5373." },
  "driver.unavailable": { en: "Updates are temporarily unavailable. Call (908) 404-5373 and we'll take it by phone.", es: "Las actualizaciones no están disponibles temporalmente. Llama al (908) 404-5373 y lo tomamos por teléfono.", fr: "Les mises à jour sont temporairement indisponibles. Appelez le (908) 404-5373 et nous la prendrons par téléphone." },
  "driver.stale": { en: "Someone else updated this shipment. Reload the page and check before sending again.", es: "Alguien más actualizó este envío. Recarga la página y revisa antes de enviar otra vez.", fr: "Quelqu'un d'autre a mis à jour cette expédition. Rechargez la page et vérifiez avant de renvoyer." },
  "driver.not_allowed": { en: "That change has to come from your dispatcher. Call (908) 404-5373.", es: "Ese cambio lo tiene que hacer tu dispatcher. Llama al (908) 404-5373.", fr: "Ce changement doit venir de votre régulateur. Appelez le (908) 404-5373." },
  "driver.not_now": { en: "That update doesn't fit where this load is right now. Reload the page.", es: "Esa actualización no coincide con el estado actual de esta carga. Recarga la página.", fr: "Cette mise à jour ne correspond pas à l'état actuel de ce chargement. Rechargez la page." },
  "driver.invalid": { en: "We couldn't record that. Reload the page and try again.", es: "No pudimos registrarlo. Recarga la página e inténtalo de nuevo.", fr: "Nous n'avons pas pu l'enregistrer. Rechargez la page et réessayez." },

  /* ---- the carrier portal shipment surface (§13) ----------------------- */
  "carrier.crumb": { en: "Carrier portal", es: "Portal del carrier", fr: "Portail transporteur" },
  "carrier.title": { en: "Shipments", es: "Envíos", fr: "Expéditions" },
  "carrier.intro": { en: "Brokerage freight assigned to you. Update a shipment here, or send your driver a link.", es: "Carga de brokerage asignada a ti. Actualiza un envío aquí o envíale un enlace a tu conductor.", fr: "Fret de courtage qui vous est assigné. Mettez à jour une expédition ici, ou envoyez un lien à votre chauffeur." },
  "carrier.gate_notice": { en: "Brokerage shipments start once our FMCSA broker authority and BMC-84 bond are active. Your dispatch loads are on the Loads page, not here.", es: "Los envíos de brokerage comenzarán cuando nuestra autoridad de broker FMCSA y la fianza BMC-84 estén activas. Tus cargas de dispatch están en la página de Cargas, no aquí.", fr: "Les expéditions de courtage débuteront dès l'activation de notre autorité de courtier FMCSA et de notre caution BMC-84. Vos chargements dispatch sont sur la page Chargements, pas ici." },
  "carrier.no_record": { en: "Your account isn't linked to a carrier record yet. Our team activates the link during document review — or call (908) 404-5373.", es: "Tu cuenta aún no está vinculada a un registro de transportista. Nuestro equipo activa el vínculo durante la revisión de documentos — o llama al (908) 404-5373.", fr: "Votre compte n'est pas encore lié à une fiche transporteur. Notre équipe active le lien lors de la vérification des documents — ou appelez le (908) 404-5373." },
  "carrier.empty": { en: "No brokerage shipments are assigned to you yet.", es: "Todavía no tienes envíos de brokerage asignados.", fr: "Aucune expédition de courtage ne vous est encore assignée." },
  "carrier.empty_filtered": { en: "No shipments match those filters.", es: "Ningún envío coincide con esos filtros.", fr: "Aucune expédition ne correspond à ces filtres." },
  "carrier.failed": { en: "We couldn't load your shipments. Reload the page, or call (908) 404-5373.", es: "No pudimos cargar tus envíos. Recarga la página o llama al (908) 404-5373.", fr: "Nous n'avons pas pu charger vos expéditions. Rechargez la page ou appelez le (908) 404-5373." },
  "carrier.lane": { en: "Lane", es: "Ruta", fr: "Trajet" },
  "carrier.open": { en: "Open", es: "Abrir", fr: "Ouvrir" },
  "carrier.back": { en: "All shipments", es: "Todos los envíos", fr: "Toutes les expéditions" },
  "carrier.filters_legend": { en: "Filter shipments", es: "Filtrar envíos", fr: "Filtrer les expéditions" },
  "carrier.filter_apply": { en: "Apply", es: "Aplicar", fr: "Appliquer" },
  "carrier.showing": { en: "Showing {from}–{to} of {total}", es: "Mostrando {from}–{to} de {total}", fr: "Affichage de {from} à {to} sur {total}" },
  "carrier.prev": { en: "Newer", es: "Más recientes", fr: "Plus récentes" },
  "carrier.next": { en: "Older", es: "Más antiguos", fr: "Plus anciennes" },
  "carrier.pay": { en: "Your pay", es: "Tu pago", fr: "Votre paiement" },
  "carrier.pay_note": { en: "This is your contracted pay. The customer's price and our margin are not shown here and are not part of your rate confirmation.", es: "Este es tu pago contratado. El precio del cliente y nuestro margen no se muestran aquí ni forman parte de tu confirmación de tarifa.", fr: "Il s'agit de votre paiement contractuel. Le prix du client et notre marge ne sont pas affichés ici et ne font pas partie de votre confirmation de tarif." },
  "carrier.summary_title": { en: "Shipment details", es: "Detalles del envío", fr: "Détails de l'expédition" },
  "carrier.timeline_title": { en: "Update history", es: "Historial de actualizaciones", fr: "Historique des mises à jour" },
  "carrier.timeline_empty": { en: "Nothing has been recorded on this shipment yet.", es: "Todavía no se ha registrado nada en este envío.", fr: "Rien n'a encore été enregistré sur cette expédition." },
  "carrier.timeline_more": { en: "Show older", es: "Mostrar más antiguos", fr: "Afficher plus anciennes" },
  "carrier.timeline_reset": { en: "Back to newest", es: "Volver a los más recientes", fr: "Revenir aux plus récentes" },
  "carrier.update_legend": { en: "Record an update", es: "Registrar una actualización", fr: "Enregistrer une mise à jour" },
  "carrier.update_choose": { en: "What happened?", es: "¿Qué pasó?", fr: "Que s'est-il passé ?" },
  "carrier.no_actions": { en: "There is nothing to update on this shipment right now.", es: "Ahora mismo no hay nada que actualizar en este envío.", fr: "Il n'y a rien à mettre à jour sur cette expédition pour le moment." },
  "carrier.links_title": { en: "Driver links", es: "Enlaces para conductores", fr: "Liens chauffeur" },
  "carrier.links_body": { en: "A driver link lets one driver update this one shipment from their phone, with no account. It expires on its own, you can revoke it at any time, and it never shows money.", es: "Un enlace para conductor permite que un conductor actualice solo este envío desde su teléfono, sin cuenta. Caduca solo, puedes revocarlo cuando quieras y nunca muestra dinero.", fr: "Un lien chauffeur permet à un chauffeur de mettre à jour cette seule expédition depuis son téléphone, sans compte. Il expire de lui-même, vous pouvez le révoquer à tout moment, et il n'affiche jamais de montants." },
  "carrier.links_once": { en: "The link is shown once, when you create it. We store only a fingerprint of it, so it cannot be looked up again — create a new one instead.", es: "El enlace se muestra una sola vez, al crearlo. Solo guardamos una huella suya, así que no se puede volver a consultar — crea uno nuevo.", fr: "Le lien s'affiche une seule fois, à sa création. Nous n'en conservons qu'une empreinte : il ne peut pas être retrouvé — créez-en un nouveau." },
  "carrier.issue_link": { en: "Create a driver link", es: "Crear un enlace para el conductor", fr: "Créer un lien chauffeur" },
  "carrier.driver_name": { en: "Driver name (optional)", es: "Nombre del conductor (opcional)", fr: "Nom du chauffeur (facultatif)" },
  "carrier.no_links": { en: "No driver links have been created for this shipment.", es: "No se han creado enlaces de conductor para este envío.", fr: "Aucun lien chauffeur n'a été créé pour cette expédition." },
  "carrier.link_revoke": { en: "Revoke", es: "Revocar", fr: "Révoquer" },
  "carrier.link_state": { en: "Status", es: "Estado", fr: "Statut" },
  "carrier.link_active": { en: "Active", es: "Activo", fr: "Actif" },
  "carrier.link_expired": { en: "Expired", es: "Caducado", fr: "Expiré" },
  "carrier.link_revoked": { en: "Revoked", es: "Revocado", fr: "Révoqué" },
  "carrier.link_expires": { en: "Expires", es: "Caduca", fr: "Expire" },
  "carrier.link_uses": { en: "Times used", es: "Veces usado", fr: "Utilisations" },
  "carrier.link_driver": { en: "Driver", es: "Conductor", fr: "Chauffeur" },
  "carrier.link_consent": { en: "Location sharing", es: "Compartir ubicación", fr: "Partage de position" },
  "carrier.docs_deferred": { en: "BOL and POD upload is not built yet. Keep sending documents to dispatch the way you do today — we'll tell you when it lands here.", es: "La carga del conocimiento de embarque y la prueba de entrega aún no está lista. Sigue enviando los documentos a dispatch como siempre — te avisaremos cuando esté aquí.", fr: "L'envoi de la lettre de voiture et de la preuve de livraison n'existe pas encore. Continuez à transmettre les documents à la régulation comme d'habitude — nous vous préviendrons quand ce sera disponible." },
};

const ALL_LOCALES = ["en", ...LOCALES];
const shipmentCatalogs = Object.fromEntries(ALL_LOCALES.map((l) => [l, {}]));

function setNested(target, path, value) {
  const parts = path.split(".");
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    node[parts[i]] ??= {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
}

let shipmentMirrored = 0;
for (const [path, tr] of Object.entries(SHIPMENT)) {
  if (!tr.en) throw new Error(`shipment catalogue: missing English for ${path}`);
  for (const l of ALL_LOCALES) {
    const value = tr[l];
    if (l !== "en" && value === undefined) shipmentMirrored++;
    setNested(shipmentCatalogs[l], path, value ?? tr.en);
  }
}

mkdirSync("messages", { recursive: true });
for (const [l, cat] of Object.entries(catalogs)) {
  const sorted = Object.fromEntries(Object.entries(cat).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(
    `messages/${l}.json`,
    JSON.stringify({ v4: sorted, shipment: shipmentCatalogs[l] }, null, 2) + "\n",
  );
}
writeFileSync("messages/_key-index.json", JSON.stringify(keyIndex, null, 2) + "\n");
console.log(`extracted ${Object.keys(catalogs.en).length} strings × ${1 + LOCALES.length} locales`);
console.log(
  `shipment namespace: ${Object.keys(SHIPMENT).length} keys × ${ALL_LOCALES.length} locales ` +
    `(${shipmentMirrored} locale slots mirror English pending native review — see docs/LAUNCH-RUNBOOK.md)`,
);
