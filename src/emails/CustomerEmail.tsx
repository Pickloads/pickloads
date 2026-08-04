import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { emailColors as c, emailFonts as f } from "./theme";
import { FOOTER_DICT, pick, type EmailLocale } from "./i18n";

/**
 * M-60 — shared customer-facing email layout. Same V4 vocabulary as the
 * M-14 InternalNotification (night band + amber rule on paper) with a
 * warmer body: paragraphs, optional definition rows, one amber CTA and the
 * localized dispatch-desk footer. Raw hexes are the V4 tokens 1:1 (email
 * clients can't read CSS variables — CLAUDE.md exception documented in
 * theme.ts).
 */
export interface CustomerEmailRow {
  label: string;
  value: string;
}

export function CustomerEmail({
  locale,
  eyebrow,
  title,
  preview,
  paragraphs,
  rows,
  cta,
  footNote,
}: {
  locale: EmailLocale;
  eyebrow: string;
  title: string;
  preview: string;
  paragraphs: string[];
  rows?: CustomerEmailRow[];
  cta?: { label: string; url: string };
  footNote?: string;
}) {
  const footer = pick(FOOTER_DICT, locale);
  return (
    <Html lang={locale}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: c.paper, margin: 0, padding: "24px 0" }}>
        <Container
          style={{
            maxWidth: "560px",
            backgroundColor: "#ffffff",
            border: `1px solid ${c.lineDark}`,
            borderRadius: "10px",
            overflow: "hidden",
          }}
        >
          <Section
            style={{
              backgroundColor: c.night,
              padding: "18px 28px",
              borderBottom: `3px solid ${c.amber}`,
            }}
          >
            <Text
              style={{
                fontFamily: f.mono,
                fontSize: "13px",
                letterSpacing: "0.12em",
                color: c.paper,
                margin: 0,
              }}
            >
              PICK<span style={{ color: c.amber }}>LOADS</span> · LOGISTICS
              GROUP
            </Text>
          </Section>
          <Section style={{ padding: "28px" }}>
            <Text
              style={{
                fontFamily: f.mono,
                fontSize: "11px",
                letterSpacing: "0.14em",
                textTransform: "uppercase" as const,
                color: c.amberDeep,
                margin: "0 0 6px",
              }}
            >
              {eyebrow}
            </Text>
            <Heading
              as="h1"
              style={{
                fontFamily: f.sans,
                fontSize: "21px",
                fontWeight: 800,
                color: c.ink,
                margin: "0 0 16px",
              }}
            >
              {title}
            </Heading>
            {paragraphs.map((p, i) => (
              <Text
                key={i}
                style={{
                  fontFamily: f.sans,
                  fontSize: "15px",
                  lineHeight: "1.6",
                  color: c.slateBody,
                  margin: "0 0 12px",
                }}
              >
                {p}
              </Text>
            ))}
            {rows && rows.length > 0 ? (
              <>
                <Hr style={{ borderColor: c.lineDark, margin: "16px 0 6px" }} />
                {rows.map((row) => (
                  <Section key={row.label} style={{ padding: "6px 0" }}>
                    <Text
                      style={{
                        fontFamily: f.mono,
                        fontSize: "10px",
                        letterSpacing: "0.12em",
                        textTransform: "uppercase" as const,
                        color: c.slateMid,
                        margin: 0,
                      }}
                    >
                      {row.label}
                    </Text>
                    <Text
                      style={{
                        fontFamily: f.sans,
                        fontSize: "15px",
                        color: c.ink,
                        margin: "2px 0 0",
                      }}
                    >
                      {row.value}
                    </Text>
                  </Section>
                ))}
              </>
            ) : null}
            {cta ? (
              <Section style={{ padding: "18px 0 6px" }}>
                <Button
                  href={cta.url}
                  style={{
                    backgroundColor: c.amber,
                    color: c.ink,
                    fontFamily: f.sans,
                    fontSize: "15px",
                    fontWeight: 800,
                    borderRadius: "6px",
                    padding: "13px 26px",
                  }}
                >
                  {cta.label}
                </Button>
              </Section>
            ) : null}
            <Hr style={{ borderColor: c.lineDark, margin: "16px 0 12px" }} />
            <Text
              style={{
                fontFamily: f.sans,
                fontSize: "13px",
                color: c.slateMid,
                margin: "0 0 4px",
              }}
            >
              {footer.questions}
            </Text>
            <Text
              style={{
                fontFamily: f.mono,
                fontSize: "11px",
                color: c.slateMid,
                margin: 0,
              }}
            >
              {footNote ?? footer.hours}
            </Text>
          </Section>
        </Container>
        <Container style={{ maxWidth: "560px" }}>
          <Text
            style={{
              fontFamily: f.mono,
              fontSize: "10px",
              color: c.steel,
              textAlign: "center" as const,
              margin: "14px 0 0",
            }}
          >
            PickLoads Logistics Group LLC · 50 Union Ave, Suite 805-A,
            Irvington, NJ 07111
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
