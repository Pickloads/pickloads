"use client";

import { useV4 } from "@/i18n/v4";

/* Newsletter signup (double opt-in per audit S-05). Wiring lands in M-14. */
export function NewsletterForm() {
  const tv = useV4();
  return (
    <div className="newsletter">
      <h3>{tv("Get Freight Insights in your inbox")}</h3>
      <div className="field">
        <label htmlFor="nl-email">{tv("Email address")}</label>
        <input
          id="nl-email"
          name="email"
          type="email"
          placeholder="you@yourcompany.com"
          autoComplete="email"
        />
      </div>
      <button
        className="btn btn-amber"
        type="button"
        onClick={() => {
          /* M-14: subscribe server action + confirmation email */
        }}
      >
        {tv("Subscribe")}
      </button>
      <div className="form-ok" style={{ flexBasis: "100%" }} role="status">
        {tv(
          "✓ CHECK YOUR INBOX — Confirm your email to finish subscribing. Market updates and dispatch tips, twice a month. No spam.",
        )}
      </div>
    </div>
  );
}
