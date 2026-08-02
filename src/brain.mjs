// The agent's brain — OpenAI. Three real uses, all standard OpenAI patterns:
//
//   1. planWithTools()  — OpenAI **function/tool calling**: the model is given two
//      "buy" tools (buy_whales_latest, buy_wallet_history) and must call exactly one.
//      Its tool choice IS the agent's purchase decision — which paid Predge x402
//      endpoint to spend money on, and which wallet. This is the canonical agentic
//      pattern: the LLM drives the action, we just execute the tool it picked.
//   2. assessTrust()    — the model audits the purchased data's trust: given the
//      outcome_verified flag it states, in one line, what the agent may act on
//      (verified win rate) vs. must discount (modelled PnL).
//   3. explainWithLLM() — the model writes the final natural-language answer over the
//      data the agent just bought.
//
// Model: OPENAI_MODEL (default gpt-4o-mini). Enabled when OPENAI_API_KEY is set (the
// hackathon grants $100 of OpenAI credit). Everything degrades to a regex router when
// the key is absent, so the demo still runs offline.
import OpenAI from "openai";

export const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
let _client;
function client() {
  if (!process.env.OPENAI_API_KEY) return null;
  return (_client ??= new OpenAI());
}
export function brainEnabled() { return !!client(); }

// The two things a card-carrying agent can BUY from Predge, expressed as OpenAI tools.
const BUY_TOOLS = [
  {
    type: "function",
    function: {
      name: "buy_whales_latest",
      description:
        "Buy the newest large 'whale' trades across Polymarket. Use for general questions " +
        "about recent / biggest / latest smart-money activity when NO specific wallet is named.",
      parameters: {
        type: "object", additionalProperties: false,
        properties: { reason: { type: "string", description: "one short sentence on why this endpoint" } },
        required: ["reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buy_wallet_history",
      description:
        "Buy ONE specific wallet's trading track record. Use when the user names or asks about " +
        "a specific 0x wallet address (e.g. 'is 0x… smart money?').",
      parameters: {
        type: "object", additionalProperties: false,
        properties: {
          wallet: { type: "string", description: "the 0x wallet address the user referenced" },
          reason: { type: "string", description: "one short sentence on why this endpoint" },
        },
        required: ["wallet", "reason"],
      },
    },
  },
];

/**
 * OpenAI tool-calling planner. The model MUST call one buy tool; its choice is the
 * agent's purchase decision. Returns { endpoint, wallet, rationale } or null (OpenAI off).
 */
export async function planWithTools(question) {
  const c = client();
  if (!c) return null;
  const r = await c.chat.completions.create({
    model: MODEL,
    temperature: 0,
    tools: BUY_TOOLS,
    tool_choice: "required", // force a purchase decision — no chit-chat
    messages: [
      { role: "system", content:
        "You are the buying planner for a card-carrying AI agent that purchases Polymarket " +
        "whale-trading intelligence from the Predge x402 API. Call EXACTLY ONE tool to buy the " +
        "data that answers the user's question." },
      { role: "user", content: question },
    ],
  });
  const call = r.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) return null;
  const args = JSON.parse(call.function.arguments || "{}");
  return {
    endpoint: call.function.name === "buy_wallet_history" ? "wallet-history" : "whales-latest",
    wallet: args.wallet ?? null,
    rationale: args.reason ?? call.function.name,
  };
}

/** One-line trust audit over the purchased data (or null if OpenAI is off). */
export async function assessTrust(data) {
  const c = client();
  if (!c) return null;
  const r = await c.chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [
      { role: "system", content:
        "You audit the trustworthiness of purchased market data. In ONE short line, state what an " +
        "agent may safely act on versus must discount, based on the `outcome_verified` flag " +
        "(verified = win rate resolved on-chain; modelled = a PnL estimate)." },
      { role: "user", content: JSON.stringify(data).slice(0, 1500) },
    ],
  });
  return r.choices[0].message.content.trim();
}

/** Final natural-language answer over the purchased data (or null if OpenAI is off). */
export async function explainWithLLM(question, data) {
  const c = client();
  if (!c) return null;
  const r = await c.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content:
        "You are the agent answering the user using ONLY the paid Predge data provided. " +
        "Two sentences max, concrete and specific." },
      { role: "user", content: `Question: ${question}\nPaid data (JSON): ${JSON.stringify(data).slice(0, 2000)}` },
    ],
  });
  return r.choices[0].message.content.trim();
}
