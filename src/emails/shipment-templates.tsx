import { CustomerEmail } from "./CustomerEmail";
import { resolveEmailPublicText } from "./phrases";
import {
  pick,
  type BuiltEmail,
  type EmailDict,
  type EmailLocale,
} from "./i18n";
import {
  SHIPMENT_NOTIFICATION_MAP,
  type ShipmentNotificationEvent,
  type ShipmentNotificationPayload,
} from "@/lib/shipments/notification-rules";

/**
 * M-79 — §17's eleven customer notifications as localized React Email
 * templates, in M-60's established style.
 *
 * ── WHAT IS REUSED, AND WHY THAT MATTERS ──────────────────────────────────
 *
 * `CustomerEmail` (the layout), `emails/i18n.ts` (`pick`, `EmailDict`, the
 * ru/ht mirror rule, the localized dispatch-desk footer) and the `BuiltEmail`
 * contract are M-60's and are used unchanged. The ONLY addition to M-60's
 * layout is an optional opt-out line, which every pre-existing template omits
 * and therefore renders exactly as before.
 *
 * en/es/fr are AUTHORED. ru/ht MIRROR ENGLISH and are flagged, which is the
 * precedent M-42 set for the site dictionaries and M-60 set for the email
 * suite: an unreviewed machine translation of freight status wording is worse
 * than honest English, and §24 forbids silently machine-translating
 * customer-facing text.
 *
 * ── §17: "INCLUDE TRACKING LINK" ──────────────────────────────────────────
 *
 * Every one of the eleven carries `trackingUrl()` — M-73's `/track` page with
 * `?number=` prefilled, locale-prefixed per next-intl's `as-needed` policy.
 *
 * The SECOND FACTOR IS NEVER IN THE LINK. M-73's threat model is explicit
 * that a URL carrying the ZIP/access code puts both factors into a location
 * bar, a browser history, a `Referer` header and every corporate proxy log
 * between the customer and us — and an email is forwarded, archived and
 * scanned far more often than a page is visited. So the link prefills the
 * tracking NUMBER (an identifier, printed on the BOL, already known to
 * everyone handling the freight) and the customer types the second factor, as
 * they would have on the page.
 *
 * ── §17: "DO NOT EXPOSE SENSITIVE DATA" ───────────────────────────────────
 *
 * Every builder takes `ShipmentNotificationPayload` and nothing else. That
 * type carries only facts §8's public tracking page already publishes; there
 * is no parameter through which an amount, an internal note, a document or a
 * signed URL could arrive. A unit sentinel sweep renders all eleven, in all
 * five locales, and asserts none of a list of financial and internal
 * sentinels appears in the HTML — the same allow-list-plus-key-set doctrine
 * M-70 applied to the DTOs.
 */

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pickloads.com";

/* ------------------------------------------------------------------ *
 * URLs
 * ------------------------------------------------------------------ */

/**
 * next-intl's `localePrefix: "as-needed"` (src/i18n/routing.ts): English is
 * unprefixed, every other locale is `/xx/…`. Building the path here rather
 * than importing the routing helper keeps this file renderable outside a
 * request context, which is what the unit sentinel sweep needs.
 */
export function localizedPath(locale: EmailLocale, path: string): string {
  return locale === "en" ? path : `/${locale}${path}`;
}

/**
 * §17's tracking link. The tracking number is a query parameter; the
 * secondary verification value is not, and cannot be — this function has no
 * parameter for it.
 */
export function trackingUrl(
  locale: EmailLocale,
  trackingNumber: string | null | undefined,
): string {
  const base = `${SITE}${localizedPath(locale, "/track")}`;
  const number = (trackingNumber ?? "").trim();
  return number === ""
    ? base
    : `${base}?number=${encodeURIComponent(number)}`;
}

/** The tokenized opt-out page (M-79's own route). */
export function optOutUrl(
  locale: EmailLocale,
  token: string | null | undefined,
): string | null {
  const t = (token ?? "").trim();
  if (t === "") return null;
  return `${SITE}${localizedPath(locale, "/notifications/unsubscribe")}?token=${encodeURIComponent(t)}`;
}

/* ------------------------------------------------------------------ *
 * Shared localized fragments
 * ------------------------------------------------------------------ */

const SHARED_DICT: EmailDict<{
  cta: string;
  trackingLabel: string;
  updatedLabel: string;
  etaLabel: string;
  delayLabel: string;
  noteLabel: string;
  optOut: string;
  /** §30 — what the timeline actually is. Never "live tracking". */
  honest: string;
  delayMinutes: (n: number) => string;
}> = {
  en: {
    cta: "Track this shipment",
    trackingLabel: "Tracking number",
    updatedLabel: "Updated",
    etaLabel: "Estimated delivery",
    delayLabel: "Delay",
    noteLabel: "From dispatch",
    optOut: "Stop shipment update emails",
    honest:
      "Milestone tracking — updates are entered by our dispatch team as the shipment moves.",
    delayMinutes: (n) => `about ${n} minute${n === 1 ? "" : "s"}`,
  },
  es: {
    cta: "Rastrear este envío",
    trackingLabel: "Número de rastreo",
    updatedLabel: "Actualizado",
    etaLabel: "Entrega estimada",
    delayLabel: "Retraso",
    noteLabel: "De dispatch",
    optOut: "Dejar de recibir correos de actualización de envíos",
    honest:
      "Seguimiento por hitos — las actualizaciones las ingresa nuestro equipo de dispatch a medida que avanza el envío.",
    delayMinutes: (n) => `unos ${n} minuto${n === 1 ? "" : "s"}`,
  },
  fr: {
    cta: "Suivre cet envoi",
    trackingLabel: "Numéro de suivi",
    updatedLabel: "Mis à jour",
    etaLabel: "Livraison estimée",
    delayLabel: "Retard",
    noteLabel: "De la part du dispatch",
    optOut: "Ne plus recevoir les e-mails de suivi d'envoi",
    honest:
      "Suivi par étapes — les mises à jour sont saisies par notre équipe dispatch au fil de l'envoi.",
    delayMinutes: (n) => `environ ${n} minute${n === 1 ? "" : "s"}`,
  },
};

/**
 * Locale-correct date/time (§24 "date and time formatting"). UTC is used
 * deliberately and labelled: an email is read in an unknown timezone, and
 * silently rendering a server-local time is how a customer reads "arrives
 * 09:00" and stands outside at the wrong hour.
 */
function formatWhen(locale: EmailLocale, iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const tag = locale === "ru" || locale === "ht" ? "en" : locale;
  return `${new Intl.DateTimeFormat(tag, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date)} UTC`;
}

interface Row {
  label: string;
  value: string;
}

/** Build the shared row block: tracking number, then whatever the event has. */
function baseRows(
  locale: EmailLocale,
  payload: ShipmentNotificationPayload,
): Row[] {
  const s = pick(SHARED_DICT, locale);
  const rows: Row[] = [];
  if (payload.tracking_number) {
    rows.push({ label: s.trackingLabel, value: payload.tracking_number });
  }
  const when = formatWhen(locale, payload.event_time);
  if (when) rows.push({ label: s.updatedLabel, value: when });
  return rows;
}

export interface ShipmentEmailContext {
  locale: EmailLocale;
  payload: ShipmentNotificationPayload;
  /** `user_preferences.notification_token`; omitted = no opt-out line. */
  optOutToken?: string | null;
}

/**
 * The one place a shipment email is assembled. Every builder funnels through
 * it, so the tracking link, the honest §30 sentence and the opt-out line
 * cannot be present on ten of eleven templates.
 */
function shipmentEmail(
  ctx: ShipmentEmailContext,
  event: ShipmentNotificationEvent,
  content: {
    subject: string;
    eyebrow: string;
    title: string;
    paragraphs: string[];
    extraRows?: Row[];
  },
): BuiltEmail {
  const { locale, payload } = ctx;
  const s = pick(SHARED_DICT, locale);
  const url = optOutUrl(locale, ctx.optOutToken);
  return {
    subject: content.subject,
    template: SHIPMENT_NOTIFICATION_MAP[event].template,
    react: (
      <CustomerEmail
        locale={locale}
        eyebrow={content.eyebrow}
        title={content.title}
        preview={content.subject}
        paragraphs={content.paragraphs}
        rows={[...baseRows(locale, payload), ...(content.extraRows ?? [])]}
        cta={{ label: s.cta, url: trackingUrl(locale, payload.tracking_number) }}
        footNote={s.honest}
        {...(url ? { optOut: { label: s.optOut, url } } : {})}
      />
    ),
  };
}

/**
 * The operator's own customer-facing sentence (§24, decision D-6).
 *
 * NOT verbatim. M-73 stores a curated library pick as the TOKEN
 * `phrase:delay.traffic`, and every rendering surface in the product resolves
 * it before display — so an email that printed the stored string would mail a
 * customer a raw token, in the one channel that is archived and forwarded.
 *
 * `resolveEmailPublicText` reuses M-73's own five-locale phrase catalogue
 * rather than restating it here (a second vocabulary would drift from the
 * `/track` page this very email links to), and labels genuinely novel
 * dispatcher prose *"Written by dispatch, in English"* — D-6 option (a),
 * which §24 requires and §30's honest-labels rule reinforces.
 */
function noteRow(locale: EmailLocale, text: string | null | undefined): Row[] {
  const resolved = resolveEmailPublicText(locale, text);
  if (resolved === null) return [];
  const label = pick(SHARED_DICT, locale).noteLabel;
  return [
    {
      label: resolved.notice ? `${label} (${resolved.notice})` : label,
      value: resolved.text,
    },
  ];
}

/* ------------------------------------------------------------------ *
 * 1 · Quote accepted
 * ------------------------------------------------------------------ */

type Copy = {
  subject: (n: string) => string;
  eyebrow: string;
  title: string;
  p1: string;
  p2: string;
};

const QUOTE_ACCEPTED: EmailDict<Copy> = {
  en: {
    subject: (n) => `Quote accepted — shipment ${n} is booked`,
    eyebrow: "Shipment booked",
    title: "Your quote is accepted and the shipment is open",
    p1: "Thanks — the rate is locked and your shipment now has a tracking number. We are sourcing a carrier for it next.",
    p2: "You will get an update the moment a carrier is assigned. Track the shipment any time with your tracking number and the delivery ZIP code.",
  },
  es: {
    subject: (n) => `Cotización aceptada — el envío ${n} está reservado`,
    eyebrow: "Envío reservado",
    title: "Tu cotización fue aceptada y el envío está abierto",
    p1: "Gracias — la tarifa quedó fija y tu envío ya tiene número de rastreo. Ahora buscamos un carrier para él.",
    p2: "Te avisamos en cuanto se asigne un carrier. Rastrea el envío cuando quieras con tu número de rastreo y el código postal de entrega.",
  },
  fr: {
    subject: (n) => `Devis accepté — l'envoi ${n} est réservé`,
    eyebrow: "Envoi réservé",
    title: "Votre devis est accepté et l'envoi est ouvert",
    p1: "Merci — le tarif est bloqué et votre envoi a désormais un numéro de suivi. Nous cherchons maintenant un transporteur.",
    p2: "Vous serez informé dès qu'un transporteur est assigné. Suivez l'envoi à tout moment avec votre numéro de suivi et le code postal de livraison.",
  },
};

export function buildQuoteAcceptedEmail(ctx: ShipmentEmailContext): BuiltEmail {
  const d = pick(QUOTE_ACCEPTED, ctx.locale);
  return shipmentEmail(ctx, "quote_accepted", {
    subject: d.subject(ctx.payload.tracking_number ?? ""),
    eyebrow: d.eyebrow,
    title: d.title,
    paragraphs: [d.p1, d.p2],
  });
}

/* ------------------------------------------------------------------ *
 * 2 · Carrier assigned
 * ------------------------------------------------------------------ */

const CARRIER_ASSIGNED: EmailDict<Copy> = {
  en: {
    subject: (n) => `Carrier assigned — shipment ${n}`,
    eyebrow: "Carrier assigned",
    title: "A carrier is assigned to your shipment",
    p1: "We have a truck on your freight. Dispatch has confirmed the equipment and the pickup window with the carrier.",
    p2: "Carrier and driver details stay with our dispatch desk — call us and we will connect you. The next update lands when the driver is dispatched.",
  },
  es: {
    subject: (n) => `Carrier asignado — envío ${n}`,
    eyebrow: "Carrier asignado",
    title: "Tu envío ya tiene carrier asignado",
    p1: "Tenemos un camión para tu carga. Dispatch confirmó el equipo y la ventana de recogida con el carrier.",
    p2: "Los datos del carrier y del conductor quedan con nuestra mesa de dispatch — llámanos y te conectamos. La próxima actualización llega cuando el conductor sea despachado.",
  },
  fr: {
    subject: (n) => `Transporteur assigné — envoi ${n}`,
    eyebrow: "Transporteur assigné",
    title: "Un transporteur est assigné à votre envoi",
    p1: "Nous avons un camion pour votre fret. Le dispatch a confirmé l'équipement et la fenêtre de ramassage avec le transporteur.",
    p2: "Les coordonnées du transporteur et du chauffeur restent au bureau dispatch — appelez-nous et nous vous mettons en relation. La prochaine mise à jour arrive au départ du chauffeur.",
  },
};

export function buildCarrierAssignedEmail(
  ctx: ShipmentEmailContext,
): BuiltEmail {
  const d = pick(CARRIER_ASSIGNED, ctx.locale);
  return shipmentEmail(ctx, "carrier_assigned", {
    subject: d.subject(ctx.payload.tracking_number ?? ""),
    eyebrow: d.eyebrow,
    title: d.title,
    paragraphs: [d.p1, d.p2],
  });
}

/* ------------------------------------------------------------------ *
 * 3 · Driver dispatched
 * ------------------------------------------------------------------ */

const DRIVER_DISPATCHED: EmailDict<Copy> = {
  en: {
    subject: (n) => `Driver dispatched — shipment ${n}`,
    eyebrow: "Driver dispatched",
    title: "The driver is on the way to pickup",
    p1: "The carrier has dispatched a driver and the truck is heading to the pickup location.",
    p2: "We will let you know when the freight is loaded and picked up.",
  },
  es: {
    subject: (n) => `Conductor despachado — envío ${n}`,
    eyebrow: "Conductor despachado",
    title: "El conductor va camino a la recogida",
    p1: "El carrier despachó un conductor y el camión va hacia el lugar de recogida.",
    p2: "Te avisamos cuando la carga esté cargada y recogida.",
  },
  fr: {
    subject: (n) => `Chauffeur en route — envoi ${n}`,
    eyebrow: "Chauffeur en route",
    title: "Le chauffeur se dirige vers le ramassage",
    p1: "Le transporteur a envoyé un chauffeur et le camion se dirige vers le lieu de ramassage.",
    p2: "Nous vous préviendrons dès que le fret sera chargé et ramassé.",
  },
};

export function buildDriverDispatchedEmail(
  ctx: ShipmentEmailContext,
): BuiltEmail {
  const d = pick(DRIVER_DISPATCHED, ctx.locale);
  return shipmentEmail(ctx, "driver_dispatched", {
    subject: d.subject(ctx.payload.tracking_number ?? ""),
    eyebrow: d.eyebrow,
    title: d.title,
    paragraphs: [d.p1, d.p2],
  });
}

/* ------------------------------------------------------------------ *
 * 4 · Picked up
 * ------------------------------------------------------------------ */

const PICKED_UP: EmailDict<Copy> = {
  en: {
    subject: (n) => `Picked up — shipment ${n} is loaded`,
    eyebrow: "Picked up",
    title: "Your freight is loaded and on the truck",
    p1: "Pickup is complete. The bill of lading is signed and the shipment is under way.",
    p2: "Delivery estimates appear on the tracking page as dispatch confirms them with the driver.",
  },
  es: {
    subject: (n) => `Recogido — el envío ${n} está cargado`,
    eyebrow: "Recogido",
    title: "Tu carga está cargada y en el camión",
    p1: "La recogida está completa. El conocimiento de embarque está firmado y el envío va en camino.",
    p2: "Las estimaciones de entrega aparecen en la página de rastreo a medida que dispatch las confirma con el conductor.",
  },
  fr: {
    subject: (n) => `Ramassé — l'envoi ${n} est chargé`,
    eyebrow: "Ramassé",
    title: "Votre fret est chargé et sur le camion",
    p1: "Le ramassage est terminé. Le connaissement est signé et l'envoi est en route.",
    p2: "Les estimations de livraison apparaissent sur la page de suivi à mesure que le dispatch les confirme avec le chauffeur.",
  },
};

export function buildPickedUpEmail(ctx: ShipmentEmailContext): BuiltEmail {
  const d = pick(PICKED_UP, ctx.locale);
  return shipmentEmail(ctx, "picked_up", {
    subject: d.subject(ctx.payload.tracking_number ?? ""),
    eyebrow: d.eyebrow,
    title: d.title,
    paragraphs: [d.p1, d.p2],
  });
}

/* ------------------------------------------------------------------ *
 * 5 · In transit
 * ------------------------------------------------------------------ */

const IN_TRANSIT: EmailDict<Copy> = {
  en: {
    subject: (n) => `In transit — shipment ${n}`,
    eyebrow: "In transit",
    title: "Your shipment is in transit",
    p1: "The truck is rolling toward the delivery location.",
    p2: "The tracking page shows the latest milestone dispatch has recorded, and the delivery estimate when one is set.",
  },
  es: {
    subject: (n) => `En tránsito — envío ${n}`,
    eyebrow: "En tránsito",
    title: "Tu envío está en tránsito",
    p1: "El camión avanza hacia el lugar de entrega.",
    p2: "La página de rastreo muestra el último hito registrado por dispatch y la estimación de entrega cuando existe.",
  },
  fr: {
    subject: (n) => `En transit — envoi ${n}`,
    eyebrow: "En transit",
    title: "Votre envoi est en transit",
    p1: "Le camion roule vers le lieu de livraison.",
    p2: "La page de suivi affiche la dernière étape enregistrée par le dispatch, ainsi que l'estimation de livraison lorsqu'elle existe.",
  },
};

export function buildInTransitEmail(ctx: ShipmentEmailContext): BuiltEmail {
  const d = pick(IN_TRANSIT, ctx.locale);
  return shipmentEmail(ctx, "in_transit", {
    subject: d.subject(ctx.payload.tracking_number ?? ""),
    eyebrow: d.eyebrow,
    title: d.title,
    paragraphs: [d.p1, d.p2],
  });
}

/* ------------------------------------------------------------------ *
 * 6 · Delay reported (§21 — calm, factual, never alarming)
 * ------------------------------------------------------------------ */

const DELAY_REPORTED: EmailDict<Copy> = {
  en: {
    subject: (n) => `Delay reported — shipment ${n}`,
    eyebrow: "Delay reported",
    title: "Your shipment is running behind",
    p1: "Dispatch has logged a delay on this shipment. Here is what we know right now.",
    p2: "We are working it and will update the delivery estimate as soon as it is firm. Call the dispatch desk if this affects your receiving plans.",
  },
  es: {
    subject: (n) => `Retraso reportado — envío ${n}`,
    eyebrow: "Retraso reportado",
    title: "Tu envío va con retraso",
    p1: "Dispatch registró un retraso en este envío. Esto es lo que sabemos ahora.",
    p2: "Estamos trabajando en ello y actualizaremos la estimación de entrega en cuanto sea firme. Llama a la mesa de dispatch si esto afecta tu recepción.",
  },
  fr: {
    subject: (n) => `Retard signalé — envoi ${n}`,
    eyebrow: "Retard signalé",
    title: "Votre envoi a du retard",
    p1: "Le dispatch a enregistré un retard sur cet envoi. Voici ce que nous savons à cet instant.",
    p2: "Nous traitons la situation et mettrons à jour l'estimation de livraison dès qu'elle sera ferme. Appelez le bureau dispatch si cela affecte votre réception.",
  },
};

export function buildDelayReportedEmail(
  ctx: ShipmentEmailContext,
): BuiltEmail {
  const d = pick(DELAY_REPORTED, ctx.locale);
  const s = pick(SHARED_DICT, ctx.locale);
  const minutes = ctx.payload.delay_minutes;
  const extraRows: Row[] = [];
  if (typeof minutes === "number" && minutes > 0) {
    extraRows.push({ label: s.delayLabel, value: s.delayMinutes(minutes) });
  }
  extraRows.push(
    ...noteRow(ctx.locale, ctx.payload.reason_public ?? ctx.payload.public_message),
  );
  return shipmentEmail(ctx, "delay_reported", {
    subject: d.subject(ctx.payload.tracking_number ?? ""),
    eyebrow: d.eyebrow,
    title: d.title,
    paragraphs: [d.p1, d.p2],
    extraRows,
  });
}

/* ------------------------------------------------------------------ *
 * 7 · Delivery ETA updated
 * ------------------------------------------------------------------ */

const ETA_UPDATED: EmailDict<Copy> = {
  en: {
    subject: (n) => `Updated delivery estimate — shipment ${n}`,
    eyebrow: "Delivery estimate",
    title: "The delivery estimate has changed",
    p1: "Dispatch has updated the estimated delivery for this shipment.",
    p2: "Estimates are provided by our dispatch team from the driver's latest check-in — they are not a guarantee, and we update them as the day develops.",
  },
  es: {
    subject: (n) => `Estimación de entrega actualizada — envío ${n}`,
    eyebrow: "Estimación de entrega",
    title: "La estimación de entrega cambió",
    p1: "Dispatch actualizó la entrega estimada de este envío.",
    p2: "Las estimaciones las da nuestro equipo de dispatch según el último reporte del conductor — no son una garantía y las actualizamos durante el día.",
  },
  fr: {
    subject: (n) => `Estimation de livraison mise à jour — envoi ${n}`,
    eyebrow: "Estimation de livraison",
    title: "L'estimation de livraison a changé",
    p1: "Le dispatch a mis à jour la livraison estimée de cet envoi.",
    p2: "Les estimations sont fournies par notre équipe dispatch d'après le dernier point du chauffeur — ce n'est pas une garantie et nous les mettons à jour au fil de la journée.",
  },
};

export function buildEtaUpdatedEmail(ctx: ShipmentEmailContext): BuiltEmail {
  const d = pick(ETA_UPDATED, ctx.locale);
  const s = pick(SHARED_DICT, ctx.locale);
  const eta = formatWhen(ctx.locale, ctx.payload.eta_at);
  const extraRows: Row[] = eta
    ? [{ label: s.etaLabel, value: eta }]
    : [];
  extraRows.push(...noteRow(ctx.locale, ctx.payload.reason_public));
  return shipmentEmail(ctx, "delivery_eta_updated", {
    subject: d.subject(ctx.payload.tracking_number ?? ""),
    eyebrow: d.eyebrow,
    title: d.title,
    paragraphs: [d.p1, d.p2],
    extraRows,
  });
}

/* ------------------------------------------------------------------ *
 * 8 · Arrived at delivery
 * ------------------------------------------------------------------ */

const ARRIVED: EmailDict<Copy> = {
  en: {
    subject: (n) => `Arrived at delivery — shipment ${n}`,
    eyebrow: "Arrived",
    title: "The truck has arrived at the delivery location",
    p1: "The driver is on site and checking in for unloading.",
    p2: "We will confirm delivery once unloading is complete and the paperwork is signed.",
  },
  es: {
    subject: (n) => `Llegó a la entrega — envío ${n}`,
    eyebrow: "Llegó",
    title: "El camión llegó al lugar de entrega",
    p1: "El conductor está en el sitio y se está registrando para descargar.",
    p2: "Confirmaremos la entrega cuando termine la descarga y se firme el papeleo.",
  },
  fr: {
    subject: (n) => `Arrivé à la livraison — envoi ${n}`,
    eyebrow: "Arrivé",
    title: "Le camion est arrivé au lieu de livraison",
    p1: "Le chauffeur est sur place et s'enregistre pour le déchargement.",
    p2: "Nous confirmerons la livraison une fois le déchargement terminé et les documents signés.",
  },
};

export function buildArrivedAtDeliveryEmail(
  ctx: ShipmentEmailContext,
): BuiltEmail {
  const d = pick(ARRIVED, ctx.locale);
  return shipmentEmail(ctx, "arrived_at_delivery", {
    subject: d.subject(ctx.payload.tracking_number ?? ""),
    eyebrow: d.eyebrow,
    title: d.title,
    paragraphs: [d.p1, d.p2],
  });
}

/* ------------------------------------------------------------------ *
 * 9 · Delivered
 * ------------------------------------------------------------------ */

const DELIVERED: EmailDict<Copy> = {
  en: {
    subject: (n) => `Delivered — shipment ${n}`,
    eyebrow: "Delivered",
    title: "Your shipment is delivered",
    p1: "Unloading is complete and the shipment is marked delivered.",
    p2: "Proof of delivery is uploaded and reviewed by our team; we will email you again the moment it is available to download.",
  },
  es: {
    subject: (n) => `Entregado — envío ${n}`,
    eyebrow: "Entregado",
    title: "Tu envío fue entregado",
    p1: "La descarga terminó y el envío está marcado como entregado.",
    p2: "El comprobante de entrega se sube y lo revisa nuestro equipo; te escribimos de nuevo en cuanto esté disponible para descargar.",
  },
  fr: {
    subject: (n) => `Livré — envoi ${n}`,
    eyebrow: "Livré",
    title: "Votre envoi est livré",
    p1: "Le déchargement est terminé et l'envoi est marqué comme livré.",
    p2: "La preuve de livraison est téléversée puis vérifiée par notre équipe ; nous vous écrirons dès qu'elle sera téléchargeable.",
  },
};

export function buildDeliveredEmail(ctx: ShipmentEmailContext): BuiltEmail {
  const d = pick(DELIVERED, ctx.locale);
  return shipmentEmail(ctx, "delivered", {
    subject: d.subject(ctx.payload.tracking_number ?? ""),
    eyebrow: d.eyebrow,
    title: d.title,
    paragraphs: [d.p1, d.p2],
  });
}

/* ------------------------------------------------------------------ *
 * 10 · POD available
 * ------------------------------------------------------------------ */

const POD_AVAILABLE: EmailDict<Copy> = {
  en: {
    subject: (n) => `Proof of delivery available — shipment ${n}`,
    eyebrow: "Proof of delivery",
    title: "Your proof of delivery is ready",
    p1: "The signed POD for this shipment has been reviewed and is now available in your shipper portal.",
    p2: "Sign in to view or download it. For security, documents are never attached to email — the portal link is generated fresh each time and expires quickly.",
  },
  es: {
    subject: (n) => `Comprobante de entrega disponible — envío ${n}`,
    eyebrow: "Comprobante de entrega",
    title: "Tu comprobante de entrega está listo",
    p1: "El POD firmado de este envío fue revisado y ya está disponible en tu portal de shipper.",
    p2: "Inicia sesión para verlo o descargarlo. Por seguridad, los documentos nunca se adjuntan al correo — el enlace del portal se genera cada vez y caduca rápido.",
  },
  fr: {
    subject: (n) => `Preuve de livraison disponible — envoi ${n}`,
    eyebrow: "Preuve de livraison",
    title: "Votre preuve de livraison est prête",
    p1: "Le POD signé de cet envoi a été vérifié et est désormais disponible dans votre portail expéditeur.",
    p2: "Connectez-vous pour le consulter ou le télécharger. Par sécurité, les documents ne sont jamais joints aux e-mails — le lien du portail est régénéré à chaque fois et expire rapidement.",
  },
};

export function buildPodAvailableEmail(ctx: ShipmentEmailContext): BuiltEmail {
  const d = pick(POD_AVAILABLE, ctx.locale);
  return shipmentEmail(ctx, "pod_available", {
    subject: d.subject(ctx.payload.tracking_number ?? ""),
    eyebrow: d.eyebrow,
    title: d.title,
    paragraphs: [d.p1, d.p2],
  });
}

/* ------------------------------------------------------------------ *
 * 11 · Invoice available
 * ------------------------------------------------------------------ */

const INVOICE_AVAILABLE: EmailDict<Copy> = {
  en: {
    subject: (n) => `Invoice available — shipment ${n}`,
    eyebrow: "Invoice",
    title: "An invoice is ready for this shipment",
    p1: "The invoice for this shipment is available in your shipper portal.",
    p2: "Sign in to view the amount, the due date and the payment options. Amounts are never included in email.",
  },
  es: {
    subject: (n) => `Factura disponible — envío ${n}`,
    eyebrow: "Factura",
    title: "Hay una factura lista para este envío",
    p1: "La factura de este envío está disponible en tu portal de shipper.",
    p2: "Inicia sesión para ver el monto, la fecha de vencimiento y las opciones de pago. Los montos nunca se incluyen en el correo.",
  },
  fr: {
    subject: (n) => `Facture disponible — envoi ${n}`,
    eyebrow: "Facture",
    title: "Une facture est prête pour cet envoi",
    p1: "La facture de cet envoi est disponible dans votre portail expéditeur.",
    p2: "Connectez-vous pour voir le montant, l'échéance et les options de paiement. Les montants ne sont jamais inclus dans les e-mails.",
  },
};

export function buildInvoiceAvailableEmail(
  ctx: ShipmentEmailContext,
): BuiltEmail {
  const d = pick(INVOICE_AVAILABLE, ctx.locale);
  return shipmentEmail(ctx, "invoice_available", {
    subject: d.subject(ctx.payload.tracking_number ?? ""),
    eyebrow: d.eyebrow,
    title: d.title,
    paragraphs: [d.p1, d.p2],
  });
}

/* ------------------------------------------------------------------ *
 * The builder table — event → template
 * ------------------------------------------------------------------ */

/**
 * A FULL `Record` over §17's eleven. This is the "template" leg of the
 * event → template → audience mapping; the audience leg is
 * `SHIPMENT_NOTIFICATION_MAP`, and a unit test asserts the two key sets are
 * identical, so a notification can never exist with an audience and no
 * template (silence) or a template and no audience (an email with nowhere to
 * go).
 */
export const SHIPMENT_EMAIL_BUILDERS: Record<
  ShipmentNotificationEvent,
  (ctx: ShipmentEmailContext) => BuiltEmail
> = {
  quote_accepted: buildQuoteAcceptedEmail,
  carrier_assigned: buildCarrierAssignedEmail,
  driver_dispatched: buildDriverDispatchedEmail,
  picked_up: buildPickedUpEmail,
  in_transit: buildInTransitEmail,
  delay_reported: buildDelayReportedEmail,
  delivery_eta_updated: buildEtaUpdatedEmail,
  arrived_at_delivery: buildArrivedAtDeliveryEmail,
  delivered: buildDeliveredEmail,
  pod_available: buildPodAvailableEmail,
  invoice_available: buildInvoiceAvailableEmail,
};

/**
 * The in-app (portal feed) copy for the same eleven events. §17 names two
 * launch channels and §24 requires both localized; a feed row that says
 * "Update on shipment X" in English to a Spanish-speaking shipper honours
 * neither.
 *
 * Kept SHORT and factual on purpose: a feed row is rendered in a list, may be
 * summarised in a future push payload, and has no business carrying a delay
 * reason, a commercial reference or an address.
 */
export const IN_APP_TITLE_DICT: EmailDict<
  Record<ShipmentNotificationEvent, string>
> = {
  en: {
    quote_accepted: "Quote accepted — shipment booked",
    carrier_assigned: "Carrier assigned",
    driver_dispatched: "Driver dispatched",
    picked_up: "Picked up",
    in_transit: "In transit",
    delay_reported: "Delay reported",
    delivery_eta_updated: "Updated delivery estimate",
    arrived_at_delivery: "Arrived at delivery",
    delivered: "Delivered",
    pod_available: "Proof of delivery available",
    invoice_available: "Invoice available",
  },
  es: {
    quote_accepted: "Cotización aceptada — envío reservado",
    carrier_assigned: "Carrier asignado",
    driver_dispatched: "Conductor despachado",
    picked_up: "Recogido",
    in_transit: "En tránsito",
    delay_reported: "Retraso reportado",
    delivery_eta_updated: "Estimación de entrega actualizada",
    arrived_at_delivery: "Llegó a la entrega",
    delivered: "Entregado",
    pod_available: "Comprobante de entrega disponible",
    invoice_available: "Factura disponible",
  },
  fr: {
    quote_accepted: "Devis accepté — envoi réservé",
    carrier_assigned: "Transporteur assigné",
    driver_dispatched: "Chauffeur en route",
    picked_up: "Ramassé",
    in_transit: "En transit",
    delay_reported: "Retard signalé",
    delivery_eta_updated: "Estimation de livraison mise à jour",
    arrived_at_delivery: "Arrivé à la livraison",
    delivered: "Livré",
    pod_available: "Preuve de livraison disponible",
    invoice_available: "Facture disponible",
  },
};

const IN_APP_BODY_DICT: EmailDict<string> = {
  en: "Open the shipment for the current status and timeline.",
  es: "Abre el envío para ver el estado actual y la línea de tiempo.",
  fr: "Ouvrez l'envoi pour voir le statut actuel et la chronologie.",
};

export interface InAppCopy {
  title: string;
  body: string;
}

/** Localized feed copy for one event. The tracking number is appended when
 *  known — it is an identifier, not a credential (§5). */
export function inAppCopy(
  locale: EmailLocale,
  event: ShipmentNotificationEvent,
  trackingNumber: string | null | undefined,
): InAppCopy {
  const title = pick(IN_APP_TITLE_DICT, locale)[event];
  const number = (trackingNumber ?? "").trim();
  return {
    title: number === "" ? title : `${title} — ${number}`,
    body: pick(IN_APP_BODY_DICT, locale),
  };
}
