// Spend-policy gate — the "Visa-track" feature. Small machine payments settle
// autonomously against a standing Prava mandate (no human); anything above the
// threshold escalates to a fresh Prava payment session that requires a passkey.
// Every decision is logged structurally so a human can audit what the agent
// bought, for how much, and whether it was autonomous or human-approved.

export const DEFAULT_THRESHOLD_USD = Number(process.env.BRIDGE_AUTO_THRESHOLD_USDC ?? "0.01");
export const BRIDGE_FEE_USD = Number(process.env.BRIDGE_FEE_USDC ?? "0"); // demo: no markup

/** Decide how a given call is paid. priceUsd is the x402 leg's USD amount. */
export function decidePolicy(priceUsd, threshold = DEFAULT_THRESHOLD_USD) {
  const price = Number(priceUsd);
  const totalUsd = +(price + BRIDGE_FEE_USD).toFixed(6);
  const autonomous = price <= threshold;
  return {
    autonomous,
    path: autonomous ? "auto" : "escalate",
    instrument: autonomous ? "mandate" : "session",
    reason: autonomous
      ? `price $${price} ≤ threshold $${threshold} → charge standing mandate, no passkey`
      : `price $${price} > threshold $${threshold} → new session, passkey required`,
    threshold,
    priceUsd: price,
    feeUsd: BRIDGE_FEE_USD,
    totalUsd,
  };
}

/** One structured audit line per bridged call. */
export function auditEntry({ url, base, policy, pravaRef, outcome }) {
  return {
    ts: new Date().toISOString(),
    url,
    amount_atomic: base?.amount,
    price_usd: policy?.priceUsd,
    total_usd: policy?.totalUsd,
    asset: base?.assetSymbol,
    network: base?.network,
    pay_to: base?.payTo,
    path: policy?.path, // auto | escalate
    instrument: policy?.instrument, // mandate | session
    prava_ref: pravaRef ?? null, // mandate_id | session_id
    outcome: outcome ?? "planned", // planned | approved | settled | declined
  };
}
