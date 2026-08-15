#!/usr/bin/env node
/**
 * FMCSA QCMobile response-SHAPE diagnostic (M-93).
 *
 *   FMCSA_WEBKEY=… node scripts/fmcsa-shape-check.mjs [usdot...]
 *
 * Exists because the official documentation does not publish an example
 * response envelope for `/carriers/{dotNumber}`, and the adapter's parser was
 * therefore written against an assumed shape. An assumed shape that happens to
 * return `not_found` is indistinguishable from a correct parse of an absent
 * record — which is exactly the ambiguity that made the first live failure
 * hard to read.
 *
 * ── WHAT IT PRINTS, AND WHAT IT REFUSES TO ───────────────────────────────
 *
 * Prints: HTTP status, top-level keys, whether a carrier object was located
 * and where, and the FIELD NAMES with their JavaScript types.
 *
 * Never prints: the webKey, the request URL (it carries the key), or any field
 * VALUE. A carrier record contains a physical address and a telephone number;
 * this is a shape check and has no business rendering either. The one
 * exception is `dotNumber`, echoed so you can confirm you got the record you
 * asked for — it is the number you typed on the command line.
 */

const BASE_URL = "https://mobile.fmcsa.dot.gov/qc/services";

const webKey = process.env.FMCSA_WEBKEY;
if (!webKey) {
  console.error(
    "✖ FMCSA_WEBKEY is not set in this runtime.\n" +
      "  Vercel variables are not present in a local shell — pass it inline:\n" +
      "    FMCSA_WEBKEY='…' node scripts/fmcsa-shape-check.mjs 21800",
  );
  process.exit(2);
}

const targets = process.argv.slice(2).filter(Boolean);
if (targets.length === 0) targets.push("21800", "999999999");

/**
 * Names whose VALUE is never printed, not even its type.
 *
 * The live QCMobile response carries a tax identifier and a full street
 * address. This output is meant to be safe to paste into an issue, so these
 * are reported as present and redacted. None of them is normalized or
 * persisted either — see the boundary note in fmcsa-qcmobile.ts.
 */
const SENSITIVE_FIELDS = new Set([
  "ein",
  "phyStreet",
  "phyCity",
  "phyZip",
  "phyCountry",
  "telephone",
  "faxNumber",
  "emailAddress",
]);

/** Where a carrier object might live, in the order the adapter tries. */
function locateCarrier(body) {
  if (typeof body !== "object" || body === null) return null;
  const content = body.content;
  if (content === null || content === undefined) {
    return { path: "content is null/undefined", carrier: null };
  }
  if (typeof content === "string") {
    return {
      path: `content is a STRING: ${JSON.stringify(content)}`,
      carrier: null,
    };
  }
  if (Array.isArray(content)) {
    if (content.length === 0)
      return { path: "content is an EMPTY array", carrier: null };
    const first = content[0];
    if (first && typeof first === "object" && first.carrier) {
      return { path: "content[0].carrier", carrier: first.carrier };
    }
    return { path: "content[0]", carrier: first };
  }
  if (content.carrier && typeof content.carrier === "object") {
    return { path: "content.carrier", carrier: content.carrier };
  }
  // The shape the adapter did NOT originally handle: content IS the carrier.
  if (content.dotNumber !== undefined || content.legalName !== undefined) {
    return { path: "content (carrier inline)", carrier: content };
  }
  return { path: "content is an object with no carrier", carrier: null };
}

for (const usdot of targets) {
  const n = String(usdot).replace(/\D+/g, "").replace(/^0+/, "");
  console.log(`\n════ USDOT ${n} ════`);

  let res;
  try {
    res = await fetch(
      `${BASE_URL}/carriers/${encodeURIComponent(n)}?webKey=${encodeURIComponent(webKey)}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch (err) {
    console.log(`  HTTP: request failed (${err.name})`);
    continue;
  }

  const raw = await res.text();
  console.log(`  HTTP status      : ${res.status}`);
  console.log(
    `  content-type     : ${res.headers.get("content-type") ?? "(none)"}`,
  );
  console.log(`  body bytes       : ${raw.length}`);

  if (/webkey not found/i.test(raw)) {
    console.log(
      "  ✖ credential REJECTED by the provider (key is wrong/expired)",
    );
    continue;
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    console.log("  ✖ body is not JSON");
    continue;
  }

  console.log(`  top-level keys   : ${Object.keys(body).join(", ")}`);
  console.log(
    `  retrievalDate    : ${typeof body.retrievalDate === "string" ? "present (string)" : "absent"}`,
  );

  const located = locateCarrier(body);
  console.log(`  carrier located  : ${located?.carrier ? "YES" : "NO"}`);
  console.log(`  carrier path     : ${located?.path ?? "(none)"}`);

  if (located?.carrier) {
    const c = located.carrier;
    console.log("  field names & types:");
    for (const k of Object.keys(c).sort()) {
      const v = c[k];
      const t = v === null ? "null" : Array.isArray(v) ? "array" : typeof v;

      // ── SENSITIVE FIELDS ARE REPORTED AS PRESENT AND NOTHING MORE ────────
      //
      // The live response carries `ein` and a full physical address. Their
      // PRESENCE is useful shape information; their contents are a tax
      // identifier and a street address, and this output is meant to be safe
      // to paste into an issue. Neither is normalized, neither is persisted,
      // and neither is printed — not even as a type, which for a fixed-format
      // value like an EIN already narrows it.
      if (SENSITIVE_FIELDS.has(k)) {
        console.log(`    ${k.padEnd(24)} [present — REDACTED]`);
        continue;
      }

      // Only dotNumber's value is echoed — it is the number you typed.
      const shown = k === "dotNumber" ? ` = ${JSON.stringify(v)}` : "";
      console.log(`    ${k.padEnd(24)} ${t}${shown}`);
    }
    // The fields the adapter depends on, and whether they exist at all.
    const required = [
      "dotNumber",
      "legalName",
      "dbaName",
      "allowToOperate",
      "outOfService",
      "outOfServiceDate",
    ];
    const missing = required.filter((k) => !(k in c));
    console.log(
      `  adapter fields   : ${missing.length === 0 ? "all present" : `MISSING ${missing.join(", ")}`}`,
    );
    // mcNumber is documented but frequently absent — reported, not required.
    console.log(`  mcNumber present : ${"mcNumber" in c ? "yes" : "no"}`);
  }

  // ── MC ↔ USDOT ─────────────────────────────────────────────────────────
  //
  // The docket SET is what proves the relationship. The carrier record shows
  // at most one MC, so a submitted MC checked against that field alone can
  // pass while belonging to a different registration.
  const dres = await fetch(
    `${BASE_URL}/carriers/${encodeURIComponent(n)}/docket-numbers?webKey=${encodeURIComponent(webKey)}`,
    {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    },
  ).catch(() => null);

  if (!dres) {
    console.log("  dockets          : request failed");
  } else {
    const draw = await dres.text();
    let dbody = null;
    try {
      dbody = JSON.parse(draw);
    } catch {
      /* reported as unparseable below */
    }
    const dcontent =
      dbody && typeof dbody === "object" ? dbody.content : undefined;
    const shape =
      dcontent === null || dcontent === undefined
        ? "null/absent"
        : Array.isArray(dcontent)
          ? `array(${dcontent.length})`
          : typeof dcontent;
    console.log(`  dockets          : http=${dres.status} content=${shape}`);
    if (Array.isArray(dcontent) && dcontent.length > 0) {
      const first = dcontent[0];
      // Entry KEYS only — the docket numbers themselves are public, but the
      // shape is what this diagnostic is for.
      console.log(
        `  docket entry keys: ${
          first && typeof first === "object"
            ? Object.keys(first).join(", ")
            : typeof first
        }`,
      );
    }
  }
}

console.log(
  "\nDone. No credential, URL, EIN, address or field value was printed.",
);
