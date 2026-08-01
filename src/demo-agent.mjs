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

const args = process.argv.slice(2);
const settle = args.includes("--settle");
const question = args.filter((a) => a !== "--settle").join(" ") ||
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

const { url, kind } = routeFor(question);
console.log(`\n❓ ${question}`);
console.log(`🧭 needs Predge data → ${kind}\n`);

const plan = await post("/pay", { targetUrl: url });
if (!plan.paid_required) { console.log("  (resource is free — no payment needed)"); process.exit(0); }
console.log(`  🔎 402 → $${plan.x402_leg.price_usd} USDC on Base (payTo ${plan.x402_leg.pay_to.slice(0, 10)}…)`);
console.log(`  🚦 policy: ${plan.policy.path.toUpperCase()} (${plan.policy.instrument})`);
narrateCardLeg(plan.policy);

let data = null;
if (settle) {
  console.log("  ⛓  settling x402 USDC leg…");
  const s = await post("/settle", { targetUrl: url });
  if (s.settled) { console.log(`  ✅ settled (tx receipt present=${!!s.settle_receipt})`); data = s.data; }
  else console.log(`  ❌ settle failed: ${s.message ?? s.status}`);
}
console.log(answer(kind, data));
