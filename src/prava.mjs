// Prava card leg (SANDBOX) — the bridge is the merchant of record. It opens a
// Prava payment session, the human enters the test Visa card + passkey in the
// returned iframe, then the bridge polls for the one-time virtual-card
// credentials and reports the outcome. Sandbox only: no real money moves.
//
// Flow (docs.prava.space/guides/add-payments-to-your-ai-app):
//   POST /v1/sessions                       → { session_id, iframe_url, expires_at }
//   [human approves in iframe_url + passkey]
//   GET  /v1/sessions/{id}/payment-result   → status pending → awaiting_result → completed
//   POST /v1/sessions/{id}/report-status    → { txn_ref_id, txn_status: APPROVED|DECLINED }
//
// Key from PRAVA_SK_TEST (sandbox secret). Load with: node --env-file=.env …
const BASE = process.env.PRAVA_API_BASE || "https://sandbox.api.prava.space";

function sk() {
  const k = process.env.PRAVA_SK_TEST;
  if (!k) throw new Error("PRAVA_SK_TEST not set — put the sandbox sk_test_ key in .env");
  return k;
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${sk()}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`Prava ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

/** Create a sandbox payment session. Returns the raw response incl. iframe_url. */
export async function createSession({
  totalAmount, merchantName = "x402-prava-bridge", merchantUrl = "https://predge.io",
  country = "US", description = "x402 data purchase",
  userId = "predge-bridge-demo", userEmail = "hello@predge.io",
}) {
  return api("POST", "/v1/sessions", {
    user_id: userId,
    user_email: userEmail,
    total_amount: totalAmount, // "0.01" (2dp)
    currency: "USD",
    // Hosted mode: user is redirected to a Prava-hosted page (Prava's domain), so
    // card entry + passkey/WebAuthn create happen SAME-ORIGIN and actually complete.
    // Embedding put the passkey in a cross-origin iframe, which browsers block.
    integration_type: process.env.PRAVA_INTEGRATION || "full_checkout",
    purchase_context: [{
      merchant_details: { name: merchantName, url: merchantUrl, country_code_iso2: country },
      product_details: [{ description, unit_price: totalAmount, quantity: 1 }],
    }],
  });
}

/** Poll payment-result until awaiting_result/completed or timeout. */
export async function pollResult(sessionId, { timeoutMs = 300000, intervalMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = await api("GET", `/v1/sessions/${sessionId}/payment-result`);
    const status = r.status ?? r.payment_status;
    if (status === "awaiting_result" || status === "completed") {
      const li = r.transactions?.[0]?.line_items?.[0] ?? {};
      return { status, txn_ref_id: li.txn_ref_id ?? r.txn_ref_id, card_last4: (li.token ?? "").toString().slice(-4) || null, raw: r };
    }
    if (Date.now() > deadline) throw new Error(`payment-result timed out (last status: ${status ?? "unknown"})`);
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}

/** Report the merchant-side outcome for the session. */
export async function reportStatus(sessionId, txnRefId, txnStatus = "APPROVED") {
  return api("POST", `/v1/sessions/${sessionId}/report-status`, { txn_ref_id: txnRefId, txn_status: txnStatus });
}

/** Create a session; returns id + token + iframe_url (token is needed by the
 *  front-end SDK collectPAN mount — the bare iframe_url is NOT standalone-openable). */
export async function cardLegSession(totalAmount, description) {
  const s = await createSession({ totalAmount, description });
  return { session_id: s.session_id, session_token: s.session_token, iframe_url: s.iframe_url, expires_at: s.expires_at };
}
