// x402 leg — probe an endpoint, parse the v2 402 challenge, pick a settlement leg.
//
// Predge (and x402 v2 generally) returns HTTP 402 with an empty JSON body and a
// `payment-required` response header = base64(JSON):
//   { x402Version, error, resource:{url,description,...},
//     accepts:[ { scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra } , … ] }
// amount is in the asset's ATOMIC units (USDC = 6 decimals → "5000" = $0.005).

const BASE_MAINNET = "eip155:8453";

/** Decode the payment-required header → the x402 challenge object. */
export function decodeChallenge(headerValue) {
  if (!headerValue) throw new Error("no payment-required header on the 402");
  const json = Buffer.from(headerValue, "base64").toString("utf8");
  return JSON.parse(json);
}

/** atomic units → decimal string, given decimals (USDC = 6). */
export function atomicToDecimal(amount, decimals = 6) {
  const s = String(amount).padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * Probe a target URL. Returns:
 *   { paid:false, status, body }                         when the resource is free/other
 *   { paid:true,  status:402, challenge, accepts, base } when payment is required
 * `base` is the Base-mainnet USDC leg (the one the bridge settles), with a
 * human `priceUsd` derived from the atomic amount. Never sends a payment.
 */
export async function probeX402(url, { init } = {}) {
  const res = await fetch(url, { ...init, redirect: "manual" });
  if (res.status !== 402) {
    const body = await res.text().catch(() => "");
    return { paid: false, status: res.status, url, body };
  }
  const challenge = decodeChallenge(res.headers.get("payment-required"));
  const accepts = Array.isArray(challenge.accepts) ? challenge.accepts : [];
  const base = accepts.find((a) => a.network === BASE_MAINNET && a.scheme === "exact");
  if (!base) throw new Error(`402 has no Base-mainnet exact leg; networks=${accepts.map((a) => a.network).join(",")}`);
  return {
    paid: true,
    status: 402,
    url,
    resource: challenge.resource,
    accepts,
    base: {
      ...base,
      priceUsd: atomicToDecimal(base.amount, 6), // USDC, 6 decimals
      assetSymbol: base.extra?.name ?? "USDC",
    },
  };
}
