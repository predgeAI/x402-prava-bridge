// Mini eval for the OpenAI brain — runs sample questions through the tool-calling
// planner and prints the buy decision it makes. No payment, no bridge: this isolates
// and demonstrates the OpenAI reasoning step.  Run:  npm run eval:brain
import { brainEnabled, planWithTools, MODEL } from "./brain.mjs";

if (!brainEnabled()) {
  console.error("Set OPENAI_API_KEY (and optionally OPENAI_MODEL) to run the brain eval.");
  process.exit(1);
}

const CASES = [
  "what's the biggest whale trade on Polymarket right now?",
  "is wallet 0x8dab6cf42d7e4d1cd6cca897b9e12a8cbe6d69e8 smart money?",
  "show me the latest large bets across the market",
  "check the track record of 0x1111111111111111111111111111111111111111",
];

console.log(`\nbrain eval — OpenAI model: ${MODEL}\n`);
for (const q of CASES) {
  const p = await planWithTools(q);
  const tgt = /0x[0-9a-fA-F]{40}/.test(q) ? "wallet-history" : "whales-latest";
  const ok = p.endpoint === tgt ? "✓" : "✗";
  console.log(`${ok} ❓ ${q}`);
  console.log(`   → ${p.endpoint}${p.wallet ? ` (${p.wallet})` : ""} — ${p.rationale}\n`);
}
