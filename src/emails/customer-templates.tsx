import { CustomerEmail } from "./CustomerEmail";
import {
  pick,
  type BuiltEmail,
  type EmailDict,
  type EmailLocale,
} from "./i18n";
import type { DocType } from "@/lib/supabase/database.types";

/**
 * M-60 — the customer-facing template suite (directive §emails). Each
 * builder returns `{ subject, template, react }` in the recipient's
 * language (en/es/fr authored; ru/ht mirror en — see i18n.ts). Senders pass
 * the result straight to `sendEmail` (email_log journaling included there).
 *
 * NOTE — auth emails (verify-email, password reset) are SENT BY SUPABASE,
 * not by the app; they are branded by customizing the Supabase Auth email
 * templates in the dashboard (docs/LAUNCH-RUNBOOK.md §Supabase email
 * templates). No app-side template exists on purpose.
 */

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pickloads.com";

/* ------------------------------------------------------------------ */
/* Shared localized fragments                                          */
/* ------------------------------------------------------------------ */

export const DOC_LABEL_DICT: EmailDict<Record<DocType, string>> = {
  en: {
    mc_authority: "MC Authority letter",
    coi: "Certificate of Insurance",
    w9: "W-9",
    voided_check: "Voided check / bank letter",
    noa: "Notice of Assignment",
    dispatch_agreement: "Dispatch agreement",
    other: "Document",
  },
  es: {
    mc_authority: "Carta de autoridad MC",
    coi: "Certificado de seguro",
    w9: "W-9",
    voided_check: "Cheque anulado / carta bancaria",
    noa: "Aviso de cesión (NOA)",
    dispatch_agreement: "Acuerdo de dispatch",
    other: "Documento",
  },
  fr: {
    mc_authority: "Lettre d'autorité MC",
    coi: "Certificat d'assurance",
    w9: "W-9",
    voided_check: "Chèque annulé / lettre bancaire",
    noa: "Avis de cession (NOA)",
    dispatch_agreement: "Accord de dispatch",
    other: "Document",
  },
};

/** Shipper-facing quote stages (mirrors src/lib/shipper-quotes.ts mapping). */
export type QuoteStage = "received" | "in_review" | "quoted" | "booked" | "closed";

export const QUOTE_STAGE_DICT: EmailDict<Record<QuoteStage, string>> = {
  en: {
    received: "Received",
    in_review: "In review",
    quoted: "Quoted — rate ready",
    booked: "Booked",
    closed: "Closed",
  },
  es: {
    received: "Recibida",
    in_review: "En revisión",
    quoted: "Cotizada — tarifa lista",
    booked: "Reservada",
    closed: "Cerrada",
  },
  fr: {
    received: "Reçue",
    in_review: "En cours d'examen",
    quoted: "Devis prêt",
    booked: "Réservée",
    closed: "Clôturée",
  },
};

/* ------------------------------------------------------------------ */
/* 1–2. Welcome (carrier / shipper)                                    */
/* ------------------------------------------------------------------ */

export function buildWelcomeCarrierEmail(
  locale: EmailLocale,
  p: { fullName: string | null; companyName: string },
): BuiltEmail {
  const d = pick<{
    subject: string;
    eyebrow: string;
    title: (n: string | null) => string;
    p1: (c: string) => string;
    p2: string;
    cta: string;
  }>(
    {
      en: {
        subject: "Welcome to PickLoads — your carrier account is ready",
        eyebrow: "Welcome aboard",
        title: (n) => `Welcome${n ? `, ${n}` : ""} — let's keep your truck loaded`,
        p1: (c) =>
          `Your PickLoads carrier account for ${c} is created. Verify your email (separate message), sign in, and your dispatcher takes it from there.`,
        p2: "Your portal shows onboarding progress, documents, loads, invoices and a direct line to the dispatch desk.",
        cta: "Open your carrier portal",
      },
      es: {
        subject: "Bienvenido a PickLoads — tu cuenta de carrier está lista",
        eyebrow: "Bienvenido a bordo",
        title: (n) => `Bienvenido${n ? `, ${n}` : ""} — mantengamos tu camión cargado`,
        p1: (c) =>
          `Tu cuenta de carrier de PickLoads para ${c} está creada. Verifica tu correo (mensaje aparte), inicia sesión y tu dispatcher se encarga del resto.`,
        p2: "Tu portal muestra el progreso de registro, documentos, cargas, facturas y una línea directa con la mesa de dispatch.",
        cta: "Abrir tu portal de carrier",
      },
      fr: {
        subject: "Bienvenue chez PickLoads — votre compte transporteur est prêt",
        eyebrow: "Bienvenue à bord",
        title: (n) => `Bienvenue${n ? `, ${n}` : ""} — gardons votre camion chargé`,
        p1: (c) =>
          `Votre compte transporteur PickLoads pour ${c} est créé. Vérifiez votre e-mail (message séparé), connectez-vous, et votre dispatcher s'occupe du reste.`,
        p2: "Votre portail affiche l'avancement de l'inscription, les documents, les chargements, les factures et une ligne directe avec le bureau dispatch.",
        cta: "Ouvrir votre portail transporteur",
      },
    },
    locale,
  );
  return {
    subject: d.subject,
    template: "welcome-carrier",
    react: (
      <CustomerEmail
        locale={locale}
        eyebrow={d.eyebrow}
        title={d.title(p.fullName)}
        preview={d.subject}
        paragraphs={[d.p1(p.companyName), d.p2]}
        cta={{ label: d.cta, url: `${SITE}/portal/carrier` }}
      />
    ),
  };
}

export function buildWelcomeShipperEmail(
  locale: EmailLocale,
  p: { fullName: string | null; companyName: string },
): BuiltEmail {
  const d = pick<{
    subject: string;
    eyebrow: string;
    title: (n: string | null) => string;
    p1: (c: string) => string;
    p2: string;
    cta: string;
  }>(
    {
      en: {
        subject: "Welcome to PickLoads — your shipper account is ready",
        eyebrow: "Welcome aboard",
        title: (n) => `Welcome${n ? `, ${n}` : ""} — request quotes in minutes`,
        p1: (c) =>
          `Your PickLoads shipper account for ${c} is created. Verify your email (separate message) and sign in to request freight quotes and track their status.`,
        p2: "A dispatcher reviews every request and calls back with a firm rate — usually within one business hour.",
        cta: "Open your shipper portal",
      },
      es: {
        subject: "Bienvenido a PickLoads — tu cuenta de shipper está lista",
        eyebrow: "Bienvenido a bordo",
        title: (n) => `Bienvenido${n ? `, ${n}` : ""} — cotiza en minutos`,
        p1: (c) =>
          `Tu cuenta de shipper de PickLoads para ${c} está creada. Verifica tu correo (mensaje aparte) e inicia sesión para pedir cotizaciones de flete y seguir su estado.`,
        p2: "Un dispatcher revisa cada solicitud y te llama con una tarifa firme — normalmente en una hora hábil.",
        cta: "Abrir tu portal de shipper",
      },
      fr: {
        subject: "Bienvenue chez PickLoads — votre compte expéditeur est prêt",
        eyebrow: "Bienvenue à bord",
        title: (n) => `Bienvenue${n ? `, ${n}` : ""} — demandez des devis en quelques minutes`,
        p1: (c) =>
          `Votre compte expéditeur PickLoads pour ${c} est créé. Vérifiez votre e-mail (message séparé) puis connectez-vous pour demander des devis de fret et suivre leur statut.`,
        p2: "Un dispatcher examine chaque demande et vous rappelle avec un tarif ferme — généralement sous une heure ouvrée.",
        cta: "Ouvrir votre portail expéditeur",
      },
    },
    locale,
  );
  return {
    subject: d.subject,
    template: "welcome-shipper",
    react: (
      <CustomerEmail
        locale={locale}
        eyebrow={d.eyebrow}
        title={d.title(p.fullName)}
        preview={d.subject}
        paragraphs={[d.p1(p.companyName), d.p2]}
        cta={{ label: d.cta, url: `${SITE}/portal/shipper` }}
      />
    ),
  };
}

/* ------------------------------------------------------------------ */
/* 3. Onboarding started                                               */
/* ------------------------------------------------------------------ */

export function buildOnboardingStartedEmail(
  locale: EmailLocale,
  p: { fullName: string | null; companyName: string },
): BuiltEmail {
  const d = pick<{
    subject: string;
    eyebrow: string;
    title: string;
    p1: (c: string) => string;
    p2: string;
    cta: string;
  }>(
    {
      en: {
        subject: "Your PickLoads onboarding has started",
        eyebrow: "Onboarding",
        title: "You're on the way — onboarding started",
        p1: (c) =>
          `We've started onboarding for ${c}: company info received. Next: your documents (MC letter, COI, W-9, voided check), the plain-English dispatch agreement, then your portal account.`,
        p2: "It takes about 10 minutes end to end. Prefer a human? Call (908) 404-5373 and we'll finish it with you over the phone.",
        cta: "Continue onboarding",
      },
      es: {
        subject: "Tu registro en PickLoads ha comenzado",
        eyebrow: "Registro",
        title: "Ya estás en camino — registro iniciado",
        p1: (c) =>
          `Comenzamos el registro de ${c}: datos de la empresa recibidos. Siguiente: tus documentos (carta MC, COI, W-9, cheque anulado), el acuerdo de dispatch en lenguaje claro y tu cuenta del portal.`,
        p2: "Toma unos 10 minutos en total. ¿Prefieres hablar con alguien? Llama al (908) 404-5373 y lo terminamos por teléfono.",
        cta: "Continuar el registro",
      },
      fr: {
        subject: "Votre inscription PickLoads a commencé",
        eyebrow: "Inscription",
        title: "C'est parti — inscription commencée",
        p1: (c) =>
          `Nous avons commencé l'inscription de ${c} : infos de l'entreprise reçues. Ensuite : vos documents (lettre MC, COI, W-9, chèque annulé), l'accord de dispatch en langage clair, puis votre compte portail.`,
        p2: "Comptez environ 10 minutes au total. Vous préférez parler à quelqu'un ? Appelez le (908) 404-5373 et nous terminerons par téléphone.",
        cta: "Continuer l'inscription",
      },
    },
    locale,
  );
  return {
    subject: d.subject,
    template: "onboarding-started-customer",
    react: (
      <CustomerEmail
        locale={locale}
        eyebrow={d.eyebrow}
        title={d.title}
        preview={d.subject}
        paragraphs={[d.p1(p.companyName), d.p2]}
        cta={{ label: d.cta, url: `${SITE}/become-a-carrier` }}
      />
    ),
  };
}

/* ------------------------------------------------------------------ */
/* 4. Documents received (single replacement OR wizard batch)          */
/* ------------------------------------------------------------------ */

export function buildDocumentsReceivedEmail(
  locale: EmailLocale,
  p: { docType: DocType | null },
): BuiltEmail {
  const label = p.docType ? pick(DOC_LABEL_DICT, locale)[p.docType] : null;
  const d = pick<{
    subject: string;
    eyebrow: string;
    title: string;
    single: (l: string) => string;
    batch: string;
    p2: string;
    cta: string;
  }>(
    {
      en: {
        subject: "Documents received — under review",
        eyebrow: "Documents",
        title: "Got it — your documents are in review",
        single: (l) => `We received your ${l}. Our compliance team reviews it and you'll get an email either way.`,
        batch:
          "We received your onboarding documents. Our compliance team reviews them and you'll get an email either way.",
        p2: "Reviews normally finish the same business day. Track status any time in your portal.",
        cta: "View my documents",
      },
      es: {
        subject: "Documentos recibidos — en revisión",
        eyebrow: "Documentos",
        title: "Recibido — tus documentos están en revisión",
        single: (l) => `Recibimos tu ${l}. Nuestro equipo de cumplimiento lo revisa y te avisaremos por correo en cualquier caso.`,
        batch:
          "Recibimos tus documentos de registro. Nuestro equipo de cumplimiento los revisa y te avisaremos por correo en cualquier caso.",
        p2: "Las revisiones normalmente terminan el mismo día hábil. Sigue el estado en tu portal.",
        cta: "Ver mis documentos",
      },
      fr: {
        subject: "Documents reçus — en cours d'examen",
        eyebrow: "Documents",
        title: "Bien reçu — vos documents sont en cours d'examen",
        single: (l) => `Nous avons reçu votre ${l}. Notre équipe conformité l'examine et vous recevrez un e-mail dans tous les cas.`,
        batch:
          "Nous avons reçu vos documents d'inscription. Notre équipe conformité les examine et vous recevrez un e-mail dans tous les cas.",
        p2: "Les examens se terminent normalement le jour ouvré même. Suivez le statut dans votre portail.",
        cta: "Voir mes documents",
      },
    },
    locale,
  );
  return {
    subject: d.subject,
    template: "documents-received",
    react: (
      <CustomerEmail
        locale={locale}
        eyebrow={d.eyebrow}
        title={d.title}
        preview={d.subject}
        paragraphs={[label ? d.single(label) : d.batch, d.p2]}
        cta={{ label: d.cta, url: `${SITE}/portal/carrier/documents` }}
      />
    ),
  };
}

/* ------------------------------------------------------------------ */
/* 5. Document approved / rejected                                     */
/* ------------------------------------------------------------------ */

export function buildDocumentReviewedEmail(
  locale: EmailLocale,
  p: { docType: DocType; decision: "approved" | "rejected"; note: string | null },
): BuiltEmail {
  const label = pick(DOC_LABEL_DICT, locale)[p.docType];
  const approved = p.decision === "approved";
  const d = pick<{
    subjectOk: (l: string) => string;
    subjectNo: (l: string) => string;
    eyebrow: string;
    titleOk: (l: string) => string;
    titleNo: (l: string) => string;
    pOk: string;
    pNo: string;
    noteLabel: string;
    cta: string;
  }>(
    {
      en: {
        subjectOk: (l) => `${l} approved ✓`,
        subjectNo: (l) => `${l} needs another look`,
        eyebrow: "Document review",
        titleOk: (l) => `Your ${l} is approved`,
        titleNo: (l) => `Your ${l} was not accepted`,
        pOk: "Nothing else to do for this one — it's on file.",
        pNo: "Please upload a corrected copy from your portal — the note below explains what to fix. Call (908) 404-5373 if anything is unclear.",
        noteLabel: "Reviewer note",
        cta: "Open my documents",
      },
      es: {
        subjectOk: (l) => `${l} aprobado ✓`,
        subjectNo: (l) => `${l} necesita otra revisión`,
        eyebrow: "Revisión de documentos",
        titleOk: (l) => `Tu ${l} está aprobado`,
        titleNo: (l) => `Tu ${l} no fue aceptado`,
        pOk: "No tienes que hacer nada más — ya está archivado.",
        pNo: "Sube una copia corregida desde tu portal — la nota de abajo explica qué corregir. Llama al (908) 404-5373 si algo no está claro.",
        noteLabel: "Nota del revisor",
        cta: "Abrir mis documentos",
      },
      fr: {
        subjectOk: (l) => `${l} approuvé ✓`,
        subjectNo: (l) => `${l} doit être revu`,
        eyebrow: "Examen des documents",
        titleOk: (l) => `Votre ${l} est approuvé`,
        titleNo: (l) => `Votre ${l} n'a pas été accepté`,
        pOk: "Rien d'autre à faire — il est archivé.",
        pNo: "Téléversez une copie corrigée depuis votre portail — la note ci-dessous explique quoi corriger. Appelez le (908) 404-5373 en cas de doute.",
        noteLabel: "Note du réviseur",
        cta: "Ouvrir mes documents",
      },
    },
    locale,
  );
  return {
    subject: approved ? d.subjectOk(label) : d.subjectNo(label),
    template: approved ? "document-approved" : "document-rejected",
    react: (
      <CustomerEmail
        locale={locale}
        eyebrow={d.eyebrow}
        title={approved ? d.titleOk(label) : d.titleNo(label)}
        preview={approved ? d.subjectOk(label) : d.subjectNo(label)}
        paragraphs={[approved ? d.pOk : d.pNo]}
        rows={p.note ? [{ label: d.noteLabel, value: p.note }] : []}
        cta={{ label: d.cta, url: `${SITE}/portal/carrier/documents` }}
      />
    ),
  };
}

/* ------------------------------------------------------------------ */
/* 6–7. Agreement sent / signed                                        */
/* ------------------------------------------------------------------ */

export function buildAgreementSentEmail(
  locale: EmailLocale,
  p: { companyName: string },
): BuiltEmail {
  const d = pick<{
    subject: string;
    eyebrow: string;
    title: string;
    p1: (c: string) => string;
    p2: string;
  }>(
    {
      en: {
        subject: "Your dispatch agreement is on its way",
        eyebrow: "Agreement",
        title: "Check your inbox — agreement sent for e-signature",
        p1: (c) =>
          `The PickLoads dispatch agreement for ${c} was just sent by Dropbox Sign (sender "Dropbox Sign / HelloSign"). Sign from any device — no printing, no fax.`,
        p2: "Didn't get it in a few minutes? Check spam, or re-send it from the Agreements page in your portal.",
      },
      es: {
        subject: "Tu acuerdo de dispatch está en camino",
        eyebrow: "Acuerdo",
        title: "Revisa tu bandeja — acuerdo enviado para firma electrónica",
        p1: (c) =>
          `El acuerdo de dispatch de PickLoads para ${c} se acaba de enviar por Dropbox Sign (remitente "Dropbox Sign / HelloSign"). Firma desde cualquier dispositivo — sin imprimir ni fax.`,
        p2: "¿No llega en unos minutos? Revisa spam o reenvíalo desde la página de Acuerdos de tu portal.",
      },
      fr: {
        subject: "Votre accord de dispatch est en route",
        eyebrow: "Accord",
        title: "Vérifiez votre boîte mail — accord envoyé pour signature électronique",
        p1: (c) =>
          `L'accord de dispatch PickLoads pour ${c} vient d'être envoyé via Dropbox Sign (expéditeur « Dropbox Sign / HelloSign »). Signez depuis n'importe quel appareil — sans impression ni fax.`,
        p2: "Rien reçu après quelques minutes ? Vérifiez les spams, ou renvoyez-le depuis la page Accords de votre portail.",
      },
    },
    locale,
  );
  return {
    subject: d.subject,
    template: "agreement-sent",
    react: (
      <CustomerEmail
        locale={locale}
        eyebrow={d.eyebrow}
        title={d.title}
        preview={d.subject}
        paragraphs={[d.p1(p.companyName), d.p2]}
      />
    ),
  };
}

export function buildAgreementSignedEmail(
  locale: EmailLocale,
  p: { companyName: string },
): BuiltEmail {
  const d = pick<{
    subject: string;
    eyebrow: string;
    title: string;
    p1: (c: string) => string;
    p2: string;
    cta: string;
  }>(
    {
      en: {
        subject: "Agreement signed — welcome to the fleet",
        eyebrow: "Agreement",
        title: "Your dispatch agreement is fully signed",
        p1: (c) =>
          `The dispatch agreement for ${c} is executed. Your signed copy is available from the Agreements page in your portal.`,
        p2: "Your dispatcher will call to plan your first loads. Want to get ahead? Make sure your trucks and drivers are listed in the portal.",
        cta: "View my agreement",
      },
      es: {
        subject: "Acuerdo firmado — bienvenido a la flota",
        eyebrow: "Acuerdo",
        title: "Tu acuerdo de dispatch está firmado por completo",
        p1: (c) =>
          `El acuerdo de dispatch de ${c} está ejecutado. Tu copia firmada está disponible en la página de Acuerdos de tu portal.`,
        p2: "Tu dispatcher te llamará para planear tus primeras cargas. ¿Quieres adelantarte? Asegúrate de listar tus camiones y choferes en el portal.",
        cta: "Ver mi acuerdo",
      },
      fr: {
        subject: "Accord signé — bienvenue dans la flotte",
        eyebrow: "Accord",
        title: "Votre accord de dispatch est entièrement signé",
        p1: (c) =>
          `L'accord de dispatch de ${c} est signé par toutes les parties. Votre copie signée est disponible sur la page Accords de votre portail.`,
        p2: "Votre dispatcher vous appellera pour planifier vos premiers chargements. Pour prendre de l'avance, vérifiez que vos camions et chauffeurs figurent dans le portail.",
        cta: "Voir mon accord",
      },
    },
    locale,
  );
  return {
    subject: d.subject,
    template: "agreement-signed",
    react: (
      <CustomerEmail
        locale={locale}
        eyebrow={d.eyebrow}
        title={d.title}
        preview={d.subject}
        paragraphs={[d.p1(p.companyName), d.p2]}
        cta={{ label: d.cta, url: `${SITE}/portal/carrier/agreements` }}
      />
    ),
  };
}

/* ------------------------------------------------------------------ */
/* 8. Carrier approved (record activated by staff)                     */
/* ------------------------------------------------------------------ */

export function buildCarrierApprovedEmail(
  locale: EmailLocale,
  p: { companyName: string },
): BuiltEmail {
  const d = pick<{
    subject: string;
    eyebrow: string;
    title: (c: string) => string;
    p1: string;
    p2: string;
    cta: string;
  }>(
    {
      en: {
        subject: "You're approved — dispatch starts now",
        eyebrow: "Carrier approved",
        title: (c) => `${c} is approved and active`,
        p1: "Compliance checks are complete and your carrier record is active. Your dispatcher is already lining up loads that fit your equipment and lanes.",
        p2: "Keep your COI current and your trucks/drivers list up to date — that's what we match loads against.",
        cta: "Open my portal",
      },
      es: {
        subject: "Estás aprobado — el dispatch empieza ahora",
        eyebrow: "Carrier aprobado",
        title: (c) => `${c} está aprobado y activo`,
        p1: "Las verificaciones de cumplimiento están completas y tu registro de carrier está activo. Tu dispatcher ya está buscando cargas que encajen con tu equipo y tus rutas.",
        p2: "Mantén tu COI vigente y tu lista de camiones/choferes al día — con eso emparejamos las cargas.",
        cta: "Abrir mi portal",
      },
      fr: {
        subject: "Vous êtes approuvé — le dispatch commence maintenant",
        eyebrow: "Transporteur approuvé",
        title: (c) => `${c} est approuvé et actif`,
        p1: "Les vérifications de conformité sont terminées et votre dossier transporteur est actif. Votre dispatcher prépare déjà des chargements adaptés à votre équipement et à vos axes.",
        p2: "Gardez votre COI à jour ainsi que votre liste de camions/chauffeurs — c'est sur cette base que nous attribuons les chargements.",
        cta: "Ouvrir mon portail",
      },
    },
    locale,
  );
  return {
    subject: d.subject,
    template: "carrier-approved",
    react: (
      <CustomerEmail
        locale={locale}
        eyebrow={d.eyebrow}
        title={d.title(p.companyName)}
        preview={d.subject}
        paragraphs={[d.p1, d.p2]}
        cta={{ label: d.cta, url: `${SITE}/portal/carrier` }}
      />
    ),
  };
}

/* ------------------------------------------------------------------ */
/* 9–10. Quote received / status updated                               */
/* ------------------------------------------------------------------ */

export function buildQuoteReceivedEmail(
  locale: EmailLocale,
  p: { lane: string },
): BuiltEmail {
  const d = pick<{
    subject: string;
    eyebrow: string;
    title: string;
    p1: (lane: string) => string;
    p2: string;
    laneLabel: string;
    cta: string;
  }>(
    {
      en: {
        subject: "Quote request received — a dispatcher is on it",
        eyebrow: "Freight quote",
        title: "We got your quote request",
        p1: (lane) => `Your request (${lane}) is with the dispatch desk now.`,
        p2: "A dispatcher reviews every request and calls back with a firm rate — usually within one business hour (8am–6pm ET). Track it in your portal any time.",
        laneLabel: "Lane",
        cta: "Track my quotes",
      },
      es: {
        subject: "Solicitud de cotización recibida — un dispatcher la está viendo",
        eyebrow: "Cotización de flete",
        title: "Recibimos tu solicitud de cotización",
        p1: (lane) => `Tu solicitud (${lane}) ya está con la mesa de dispatch.`,
        p2: "Un dispatcher revisa cada solicitud y te llama con una tarifa firme — normalmente dentro de una hora hábil (8am–6pm ET). Síguela en tu portal cuando quieras.",
        laneLabel: "Ruta",
        cta: "Seguir mis cotizaciones",
      },
      fr: {
        subject: "Demande de devis reçue — un dispatcher s'en occupe",
        eyebrow: "Devis de fret",
        title: "Nous avons bien reçu votre demande de devis",
        p1: (lane) => `Votre demande (${lane}) est entre les mains du bureau dispatch.`,
        p2: "Un dispatcher examine chaque demande et vous rappelle avec un tarif ferme — généralement sous une heure ouvrée (8h–18h ET). Suivez-la dans votre portail à tout moment.",
        laneLabel: "Trajet",
        cta: "Suivre mes devis",
      },
    },
    locale,
  );
  return {
    subject: d.subject,
    template: "quote-received",
    react: (
      <CustomerEmail
        locale={locale}
        eyebrow={d.eyebrow}
        title={d.title}
        preview={d.subject}
        paragraphs={[d.p1(p.lane), d.p2]}
        cta={{ label: d.cta, url: `${SITE}/portal/shipper/quotes` }}
      />
    ),
  };
}

export function buildQuoteStatusEmail(
  locale: EmailLocale,
  p: { lane: string; stage: QuoteStage; quotedRate: number | null },
): BuiltEmail {
  const stageLabel = pick(QUOTE_STAGE_DICT, locale)[p.stage];
  const d = pick<{
    subject: (s: string) => string;
    eyebrow: string;
    title: (s: string) => string;
    p1: (lane: string, s: string) => string;
    quotedP: string;
    laneLabel: string;
    statusLabel: string;
    rateLabel: string;
    cta: string;
  }>(
    {
      en: {
        subject: (s) => `Quote update: ${s}`,
        eyebrow: "Freight quote",
        title: (s) => `Your quote moved to "${s}"`,
        p1: (lane, s) => `Your quote request (${lane}) is now: ${s}.`,
        quotedP: "Your rate is ready — a dispatcher will confirm the details with you. See it in your portal or reply to lock it in.",
        laneLabel: "Lane",
        statusLabel: "Status",
        rateLabel: "Quoted rate",
        cta: "View my quotes",
      },
      es: {
        subject: (s) => `Actualización de cotización: ${s}`,
        eyebrow: "Cotización de flete",
        title: (s) => `Tu cotización pasó a "${s}"`,
        p1: (lane, s) => `Tu solicitud de cotización (${lane}) ahora está: ${s}.`,
        quotedP: "Tu tarifa está lista — un dispatcher confirmará los detalles contigo. Mírala en tu portal o responde para asegurarla.",
        laneLabel: "Ruta",
        statusLabel: "Estado",
        rateLabel: "Tarifa cotizada",
        cta: "Ver mis cotizaciones",
      },
      fr: {
        subject: (s) => `Mise à jour du devis : ${s}`,
        eyebrow: "Devis de fret",
        title: (s) => `Votre devis est passé à « ${s} »`,
        p1: (lane, s) => `Votre demande de devis (${lane}) est maintenant : ${s}.`,
        quotedP: "Votre tarif est prêt — un dispatcher confirmera les détails avec vous. Consultez-le dans votre portail ou répondez pour le verrouiller.",
        laneLabel: "Trajet",
        statusLabel: "Statut",
        rateLabel: "Tarif proposé",
        cta: "Voir mes devis",
      },
    },
    locale,
  );
  const rows = [
    { label: d.laneLabel, value: p.lane },
    { label: d.statusLabel, value: stageLabel },
    ...(p.quotedRate !== null
      ? [
          {
            label: d.rateLabel,
            value: p.quotedRate.toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
            }),
          },
        ]
      : []),
  ];
  return {
    subject: d.subject(stageLabel),
    template: "quote-status-updated",
    react: (
      <CustomerEmail
        locale={locale}
        eyebrow={d.eyebrow}
        title={d.title(stageLabel)}
        preview={d.subject(stageLabel)}
        paragraphs={
          p.stage === "quoted" ? [d.p1(p.lane, stageLabel), d.quotedP] : [d.p1(p.lane, stageLabel)]
        }
        rows={rows}
        cta={{ label: d.cta, url: `${SITE}/portal/shipper/quotes` }}
      />
    ),
  };
}

/* ------------------------------------------------------------------ */
/* 11–13. Invoice issued / payment received / payment failed           */
/* ------------------------------------------------------------------ */

export function buildInvoiceIssuedEmail(
  locale: EmailLocale,
  p: { lane: string; amountUsd: number; dueDays: number; hostedUrl: string | null },
): BuiltEmail {
  const amount = p.amountUsd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  const d = pick<{
    subject: (a: string) => string;
    eyebrow: string;
    title: string;
    p1: (lane: string, days: number) => string;
    p2: string;
    amountLabel: string;
    laneLabel: string;
    cta: string;
  }>(
    {
      en: {
        subject: (a) => `Dispatch-fee invoice issued — ${a}`,
        eyebrow: "Invoices & payments",
        title: "Your dispatch-fee invoice is ready",
        p1: (lane, days) =>
          `The dispatch fee for your delivered load (${lane}) has been invoiced, due in ${days} days. Stripe also emails you a secure payment link.`,
        p2: "Only the dispatch fee is ever invoiced through PickLoads — freight payments go broker → you (or your factoring company) and never touch us.",
        amountLabel: "Amount",
        laneLabel: "Load",
        cta: "Pay invoice",
      },
      es: {
        subject: (a) => `Factura de tarifa de dispatch emitida — ${a}`,
        eyebrow: "Facturas y pagos",
        title: "Tu factura de tarifa de dispatch está lista",
        p1: (lane, days) =>
          `La tarifa de dispatch de tu carga entregada (${lane}) fue facturada, con vencimiento en ${days} días. Stripe también te envía un enlace de pago seguro.`,
        p2: "Solo la tarifa de dispatch se factura a través de PickLoads — los pagos del flete van del broker a ti (o a tu factoring) y nunca pasan por nosotros.",
        amountLabel: "Monto",
        laneLabel: "Carga",
        cta: "Pagar factura",
      },
      fr: {
        subject: (a) => `Facture de frais de dispatch émise — ${a}`,
        eyebrow: "Factures et paiements",
        title: "Votre facture de frais de dispatch est prête",
        p1: (lane, days) =>
          `Les frais de dispatch de votre chargement livré (${lane}) ont été facturés, payables sous ${days} jours. Stripe vous envoie aussi un lien de paiement sécurisé.`,
        p2: "Seuls les frais de dispatch sont facturés via PickLoads — les paiements de fret vont du courtier à vous (ou à votre société d'affacturage) et ne transitent jamais par nous.",
        amountLabel: "Montant",
        laneLabel: "Chargement",
        cta: "Payer la facture",
      },
    },
    locale,
  );
  return {
    subject: d.subject(amount),
    template: "invoice-issued",
    react: (
      <CustomerEmail
        locale={locale}
        eyebrow={d.eyebrow}
        title={d.title}
        preview={d.subject(amount)}
        paragraphs={[d.p1(p.lane, p.dueDays), d.p2]}
        rows={[
          { label: d.amountLabel, value: amount },
          { label: d.laneLabel, value: p.lane },
        ]}
        cta={{
          label: d.cta,
          url: p.hostedUrl ?? `${SITE}/portal/carrier/invoices`,
        }}
      />
    ),
  };
}

export function buildPaymentReceivedEmail(
  locale: EmailLocale,
  p: { amountUsd: number },
): BuiltEmail {
  const amount = p.amountUsd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  const d = pick<{
    subject: (a: string) => string;
    eyebrow: string;
    title: string;
    p1: (a: string) => string;
    cta: string;
  }>(
    {
      en: {
        subject: (a) => `Payment received — ${a}. Thank you!`,
        eyebrow: "Invoices & payments",
        title: "Payment received — you're all settled",
        p1: (a) => `We received your dispatch-fee payment of ${a}. Your receipt is in your portal's Invoices & Payments page (and from Stripe by email).`,
        cta: "View my invoices",
      },
      es: {
        subject: (a) => `Pago recibido — ${a}. ¡Gracias!`,
        eyebrow: "Facturas y pagos",
        title: "Pago recibido — estás al día",
        p1: (a) => `Recibimos tu pago de la tarifa de dispatch por ${a}. Tu recibo está en la página Facturas y Pagos de tu portal (y por correo desde Stripe).`,
        cta: "Ver mis facturas",
      },
      fr: {
        subject: (a) => `Paiement reçu — ${a}. Merci !`,
        eyebrow: "Factures et paiements",
        title: "Paiement reçu — vous êtes à jour",
        p1: (a) => `Nous avons reçu votre paiement de frais de dispatch de ${a}. Votre reçu se trouve sur la page Factures et paiements de votre portail (et par e-mail via Stripe).`,
        cta: "Voir mes factures",
      },
    },
    locale,
  );
  return {
    subject: d.subject(amount),
    template: "payment-received",
    react: (
      <CustomerEmail
        locale={locale}
        eyebrow={d.eyebrow}
        title={d.title}
        preview={d.subject(amount)}
        paragraphs={[d.p1(amount)]}
        cta={{ label: d.cta, url: `${SITE}/portal/carrier/invoices` }}
      />
    ),
  };
}

export function buildPaymentFailedEmail(
  locale: EmailLocale,
  p: { hostedUrl: string | null },
): BuiltEmail {
  const d = pick<{
    subject: string;
    eyebrow: string;
    title: string;
    p1: string;
    p2: string;
    cta: string;
  }>(
    {
      en: {
        subject: "Payment didn't go through — let's fix it",
        eyebrow: "Invoices & payments",
        title: "Your dispatch-fee payment failed",
        p1: "The payment for your dispatch-fee invoice didn't go through (cards expire, banks decline — it happens). Stripe retries automatically, or you can pay now with the button below.",
        p2: "Trouble with the payment method? Call (908) 404-5373 and we'll sort it out together.",
        cta: "Retry payment",
      },
      es: {
        subject: "El pago no se procesó — vamos a resolverlo",
        eyebrow: "Facturas y pagos",
        title: "Tu pago de la tarifa de dispatch falló",
        p1: "El pago de tu factura de tarifa de dispatch no se procesó (las tarjetas vencen, los bancos rechazan — pasa). Stripe reintenta automáticamente, o puedes pagar ahora con el botón de abajo.",
        p2: "¿Problemas con el método de pago? Llama al (908) 404-5373 y lo resolvemos juntos.",
        cta: "Reintentar pago",
      },
      fr: {
        subject: "Le paiement n'est pas passé — réglons ça",
        eyebrow: "Factures et paiements",
        title: "Votre paiement de frais de dispatch a échoué",
        p1: "Le paiement de votre facture de frais de dispatch n'est pas passé (cartes expirées, refus bancaires — ça arrive). Stripe réessaie automatiquement, ou payez maintenant avec le bouton ci-dessous.",
        p2: "Un souci avec le moyen de paiement ? Appelez le (908) 404-5373 et nous réglerons ça ensemble.",
        cta: "Réessayer le paiement",
      },
    },
    locale,
  );
  return {
    subject: d.subject,
    template: "payment-failed",
    react: (
      <CustomerEmail
        locale={locale}
        eyebrow={d.eyebrow}
        title={d.title}
        preview={d.subject}
        paragraphs={[d.p1, d.p2]}
        cta={{
          label: d.cta,
          url: p.hostedUrl ?? `${SITE}/portal/carrier/invoices`,
        }}
      />
    ),
  };
}

/* ------------------------------------------------------------------ */
/* 14–15. Support confirmation / staff reply                           */
/* ------------------------------------------------------------------ */

export function buildSupportConfirmationEmail(
  locale: EmailLocale,
  p: { threadSubject: string; portalPath: string },
): BuiltEmail {
  const d = pick<{
    subject: string;
    eyebrow: string;
    title: string;
    p1: (s: string) => string;
    p2: string;
    cta: string;
  }>(
    {
      en: {
        subject: "We got your message — the dispatch desk is on it",
        eyebrow: "Support",
        title: "Message received",
        p1: (s) => `Your message "${s}" reached the dispatch desk. We answer support threads within one business day — usually much faster.`,
        p2: "Urgent load issue? Don't wait on email — call (908) 404-5373 — dispatch support answers 7 days a week, with after-hours emergency support.",
        cta: "View my support threads",
      },
      es: {
        subject: "Recibimos tu mensaje — la mesa de dispatch lo está viendo",
        eyebrow: "Soporte",
        title: "Mensaje recibido",
        p1: (s) => `Tu mensaje "${s}" llegó a la mesa de dispatch. Respondemos los hilos de soporte dentro de un día hábil — normalmente mucho más rápido.`,
        p2: "¿Problema urgente con una carga? No esperes el correo — llama al (908) 404-5373 — soporte de dispatch responde los 7 días, con urgencias fuera de horario.",
        cta: "Ver mis hilos de soporte",
      },
      fr: {
        subject: "Message bien reçu — le bureau dispatch s'en occupe",
        eyebrow: "Support",
        title: "Message reçu",
        p1: (s) => `Votre message « ${s} » est arrivé au bureau dispatch. Nous répondons aux fils de support sous un jour ouvré — généralement bien plus vite.`,
        p2: "Problème urgent sur un chargement ? N'attendez pas l'e-mail — appelez le (908) 404-5373 — le support dispatch répond 7 jours sur 7, avec urgences hors horaires.",
        cta: "Voir mes fils de support",
      },
    },
    locale,
  );
  return {
    subject: d.subject,
    template: "support-confirmation",
    react: (
      <CustomerEmail
        locale={locale}
        eyebrow={d.eyebrow}
        title={d.title}
        preview={d.subject}
        paragraphs={[d.p1(p.threadSubject), d.p2]}
        cta={{ label: d.cta, url: `${SITE}${p.portalPath}` }}
      />
    ),
  };
}

export function buildSupportReplyEmail(
  locale: EmailLocale,
  p: { threadSubject: string; portalPath: string },
): BuiltEmail {
  const d = pick<{
    subject: (s: string) => string;
    eyebrow: string;
    title: string;
    p1: (s: string) => string;
    p2: string;
    cta: string;
  }>(
    {
      en: {
        subject: (s) => `PickLoads replied: ${s}`,
        eyebrow: "Support",
        title: "The dispatch desk answered your message",
        p1: (s) => `There's a new reply on your support thread "${s}". Read and respond from your portal — replies there keep the whole history in one place.`,
        p2: "Need to talk it through instead? Call (908) 404-5373.",
        cta: "Read the reply",
      },
      es: {
        subject: (s) => `PickLoads respondió: ${s}`,
        eyebrow: "Soporte",
        title: "La mesa de dispatch respondió tu mensaje",
        p1: (s) => `Hay una nueva respuesta en tu hilo de soporte "${s}". Léela y responde desde tu portal — así todo el historial queda en un solo lugar.`,
        p2: "¿Prefieres hablarlo? Llama al (908) 404-5373.",
        cta: "Leer la respuesta",
      },
      fr: {
        subject: (s) => `PickLoads a répondu : ${s}`,
        eyebrow: "Support",
        title: "Le bureau dispatch a répondu à votre message",
        p1: (s) => `Il y a une nouvelle réponse sur votre fil de support « ${s} ». Lisez-la et répondez depuis votre portail — tout l'historique reste au même endroit.`,
        p2: "Vous préférez en parler de vive voix ? Appelez le (908) 404-5373.",
        cta: "Lire la réponse",
      },
    },
    locale,
  );
  return {
    subject: d.subject(p.threadSubject),
    template: "support-reply",
    react: (
      <CustomerEmail
        locale={locale}
        eyebrow={d.eyebrow}
        title={d.title}
        preview={d.subject(p.threadSubject)}
        paragraphs={[d.p1(p.threadSubject), d.p2]}
        cta={{ label: d.cta, url: `${SITE}${p.portalPath}` }}
      />
    ),
  };
}
