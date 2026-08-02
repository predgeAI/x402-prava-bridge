// The agent's brain — OpenAI. Two real uses:
//  1. routeWithLLM: read the user's natural-language question, decide WHICH paid
//     Predge endpoint answers it, and extract a wallet address if present.
//  2. explainWithLLM: turn the paid JSON the agent bought into a concise answer,
//     honouring the outcome_verified trust flag (win rate real, PnL modelled).
//
// Enabled when OPENAI_API_KEY is set (the hackathon gives $100 of OpenAI credit).
// Everything degrades gracefully to a regex router if the key is absent, so the
// demo still runs offline.
import OpenAI from "openai";

export const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
let _client;
function client() {
  if (!process.env.OPENAI_API_KEY) return null;
  return (_client ??= new OpenAI());
}
export function brainEnabled() { return !!client(); }

/** LLM planner → { endpoint, wallet, rationale } (or null if OpenAI is off). */
export async function routeWithLLM(question) {
  const c = client();
  if (!c) return null;
  const r = await c.chat.completions.create({
    model: MODEL,
    temperature: 0,
    messages: [
      { role: "system", content:
        "You are the planner for a card-carrying AI agent that buys Polymarket whale-trading " +
        "intelligence from the Predge x402 API. Two endpoints are available: " +
        "'whales-latest' (the newest large trades across the market) and 'wallet-history' " +
        "(the track record of one specific wallet). Pick the endpoint that answers the user's " +
        "question and extract a 0x wallet address if the user named one." },
      { role: "user", content: question },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "route", strict: true,
        schema: {
          type: "object", additionalProperties: false,
          properties: {
            endpoint: { type: "string", enum: ["whales-latest", "wallet-history"] },
            wallet: { type: ["string", "null"], description: "0x-address or null" },
            rationale: { type: "string", description: "one short sentence" },
          },
          required: ["endpoint", "wallet", "rationale"],
        },
      },
    },
  });
  return JSON.parse(r.choices[0].message.content);
}

/** LLM answer over the paid data → string (or null if OpenAI is off). */
export async function explainWithLLM(question, data) {
  const c = client();
  if (!c) return null;
  const r = await c.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content:
        "You are the agent answering the user using ONLY the paid Predge data provided. " +
        "Two sentences max. If the data carries outcome_verified, make clear the win rate is " +
        "independently verified while PnL is modelled — so you act on the win rate." },
      { role: "user", content: `Question: ${question}\nPaid data (JSON): ${JSON.stringify(data).slice(0, 2000)}` },
    ],
  });
  return r.choices[0].message.content.trim();
}
