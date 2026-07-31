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

const app = express();
app.use(express.json());

const AUDIT = [];
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

app.get("/audit", (_req, res) => res.json({ count: AUDIT.length, entries: AUDIT }));

const PORT = Number(process.env.PORT ?? 8899);
app.listen(PORT, () => console.log(`x402-prava-bridge on :${PORT} (threshold $${DEFAULT_THRESHOLD_USD})`));
