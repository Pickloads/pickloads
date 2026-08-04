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
  "if you requested one under a different address, call (908) 404-5373 and we'll link it.": {
    es: "si la pediste con otra dirección, llama al (908) 404-5373 y la vinculamos.",
    fr: "si vous l'avez demandée avec une autre adresse, appelez le (908) 404-5373 et nous la lierons.",
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
