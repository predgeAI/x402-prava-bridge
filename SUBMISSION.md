# Devfolio submission — x402-prava-bridge

**Tagline:** A card-carrying AI agent buys from any wallet-only x402 API — no crypto
wallet, no top-up — while the human keeps control of anything expensive.

## The user & the problem
AI agents are starting to pay for things, but the two sides don't meet. Sellers of
machine data — like **Predge**, a live x402 API selling Polymarket whale-trading
intelligence — accept only **USDC on-chain**: you need a funded crypto wallet and a
private key. Most agents (and the people running them) have a **card**, not a wallet.
So the agents that most need the data can't pay for it, and the sellers can't reach
them.

## The product
**x402-prava-bridge** sits in front of any HTTP-402 endpoint. A card-only agent asks
it for data; the bridge:
1. reads the 402 payment requirement (decodes the `payment-required` header → `accepts[]`),
2. decides a **spend-policy** — small calls go through autonomously under a standing
   Prava **mandate**; anything above a threshold **escalates to a passkey**,
3. charges the card via **Prava**,
4. settles the **USDC** leg on **Base**,
5. returns the paid data — with a machine-readable `outcome_verified` trust flag.

Small machine payments are frictionless; expensive ones ask the human. Every bridged
call is audit-logged (`GET /audit`).

## Prava integration & transaction outcome (core, not a button)
Prava is what makes the card side possible — without it a card-only agent simply cannot
buy from a wallet-only seller. Prava's **payment sessions + mandates** are the
spend-control surface, demonstrated in two beats:
- **$0.005 call → autonomous:** charged against a standing mandate, **no passkey**.
- **$0.02 call → escalated:** a Prava **payment session** → **passkey** approval → the
  human consents with biometry, then the charge completes.

**Transaction outcome:** per bridged call, a completed Prava card transaction
(create session → user approves in the collect iframe → merchant polls the one-time
credentials → **report-status APPROVED**), paired with an on-chain USDC settlement on
Base. The bridge is the **merchant of record**. Evidence in the demo: the Prava
dashboard charge + the `report-status: APPROVED` for the session, and the x402 settle
receipt / Base transaction.

## Track fit
- **Visa Intelligent Commerce ($5k):** the transaction flows through Prava; the judged
  axes — *permissions, trust, controls* — ARE our spend-policy gate (autonomous under a
  capped mandate, passkey above it, every call logged).
- **Prava Overall ($10k):** Prava enables a genuinely new action — a card-only agent
  buying from a wallet-only x402 API — not a checkout button bolted onto an app.

## Disclosure (pre-existing vs built during the hackathon) — required
- **Pre-existing:** Predge, the live x402 seller we buy from, existed and was in
  production before the event. It is the merchant, **not** this submission.
- **Built during the hackathon (this repo):** the entire bridge — 402 probe +
  `payment-required` decode, spend-policy gate, the Prava card leg, the x402 settle leg
  — plus the demo agent and docs. Nothing here existed before 2026-07-31.
- **Honesty:** the Prava card leg runs in **sandbox** (Prava test Visa card) — stated on
  screen in the demo; the USDC leg is a **real** on-chain x402 settlement on Base. No
  mocked or faked transactions.

## How it works
```
card-only agent ─POST /pay {targetUrl}─▶ bridge
   a) probe target → HTTP 402 → decode accepts[] → Base(USDC) leg
   b) spend-policy: price ≤ threshold → mandate (auto) | > → session (passkey)
   c) Prava card leg (merchant of record): session → iframe approval → report APPROVED
   d) x402 leg: settle USDC on Base (float wallet; facilitator pays gas via EIP-3009)
   e) audit-log + return the paid data
```

## Run it
```bash
npm install
npm run server                 # :8899  /health · /pay · /prava/session · /prava/complete · /settle · /audit
# demo agent (real Prava sandbox card leg + passkey):
node --env-file=.env src/demo-agent.mjs --prava            # autonomous ($0.005)
node --env-file=.env src/demo-agent.mjs --prava "profile wallet 0x8dab…"   # passkey escalation ($0.02)
```

## Tech
Node/Express bridge · Prava sandbox REST (sessions + mandates) · `@x402/fetch` +
`@x402/evm` + viem for the USDC/Base leg · Predge as the live x402 seller.

## Links
- Repo: https://github.com/predgeAI/x402-prava-bridge
- Demo video: `<unlisted video URL>`
- Live seller (pre-existing): https://data.predge.io/.well-known/x402
