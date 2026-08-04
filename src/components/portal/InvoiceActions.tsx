"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { generateLoadInvoice } from "@/app/actions/billing";
import { formatMoney } from "@/lib/loads";

/**
 * M-31 — "Generate invoice" on a delivered load. Invoices the DISPATCH FEE
 * only (compliance rule in src/lib/stripe.ts). Honest disabled state when
 * Stripe isn't configured.
 */
export function GenerateInvoiceButton({
  loadId,
  fee,
  configured,
}: {
  loadId: string;
  fee: number;
  configured: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!configured) {
    return (
      <span
        className="pbadge"
        title="Set STRIPE_SECRET_KEY to enable dispatch-fee invoicing"
      >
        Stripe not connected
      </span>
    );
  }

  function run() {
    setError(null);
    startTransition(async () => {
      const result = await generateLoadInvoice(loadId);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <button
        type="button"
        className="btn btn-green btn-sm"
        style={{ padding: "5px 10px", fontSize: ".68rem" }}
        disabled={pending}
        aria-busy={pending}
        onClick={run}
      >
        {pending ? "Invoicing…" : `Invoice ${formatMoney(fee)}`}
      </button>
      {error ? (
        <span role="alert" style={{ fontFamily: "var(--font-mono)", color: "#f2c9c9", fontSize: ".66rem" }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
