// x402-prava-bridge — HTTP surface.
//
//   GET  /health           liveness + effective config
//   POST /pay { targetUrl } probe the target, decide the spend-policy, and return
//                           a PAYMENT PLAN: the Prava card-leg params (ready for
//                           create_payment_session / a mandate charge) and the
//                           x402 USDC-leg params (payTo/amount/network).
//
// The bridge NEVER moves money on its own here. Executing the two legs — the
// Prava charge (passkey/mandate) and the on-chain USDC settle from the float —
// are separate authorized steps. This keeps the money path owner-controlled
// while the whole decision + orchestration is real and demoable.
import express from "express";
import { probeX402 } from "./x402.mjs";
import { decidePolicy, auditEntry, DEFAULT_THRESHOLD_USD, BRIDGE_FEE_USD } from "./policy.mjs";
import { settleX402, floatAddress } from "./settle.mjs";
import { cardLegSession, pollResult, reportStatus } from "./prava.mjs";

const app = express();
app.use(express.json());

const AUDIT = [];
const SESSIONS = new Map(); // sessionId → { session_token, iframe_url } for the collect page
const log = (e) => { AUDIT.push(e); console.log("audit", JSON.stringify(e)); };

app.get("/health", (_req, res) => {
  let float = null;
  try { float = floatAddress(); } catch { /* no float key configured */ }
  res.json({
    ok: true,
    service: "x402-prava-bridge",
    threshold_usd: DEFAULT_THRESHOLD_USD,
    bridge_fee_usd: BRIDGE_FEE_USD,
    float_wallet: float,
    prava_sandbox: Boolean(process.env.PRAVA_SK_TEST),
    bridged_calls: AUDIT.length,
  });
});

// x402 USDC leg. SPENDS from the float wallet — call ONLY after the Prava card
// leg is approved. Point it at a Base Sepolia Predge endpoint for a no-real-money
// demo; a mainnet target spends real USDC ($0.005+).
app.post("/settle", async (req, res) => {
  const targetUrl = req.body?.targetUrl;
  if (!targetUrl || !/^https?:\/\//.test(targetUrl)) {
    return res.status(400).json({ error: "targetUrl (http/https) required" });
  }
  try {
    const out = await settleX402(targetUrl);
    const last = AUDIT[AUDIT.length - 1];
    if (last && last.url === targetUrl) last.outcome = out.ok ? "settled" : "settle_failed";
    res.status(out.ok ? 200 : 502).json({ settled: out.ok, status: out.status, settle_receipt: out.settle, data: out.data });
  } catch (e) {
    res.status(502).json({ error: "settle_failed", message: String(e.message ?? e) });
  }
});

app.post("/pay", async (req, res) => {
  const targetUrl = req.body?.targetUrl;
  if (!targetUrl || !/^https?:\/\//.test(targetUrl)) {
    return res.status(400).json({ error: "targetUrl (http/https) required" });
  }
  let probe;
  try {
    probe = await probeX402(targetUrl);
  } catch (e) {
    return res.status(502).json({ error: "probe_failed", message: String(e.message ?? e) });
  }

  // Free / non-402 resource → nothing to pay; the bridge just passes it through.
  if (!probe.paid) {
    return res.json({ paid: false, status: probe.status, passthrough: true, note: "resource is free or non-402; no payment needed" });
  }

  const policy = decidePolicy(probe.base.priceUsd);
  const merchantName = "x402-prava-bridge";
  const plan = {
    paid_required: true,
    resource: probe.resource,
    x402_leg: {
      network: probe.base.network,
      asset: probe.base.asset,
      amount_atomic: probe.base.amount,
      price_usd: probe.base.priceUsd,
      pay_to: probe.base.payTo,
      max_timeout_s: probe.base.maxTimeoutSeconds,
    },
    policy,
    // Ready to hand to create_payment_session (escalate) or a mandate charge (auto).
    prava_leg: {
      instrument: policy.instrument, // mandate | session
      total_amount: policy.totalUsd.toFixed(2),
      currency: "USD",
      merchant_name: merchantName,
      merchant_url: "https://predge.io",
      merchant_country: "US",
      products: [
        {
          description: `x402 data: ${(probe.resource?.description ?? targetUrl).slice(0, 90)}`,
          unit_price: policy.totalUsd.toFixed(2),
          quantity: 1,
        },
      ],
    },
  };
  log(auditEntry({ url: targetUrl, base: probe.base, policy, outcome: "planned" }));
  res.json(plan);
});

// --- Prava card leg (sandbox) -------------------------------------------------
// Step 1: create a session; the human opens iframe_url, enters the test Visa
// card + passkey. No charge happens here.
app.post("/prava/session", async (req, res) => {
  const totalAmount = String(req.body?.totalAmount ?? "0.01");
  const description = String(req.body?.description ?? "x402 data purchase");
  try {
    const s = await cardLegSession(totalAmount, description);
    SESSIONS.set(s.session_id, { session_token: s.session_token, iframe_url: s.iframe_url });
    // The bare Prava iframe_url is NOT standalone-openable — it must be mounted via
    // the Prava front-end SDK (collectPAN with the session_token). So we hand back a
    // LOCAL collect page that does exactly that.
    const collect_url = `${req.protocol}://${req.get("host")}/collect/${s.session_id}`;
    res.json({ session_id: s.session_id, collect_url, expires_at: s.expires_at,
      next: "open collect_url in a browser, enter the sandbox Visa test card + passkey, then POST /prava/complete" });
  } catch (e) {
    res.status(502).json({ error: "prava_session_failed", message: String(e.message ?? e) });
  }
});

// Local collect page: loads the Prava front-end SDK, initialises with the
// publishable key, and mounts the card-collection iframe (collectPAN) with the
// session token. Card data never touches this page — it's served from Prava's domain.
app.get("/collect/:sessionId", (req, res) => {
  const s = SESSIONS.get(req.params.sessionId);
  if (!s) return res.status(404).send("unknown or expired session — create one via POST /prava/session");
  const pk = process.env.PRAVA_PK_TEST ?? "";
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8">
<title>Prava card — x402-prava-bridge</title></head>
<body style="font-family:system-ui,sans-serif;max-width:540px;margin:40px auto;padding:0 16px">
<h3>Enter the sandbox Visa test card</h3>
<p>Card <b>4622 9431 2313 7789</b> · CVV <b>757</b> · exp <b>12/27</b> · bank-OTP <b>456789</b>,
then approve with your passkey. Card data is served from Prava's domain — it never touches this page.</p>
<div id="card-form"></div>
<p id="status">loading Prava SDK…</p>
<script type="module">
  const set = (t) => { document.getElementById("status").textContent = t; };
  async function loadPravaSDK() {
    const urls = [
      "https://cdn.jsdelivr.net/npm/@prava-sdk/core@0.1.2/+esm",
      "https://esm.sh/@prava-sdk/core@0.1.2",
    ];
    let lastErr;
    for (const u of urls) {
      try { const m = await import(u); if (m && m.PravaSDK) return m.PravaSDK; lastErr = new Error("module has no PravaSDK export: " + u); }
      catch (e) { lastErr = e; }
    }
    throw lastErr;
  }
  try {
    const PravaSDK = await loadPravaSDK();
    const prava = new PravaSDK({ publishableKey: ${JSON.stringify(pk)} });
    await prava.collectPAN({
      sessionToken: ${JSON.stringify(s.session_token)},
      iframeUrl: ${JSON.stringify(s.iframe_url)},
      container: "#card-form",
      onSuccess: (d) => set("✓ card enrolled (" + (d.brand||"card") + " …" + (d.last4||"----") + ") — return to the terminal and press Enter"),
      onError: (e) => set("✗ collect error: " + (e && e.message ? e.message : e)),
    });
    set("ready — enter the card above, then approve the passkey");
  } catch (e) { set("✗ SDK/collect failed: " + (e && e.message ? e.message : String(e))); console.error("prava collect:", e); }
</script>
</body></html>`);
});

// Step 2: after the human approved, poll for the one-time credentials and report
// the merchant outcome. Returns masked result only (never the raw card token/CVV).
app.post("/prava/complete", async (req, res) => {
  const sessionId = req.body?.session_id;
  if (!sessionId) return res.status(400).json({ error: "session_id required" });
  try {
    const r = await pollResult(sessionId);
    if (!r.txn_ref_id) return res.status(502).json({ error: "no_txn_ref", status: r.status });
    const report = await reportStatus(sessionId, r.txn_ref_id, "APPROVED");
    res.json({ ok: true, status: r.status, txn_ref_id: r.txn_ref_id, card_last4: r.card_last4, reported: report?.status ?? "APPROVED" });
  } catch (e) {
    res.status(502).json({ error: "prava_complete_failed", message: String(e.message ?? e) });
  }
});

app.get("/audit", (_req, res) => res.json({ count: AUDIT.length, entries: AUDIT }));

const PORT = Number(process.env.PORT ?? 8899);
app.listen(PORT, () => console.log(`x402-prava-bridge on :${PORT} (threshold $${DEFAULT_THRESHOLD_USD})`));
