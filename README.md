# x402-prava-bridge

**A card-carrying agent pays any x402/USDC endpoint — with no crypto wallet.**
Built for the Agentic Commerce Hackathon (Visa Intelligent Commerce / Prava track).

An AI agent with only a **Prava** card (no private key, no USDC) asks the bridge for
data behind an HTTP-402 paywall. The bridge reads the 402, decides a spend-policy,
charges the card via Prava, settles the USDC leg on Base, and returns the paid
response. Small calls go through **autonomously** against a standing mandate; anything
above a threshold **escalates to a passkey** — that permission/control surface is the
point, not a payment button bolted on.

## ⚠️ Disclosure (pre-existing vs built during the event)

- **Pre-existing (NOT this submission):** **Predge** — the live x402 merchant we buy
  from (`x402-api-production-266e.up.railway.app`, Polymarket whale data, USDC on Base
  mainnet). It existed and was in production before the event; it is the *seller*, not
  the entry.
- **Built during the hackathon (this repo):** the entire bridge — `x402.mjs` (402
  probe + `payment-required` header decode + leg selection), `policy.mjs` (spend-policy
  gate + audit log), `server.mjs` (`/pay` orchestration), the Prava-leg wiring, and the
  demo agent. Nothing here existed before 2026-07-31.
- **No fake transactions.** Where a leg runs in sandbox (Prava test cards) that is
  stated plainly on screen; the USDC leg is a real on-chain settlement. We never present
  a mock as a real charge.

## Architecture

```
card-only agent ──POST /pay {targetUrl}──▶ x402-prava-bridge
                                            a) probe target → HTTP 402
                                               decode `payment-required` → accepts[]
                                               pick Base(eip155:8453) USDC leg
                                            b) spend-policy gate
                                               price ≤ threshold → charge MANDATE (auto)
                                               price >  threshold → payment SESSION (passkey)
                                            c) Prava leg  → card charge (sandbox test card)
                                            d) x402 leg   → USDC settle on Base (float wallet)
                                            e) reconcile + audit log → return paid JSON
```

## Track fit

- **Visa Intelligent Commerce ($5k)** — the transaction flows through Prava; the judged
  axes *permissions / trust / controls* ARE the spend-policy gate: autonomous under a
  capped mandate, human passkey above it, every call audit-logged (`GET /audit`).
- **Prava Overall ($10k credits)** — Prava is the core enabler: without it a card-only
  agent simply cannot buy from a wallet-only x402 seller. It unlocks a *new action*, not
  a checkout button.

## Sub-cent nuance (honest)

x402 prices are sub-cent ($0.005); card rails settle in whole cents. So the bridge
charges a **$0.01 minimum** to the card and carries the change as float credit — which is
exactly why small calls batch against a **mandate** instead of hitting the card per call.

## Run

```bash
npm install
npm run server          # :8899   GET /health · POST /pay {targetUrl} · GET /audit
# probe-only (no money), against live Predge:
curl -sS -X POST localhost:8899/pay -H 'content-type: application/json' \
  -d '{"targetUrl":"https://x402-api-production-266e.up.railway.app/v1/whales/latest"}'
```

`/pay` returns a **payment plan** (x402 leg + Prava leg params + policy decision) and
moves no money on its own. Executing the two legs are separate authorized steps.

## Environments — sandbox vs production (IMPORTANT)

Prava test cards work **only in sandbox**, which is separate infrastructure from the
`pay.prava.space` production dashboard (adding the test card there fails with "card
network could not process"). Sandbox:

- Console / signup: **dashboard.prava.space** (self-serve, no KYC) → issues `pk_test_*` / `sk_test_*`
- API base: **`https://sandbox.api.prava.space`** · card collection: **`sandbox.collect.prava.space`**
- The test card is entered via the **secure collect iframe during a payment session**
  (created with `sk_test_*`), not by a standalone "Add a card": create session → open
  `iframe_url` → enter test card `4622 9431 2313 7789` CVV `757` exp `12/27` → passkey →
  poll result → report `APPROVED`/`DECLINED`.

## Owner-actions to light up a REAL demo transaction (before the 7PM PT build start)

1. **Sign up at dashboard.prava.space** (sandbox, self-serve) and generate **test keys**.
   Put the SECRET in the bridge env — do NOT paste it in chat: `PRAVA_SK_TEST=sk_test_…`
   (and `PRAVA_PK_TEST=pk_test_…`). `.env` is gitignored.
   *(Alt route for a genuinely-real card-leg: add a REAL card with a $5 cap in
   pay.prava.space and use the connected Prava MCP — real money, strongest for judging.)*
2. **Fund a float wallet** on Base mainnet with ~$1–5 USDC and set `FLOAT_PRIVATE_KEY`
   (used only by the x402 settle step; keep it out of git).
3. **Devfolio:** add the project to the accepted entry; note the Prava MCP connection.

Env: `PRAVA_SK_TEST`, `PRAVA_PK_TEST`, `FLOAT_PRIVATE_KEY`, `BRIDGE_AUTO_THRESHOLD_USDC`
(default 0.01), `BRIDGE_FEE_USDC` (default 0), `PORT`.
