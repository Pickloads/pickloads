import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { emailColors as c, emailFonts as f } from "./theme";

/**
 * Double-opt-in confirmation (audit S-05: CAN-SPAM hygiene + deliverability).
 * Sent to the subscriber; the button hits /api/newsletter/confirm.
 *
 * M-69/P-1: this template promises "unsubscribe anytime" in its body. Until
 * M-69 there was no unsubscribe route at all, so the promise was unbacked —
 * a CAN-SPAM exposure on the first marketing send. `unsubscribeUrl` is now
 * rendered as a real footer link (and the same token is carried in the RFC
 * 8058 List-Unsubscribe headers by the sending action). `null` only in a
 * secretless environment where no subscriber row — and therefore no token —
 * exists; the honest fallback names the support mailbox instead of printing
 * a dead link.
 */
export function NewsletterConfirmationEmail({
  confirmUrl,
  unsubscribeUrl = null,
}: {
  confirmUrl: string;
  unsubscribeUrl?: string | null;
}) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Confirm your email to start receiving Freight Insights</Preview>
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
              PICK<span style={{ color: c.amber }}>LOADS</span> · FREIGHT
              INSIGHTS
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
              One more step
            </Text>
            <Heading
              as="h1"
              style={{
                fontFamily: f.sans,
                fontSize: "20px",
                fontWeight: 800,
                color: c.ink,
                margin: "0 0 12px",
              }}
            >
              Confirm your subscription.
            </Heading>
            <Text
              style={{
                fontFamily: f.sans,
                fontSize: "15px",
                lineHeight: "1.6",
                color: c.slateBody,
                margin: "0 0 20px",
              }}
            >
              Tap the button below and you&apos;re on the list — market updates
              and dispatch tips, twice a month. No spam, unsubscribe anytime.
            </Text>
            <Button
              href={confirmUrl}
              style={{
                backgroundColor: c.amber,
                color: c.ink,
                fontFamily: f.sans,
                fontSize: "14px",
                fontWeight: 800,
                letterSpacing: "0.02em",
                borderRadius: "6px",
                padding: "13px 22px",
              }}
            >
              Confirm my email →
            </Button>
            <Hr style={{ borderColor: c.lineDark, margin: "22px 0 12px" }} />
            <Text
              style={{
                fontFamily: f.mono,
                fontSize: "11px",
                lineHeight: "1.6",
                color: c.slateMid,
                margin: 0,
              }}
            >
              Button not working? Paste this link into your browser:
              <br />
              <Link
                href={confirmUrl}
                style={{ color: c.green, textDecoration: "underline" }}
              >
                {confirmUrl}
              </Link>
            </Text>
            <Text
              style={{
                fontFamily: f.mono,
                fontSize: "11px",
                color: c.slateMid,
                margin: "12px 0 0",
              }}
            >
              {"// Didn't sign up? Ignore this email and nothing happens."}
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
          <Text
            style={{
              fontFamily: f.mono,
              fontSize: "10px",
              color: c.steel,
              textAlign: "center" as const,
              margin: "8px 0 0",
            }}
          >
            {unsubscribeUrl ? (
              <Link
                href={unsubscribeUrl}
                style={{ color: c.steel, textDecoration: "underline" }}
              >
                Unsubscribe from Freight Insights
              </Link>
            ) : (
              "To unsubscribe, email support@pickloads.com."
            )}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
