import { describe, expect, it } from "vitest";
import { carrierLeadSchema } from "@/lib/validation/carrier-lead";
import { contactMessageSchema } from "@/lib/validation/contact-message";
import { freightQuoteSchema } from "@/lib/validation/freight-quote";
import {
  onboardingAccountSchema,
  onboardingInfoSchema,
  uploadRequestSchema,
} from "@/lib/validation/onboarding";
import {
  firstIssueMessage,
  localeField,
  optionalText,
  phoneField,
} from "@/lib/validation/shared";
import { subscriberSchema } from "@/lib/validation/subscriber";

describe("shared fields", () => {
  it("localeField accepts every supported locale", () => {
    for (const locale of ["en", "es", "fr", "ru", "ht"]) {
      expect(localeField.parse(locale)).toBe(locale);
    }
  });

  it("localeField never fails — unknown values default to en", () => {
    expect(localeField.parse("de")).toBe("en");
    expect(localeField.parse("")).toBe("en");
    expect(localeField.parse(42)).toBe("en");
  });

  it("phoneField accepts common US phone shapes", () => {
    expect(phoneField.parse("(908) 404-5373")).toBe("(908) 404-5373");
    expect(phoneField.parse("+1 908.404.5373")).toBe("+1 908.404.5373");
    expect(phoneField.parse("9084045373")).toBe("9084045373");
  });

  it("phoneField rejects garbage and too-short input", () => {
    expect(phoneField.safeParse("abc").success).toBe(false);
    expect(phoneField.safeParse("123").success).toBe(false);
    expect(phoneField.safeParse("").success).toBe(false);
  });

  it("optionalText trims, nulls empties and caps length", () => {
    const field = optionalText(10);
    expect(field.parse("  hi  ")).toBe("hi");
    expect(field.parse("")).toBeNull();
    expect(field.parse(undefined)).toBeNull();
    expect(field.safeParse("12345678901").success).toBe(false);
  });

  it("firstIssueMessage surfaces the first Zod issue", () => {
    const result = phoneField.safeParse("abc");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(firstIssueMessage(result.error)).toBe(
        "Enter a valid phone number.",
      );
    }
  });
});

describe("carrierLeadSchema", () => {
  const base = {
    lead_type: "dispatch",
    truck_type: "Semi / Tractor",
    trailer_type: "Dry Van",
    home_state: "NJ",
    truck_count: "1",
    phone: "(908) 404-5373",
    locale: "en",
  };

  it("accepts the quick-quote payload (phone-only required)", () => {
    const parsed = carrierLeadSchema.parse(base);
    expect(parsed.phone).toBe("(908) 404-5373");
    expect(parsed.full_name).toBeNull();
    expect(parsed.email).toBeNull();
  });

  it("lead_type catch: unknown/missing values fall back to dispatch", () => {
    expect(carrierLeadSchema.parse(base).lead_type).toBe("dispatch");
    expect(
      carrierLeadSchema.parse({ ...base, lead_type: "bogus" }).lead_type,
    ).toBe("dispatch");
    expect(
      carrierLeadSchema.parse({ ...base, lead_type: "" }).lead_type,
    ).toBe("dispatch");
    expect(
      carrierLeadSchema.parse({ ...base, lead_type: "new_authority" })
        .lead_type,
    ).toBe("new_authority");
  });

  it("rejects an invalid phone", () => {
    expect(
      carrierLeadSchema.safeParse({ ...base, phone: "hello" }).success,
    ).toBe(false);
  });

  it("rejects an invalid optional email but accepts empty", () => {
    expect(
      carrierLeadSchema.safeParse({ ...base, email: "not-an-email" }).success,
    ).toBe(false);
    expect(carrierLeadSchema.parse({ ...base, email: "" }).email).toBeNull();
    expect(carrierLeadSchema.parse({ ...base, email: "a@b.co" }).email).toBe(
      "a@b.co",
    );
  });

  it("journals M-26 stage as text, nulled when absent", () => {
    expect(carrierLeadSchema.parse(base).stage).toBeNull();
    expect(
      carrierLeadSchema.parse({ ...base, stage: "Waiting on MC" }).stage,
    ).toBe("Waiting on MC");
  });
});

describe("contactMessageSchema", () => {
  const base = {
    email: "shipper@example.com",
    body: "We need weekly reefer capacity out of Newark.",
    locale: "en",
  };

  it("accepts a minimal valid message", () => {
    const parsed = contactMessageSchema.parse(base);
    expect(parsed.email).toBe("shipper@example.com");
    expect(parsed.phone).toBeNull();
  });

  it("rejects a too-short body and a missing email", () => {
    expect(
      contactMessageSchema.safeParse({ ...base, body: "hi" }).success,
    ).toBe(false);
    expect(
      contactMessageSchema.safeParse({ ...base, email: "" }).success,
    ).toBe(false);
  });

  it("rejects a body over 5000 characters", () => {
    expect(
      contactMessageSchema.safeParse({ ...base, body: "x".repeat(5001) })
        .success,
    ).toBe(false);
  });
});

describe("freightQuoteSchema", () => {
  const base = { email: "ops@shipper.com", locale: "en" };

  it("accepts a minimal quote (email only)", () => {
    const parsed = freightQuoteSchema.parse(base);
    expect(parsed.email).toBe("ops@shipper.com");
    expect(parsed.pickup_zip).toBeNull();
    expect(parsed.weight_lbs).toBeNull();
  });

  it("validates ZIP codes", () => {
    expect(
      freightQuoteSchema.parse({ ...base, pickup_zip: "07102" }).pickup_zip,
    ).toBe("07102");
    expect(
      freightQuoteSchema.parse({ ...base, pickup_zip: "07102-1234" })
        .pickup_zip,
    ).toBe("07102-1234");
    expect(
      freightQuoteSchema.safeParse({ ...base, pickup_zip: "123" }).success,
    ).toBe(false);
  });

  it("parses comma-formatted weight, nulls garbage, caps at 80k", () => {
    expect(
      freightQuoteSchema.parse({ ...base, weight_lbs: "42,000" }).weight_lbs,
    ).toBe(42000);
    expect(
      freightQuoteSchema.parse({ ...base, weight_lbs: "heavy" }).weight_lbs,
    ).toBeNull();
    expect(
      freightQuoteSchema.safeParse({ ...base, weight_lbs: "90,000" }).success,
    ).toBe(false);
  });

  it("rejects past pickup dates, accepts today and empty", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(
      freightQuoteSchema.parse({ ...base, pickup_date: today }).pickup_date,
    ).toBe(today);
    expect(
      freightQuoteSchema.parse({ ...base, pickup_date: "" }).pickup_date,
    ).toBeNull();
    expect(
      freightQuoteSchema.safeParse({ ...base, pickup_date: "2020-01-01" })
        .success,
    ).toBe(false);
    expect(
      freightQuoteSchema.safeParse({ ...base, pickup_date: "not-a-date" })
        .success,
    ).toBe(false);
  });
});

describe("subscriberSchema", () => {
  it("accepts a valid email and rejects invalid", () => {
    expect(
      subscriberSchema.parse({ email: "news@example.com", locale: "es" }),
    ).toEqual({ email: "news@example.com", locale: "es" });
    expect(
      subscriberSchema.safeParse({ email: "nope", locale: "en" }).success,
    ).toBe(false);
  });
});

describe("onboarding schemas", () => {
  const info = {
    company_name: "Rocque Trucking LLC",
    full_name: "Emmanuel Larocque",
    email: "carrier@example.com",
    phone: "(908) 404-5373",
    locale: "en",
  };

  it("onboardingInfoSchema accepts minimal company info", () => {
    const parsed = onboardingInfoSchema.parse(info);
    expect(parsed.company_name).toBe("Rocque Trucking LLC");
    expect(parsed.ein).toBeNull();
    expect(parsed.mc_number).toBeNull();
  });

  it("onboardingInfoSchema validates EIN format", () => {
    expect(onboardingInfoSchema.parse({ ...info, ein: "12-3456789" }).ein).toBe(
      "12-3456789",
    );
    expect(onboardingInfoSchema.parse({ ...info, ein: "123456789" }).ein).toBe(
      "123456789",
    );
    expect(
      onboardingInfoSchema.safeParse({ ...info, ein: "12-345" }).success,
    ).toBe(false);
  });

  it("onboardingInfoSchema rejects short names and bad dates", () => {
    expect(
      onboardingInfoSchema.safeParse({ ...info, company_name: "A" }).success,
    ).toBe(false);
    expect(
      onboardingInfoSchema.safeParse({ ...info, insurance_expiry: "6/1/2026" })
        .success,
    ).toBe(false);
  });

  it("uploadRequestSchema enforces UUID + doc_type allow-list", () => {
    const carrier_id = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
    expect(
      uploadRequestSchema.parse({ carrier_id, doc_type: "coi" }).doc_type,
    ).toBe("coi");
    expect(
      uploadRequestSchema.parse({ carrier_id, doc_type: "noa" }).doc_type,
    ).toBe("noa");
    expect(
      uploadRequestSchema.safeParse({ carrier_id, doc_type: "passport" })
        .success,
    ).toBe(false);
    expect(
      uploadRequestSchema.safeParse({ carrier_id: "123", doc_type: "coi" })
        .success,
    ).toBe(false);
  });

  it("onboardingAccountSchema requires ESIGN consent + 8-char password", () => {
    const account = {
      carrier_id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      email: "carrier@example.com",
      password: "hunter2hunter2",
      full_name: "Emmanuel Larocque",
      phone: "(908) 404-5373",
      company_name: "Rocque Trucking LLC",
      esign_consent: "on",
      locale: "en",
    };
    expect(onboardingAccountSchema.parse(account).esign_consent).toBe("on");
    expect(
      onboardingAccountSchema.safeParse({ ...account, esign_consent: "" })
        .success,
    ).toBe(false);
    expect(
      onboardingAccountSchema.safeParse({ ...account, password: "short" })
        .success,
    ).toBe(false);
  });
});
