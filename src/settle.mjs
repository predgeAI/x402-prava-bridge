// x402 USDC leg — pay a 402 endpoint with the bridge's float wallet and return
// the data + settle receipt. Mirrors Predge's own buyer client (@x402/fetch +
// ExactEvmScheme + viem). The facilitator submits the EIP-3009 authorization and
// pays gas, so the float wallet needs only USDC (Base Sepolia testnet USDC from
// faucet.circle.com for the demo — no real crypto spent; the REAL money in this
// product is the Prava card leg).
//
// Float key: FLOAT_PRIVATE_KEY env, else ~/.predge-x402/buyer.json (`private_key`),
// the same wallet Predge's smoke tests already use.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";

function loadFloatKey() {
  if (process.env.FLOAT_PRIVATE_KEY) return process.env.FLOAT_PRIVATE_KEY;
  const file = join(homedir(), ".predge-x402", "buyer.json");
  return JSON.parse(readFileSync(file, "utf8")).private_key;
}

let _c;
function client() {
  if (_c) return _c;
  const signer = privateKeyToAccount(loadFloatKey());
  const c = new x402Client();
  c.register("eip155:*", new ExactEvmScheme(signer));
  _c = { signer, pay: wrapFetchWithPayment(fetch, c), http: new x402HTTPClient(c) };
  return _c;
}

/** Float wallet address — derived from the key, no transaction. */
export function floatAddress() {
  return client().signer.address;
}

/**
 * Pay the x402 leg for targetUrl. SPENDS USDC (testnet by default). Returns
 * { ok, status, settle, data }. Only call after the Prava card leg is approved.
 */
export async function settleX402(targetUrl, { init } = {}) {
  const { pay, http } = client();
  const res = await pay(targetUrl, { method: "GET", ...init });
  // processResponse → { status, paymentStatus:"settled", body:<data>, header:<settle receipt> }
  const processed = await http.processResponse(res);
  let settle = processed?.header ?? null;
  if (!settle) {
    const raw = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
    if (raw) { try { settle = JSON.parse(Buffer.from(raw, "base64").toString("utf8")); } catch { /* leave null */ } }
  }
  return {
    ok: res.ok && processed?.paymentStatus !== "failed",
    status: processed?.status ?? res.status,
    paymentStatus: processed?.paymentStatus ?? null,
    settle,
    data: processed?.body ?? null,
  };
}
