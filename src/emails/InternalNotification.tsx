import {
  Body,
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

/**
 * Shared layout for internal notification emails (lead / quote / contact) —
 * V4 vocabulary translated to email HTML: night header band with the amber
 * wordmark, mono eyebrow, definition rows on paper.
 */
export interface NotificationRow {
  label: string;
  value: string;
}

export function InternalNotification({
  eyebrow,
  title,
  preview,
  rows,
  footNote,
}: {
  eyebrow: string;
  title: string;
  preview: string;
  rows: NotificationRow[];
  footNote?: string;
}) {
  return (
    <Html lang="en">
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
              PICK<span style={{ color: c.amber }}>LOADS</span> · DISPATCH DESK
            </Text>
          </Section>
          <Section style={{ padding: "28px" }}>
            <Text
              style={{
                fontFamily: f.mono,
                fontSize: "11px",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
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
                fontSize: "20px",
                fontWeight: 800,
                color: c.ink,
                margin: "0 0 18px",
              }}
            >
              {title}
            </Heading>
            <Hr style={{ borderColor: c.lineDark, margin: "0 0 6px" }} />
            {rows.map((row) => (
              <Section key={row.label} style={{ padding: "6px 0" }}>
                <Text
                  style={{
                    fontFamily: f.mono,
                    fontSize: "10px",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
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
            {footNote ? (
              <>
                <Hr style={{ borderColor: c.lineDark, margin: "14px 0" }} />
                <Text
                  style={{
                    fontFamily: f.mono,
                    fontSize: "11px",
                    color: c.slateMid,
                    margin: 0,
                  }}
                >
                  {footNote}
                </Text>
              </>
            ) : null}
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
