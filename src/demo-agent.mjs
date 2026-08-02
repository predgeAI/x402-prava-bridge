// Demo agent — a card-carrying agent that answers a question by BUYING the data
// it needs from a wallet-only x402 seller, through the bridge.
//
//   node src/demo-agent.mjs "Is wallet 0x8dab… smart money?"        # plan only (no money)
//   node src/demo-agent.mjs --settle "..."                          # also settle the x402 leg
//
// Flow per call: /pay (probe + spend-policy) → Prava card leg (auto mandate vs
// passkey session) → /settle (USDC on Base) → answer with the outcome_verified flag.
// The Prava card charge + passkey are executed in Prava (sandbox) at the "card
// leg" step; this script drives the x402 side and narrates the decision.
const BRIDGE = process.env.BRIDGE_URL || "http://localhost:8899";
const PREDGE = process.env.PREDGE_BASE || "https://x402-api-production-266e.up.railway.app";

import { createInterface } from "node:readline/promises";
import { brainEnabled, routeWithLLM, explainWithLLM, MODEL } from "./brain.mjs";
const args = process.argv.slice(2);
const settle = args.includes("--settle");
const prava = args.includes("--prava"); // run the REAL Prava sandbox card leg (iframe + passkey)
const question = args.filter((a) => !a.startsWith("--")).join(" ") ||
  "What's the newest whale trade on Polymarket right now?"; // no address → whales/latest (AUTO beat)

// Decide which Predge endpoint answers the question (tiny router).
function routeFor(q) {
  const m = q.match(/0x[0-9a-fA-F]{40}/);
  if (m) return { url: `${PREDGE}/v1/wallets/${m[0].toLowerCase()}/history`, kind: "wallet-history" };
  return { url: `${PREDGE}/v1/whales/latest?limit=5`, kind: "whales-latest" };
}

const post = async (path, body) =>
  (await fetch(`${BRIDGE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();

function narrateCardLeg(policy) {
  if (policy.autonomous) {
    console.log(`  💳 Prava card leg: AUTO — charge standing mandate $${policy.totalUsd} (NO passkey). ${policy.reason}`);
  } else {
    console.log(`  💳 Prava card leg: ESCALATE — new payment session $${policy.totalUsd}, PASSKEY required. ${policy.reason}`);
    console.log(`     (agent creates the Prava session; the human approves with biometry — the Visa-track control surface)`);
  }
}

function answer(kind, data) {
  if (!data) return "  🤖 (plan only — run with --settle to fetch the data and answer)";
  if (kind === "wallet-history") {
    const s = data.summary ?? {};
    return `  🤖 Answer: over ${s.window ?? "the window"}, win rate ${Math.round((s.win_rate ?? 0) * 100)}% ` +
      `across ${s.decided_trades ?? 0} decided trades. Trust: outcome_verified=${JSON.stringify(data.outcome_verified)} ` +
      `(win rate is real, PnL is modelled — I can act on the win rate).`;
  }
  const t = (data.trades ?? [])[0];
  return t ? `  🤖 Answer: newest whale — wallet ${t.wallet?.slice(0, 10)}… score ${t.wallet_score}, ` +
    `30d win rate ${Math.round((t.wallet_win_rate_30d ?? 0) * 100)}%, bet $${t.size_usd} ${t.side} on "${t.market_title}".`
    : "  🤖 Answer: no whale trades in the window.";
}

console.log(`\n❓ ${question}`);
// The agent PLANS with OpenAI: which paid endpoint answers this, and which wallet?
let route;
if (brainEnabled()) {
  try {
    const r = await routeWithLLM(question);
    route = r.endpoint === "wallet-history" && r.wallet
      ? { url: `${PREDGE}/v1/wallets/${r.wallet.toLowerCase()}/history`, kind: "wallet-history" }
      : { url: `${PREDGE}/v1/whales/latest?limit=5`, kind: "whales-latest" };
    console.log(`🧠 OpenAI (${MODEL}) planned → ${route.kind}: ${r.rationale}`);
  } catch (e) {
    route = routeFor(question);
    console.log(`🧭 (OpenAI unavailable: ${e.message}) → ${route.kind}`);
  }
} else {
  route = routeFor(question);
  console.log(`🧭 needs Predge data → ${route.kind}  (set OPENAI_API_KEY to plan with OpenAI)`);
}
const { url, kind } = route;
console.log("");

// Preflight: fail cleanly if the bridge isn't running (instead of an undici stack trace).
try { const h = await fetch(`${BRIDGE}/health`); if (!h.ok) throw new Error(`HTTP ${h.status}`); }
catch {
  console.error(`❌ bridge not reachable at ${BRIDGE}\n   start it first (separate terminal):  cd ~/Documents/Playground/x402-prava-bridge && npm run server`);
  process.exit(1);
}

const plan = await post("/pay", { targetUrl: url });
if (!plan.paid_required) { console.log("  (resource is free — no payment needed)"); process.exit(0); }
console.log(`  🔎 402 → $${plan.x402_leg.price_usd} USDC on Base (payTo ${plan.x402_leg.pay_to.slice(0, 10)}…)`);
console.log(`  🚦 policy: ${plan.policy.path.toUpperCase()} (${plan.policy.instrument})`);

if (prava) {
  // REAL Prava sandbox card leg: create session → human approves in iframe → complete.
  const amt = plan.policy.totalUsd.toFixed(2);
  const sess = await post("/prava/session", { totalAmount: amt, description: `x402: ${kind}` });
  console.log(`  💳 Prava session ${sess.session_id} — open this hosted checkout and approve:`);
  console.log(`     use your Prava participant test card (from the hackathon email) · OTP + passkey on Prava's page`);
  console.log(`     ${sess.collect_url}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("     press Enter AFTER you approved in the iframe… ");
  rl.close();
  const done = await post("/prava/complete", { session_id: sess.session_id });
  console.log(done.ok
    ? `  ✅ card leg APPROVED (txn ${done.txn_ref_id}, card …${done.card_last4 ?? "----"})`
    : `  ❌ card leg failed: ${done.message ?? done.error}`);
} else {
  narrateCardLeg(plan.policy);
}

let data = null;
if (settle) {
  console.log("  ⛓  settling x402 USDC leg…");
  const s = await post("/settle", { targetUrl: url });
  if (s.settled) { console.log(`  ✅ settled (tx receipt present=${!!s.settle_receipt})`); data = s.data; }
  else console.log(`  ❌ settle failed: ${s.message ?? s.status}`);
}
// The agent ANSWERS with OpenAI over the data it just paid for (fallback: templated).
if (brainEnabled() && data) {
  try {
    const said = await explainWithLLM(question, data);
    console.log(`  🤖 ${said}`);
  } catch (e) {
    console.log(`  (OpenAI answer unavailable: ${e.message})`);
    console.log(answer(kind, data));
  }
} else {
  console.log(answer(kind, data));
}
