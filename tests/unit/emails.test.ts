import { describe, expect, it } from "vitest";
import {
  EMAIL_LOCALES,
  FOOTER_DICT,
  pick,
  resolveEmailLocale,
} from "@/emails/i18n";
import {
  buildDocumentReviewedEmail,
  buildInvoiceIssuedEmail,
  buildQuoteStatusEmail,
  buildWelcomeCarrierEmail,
  DOC_LABEL_DICT,
  QUOTE_STAGE_DICT,
} from "@/emails/customer-templates";
import { QUOTE_STAGE_MAP, LEAD_STATUSES } from "@/lib/validation/quotes";
import { QUOTE_STATUS } from "@/lib/shipper-quotes";

/** M-60 — email locale plumbing + template suite invariants. */

describe("resolveEmailLocale", () => {
  it("accepts every supported locale and normalizes case/region", () => {
    for (const l of EMAIL_LOCALES) expect(resolveEmailLocale(l)).toBe(l);
    expect(resolveEmailLocale("ES")).toBe("es");
    expect(resolveEmailLocale("fr-CA")).toBe("fr");
  });
  it("falls back to English for unknown/null input", () => {
    expect(resolveEmailLocale("de")).toBe("en");
    expect(resolveEmailLocale(null)).toBe("en");
    expect(resolveEmailLocale(undefined)).toBe("en");
    expect(resolveEmailLocale("")).toBe("en");
  });
});

describe("pick (ru/ht mirror en until natively reviewed)", () => {
  it("returns authored es/fr and mirrors en for ru/ht", () => {
    expect(pick(FOOTER_DICT, "es")).toBe(FOOTER_DICT.es);
    expect(pick(FOOTER_DICT, "fr")).toBe(FOOTER_DICT.fr);
    expect(pick(FOOTER_DICT, "ru")).toBe(FOOTER_DICT.en);
    expect(pick(FOOTER_DICT, "ht")).toBe(FOOTER_DICT.en);
  });
});

describe("customer templates", () => {
  it("localizes subjects per recipient language", () => {
    const en = buildWelcomeCarrierEmail("en", {
      fullName: "Maria",
      companyName: "Road LLC",
    });
    const es = buildWelcomeCarrierEmail("es", {
      fullName: "Maria",
      companyName: "Road LLC",
    });
    const ht = buildWelcomeCarrierEmail("ht", {
      fullName: "Maria",
      companyName: "Road LLC",
    });
    expect(en.subject).toContain("Welcome");
    expect(es.subject).toContain("Bienvenido");
    expect(ht.subject).toBe(en.subject); // mirror
    expect(en.template).toBe("welcome-carrier");
  });

  it("document review carries the localized doc label and decision template id", () => {
    const ok = buildDocumentReviewedEmail("fr", {
      docType: "coi",
      decision: "approved",
      note: null,
    });
    expect(ok.subject).toContain(DOC_LABEL_DICT.fr.coi);
    expect(ok.template).toBe("document-approved");
    const no = buildDocumentReviewedEmail("en", {
      docType: "w9",
      decision: "rejected",
      note: "Blurry scan",
    });
    expect(no.template).toBe("document-rejected");
  });

  it("quote status email uses the shipper-facing stage label", () => {
    const built = buildQuoteStatusEmail("es", {
      lane: "Newark, NJ → Dallas, TX",
      stage: "quoted",
      quotedRate: 2450,
    });
    expect(built.subject).toContain(QUOTE_STAGE_DICT.es.quoted);
  });

  it("invoice email formats USD and keeps the dispatch-fee-only language", () => {
    const built = buildInvoiceIssuedEmail("en", {
      lane: "A → B",
      amountUsd: 122.5,
      dueDays: 7,
      hostedUrl: null,
    });
    expect(built.subject).toContain("$122.50");
  });
});

describe("QUOTE_STAGE_MAP parity with the shipper timeline (M-56)", () => {
  it("covers every lead_status and matches QUOTE_STATUS labels", () => {
    const labelFor = {
      received: "Received",
      in_review: "In review",
      quoted: "Quoted",
      booked: "Booked",
      closed: "Closed",
    } as const;
    for (const status of LEAD_STATUSES) {
      const stage = QUOTE_STAGE_MAP[status];
      expect(stage).toBeDefined();
      const timeline = QUOTE_STATUS[status];
      expect(timeline?.label).toBe(labelFor[stage]);
    }
  });
});
