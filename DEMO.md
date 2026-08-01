# Demo — 90 seconds, two beats

**One line:** *A card-only AI agent buys data from a wallet-only x402 seller — no
crypto wallet, no API key — and the human stays in control of anything expensive.*

Record this as a screencast (belt-and-suspenders against live network issues).
Everything below is what's on screen + what you say.

## Setup shot (0:00–0:10)
- Prava Pay dashboard: the connected agent, **card enrolled** (sandbox Visa test card).
- Terminal: the bridge running (`GET /health` shows the float wallet).
- Say: *"This agent has a card in Prava — no private key, no USDC. It's about to buy
  from Predge, which only accepts USDC on Base."*

## Beat 1 — autonomous micro-purchase (0:10–0:45)
- Run the demo agent with a question: *"Is wallet 0x8dab… smart money on Polymarket?"*
- On screen, in order:
  1. `POST /pay` → the bridge probes Predge, gets **HTTP 402**, decodes `accepts[]`:
     **$0.005 USDC on Base**, `payTo …`.
  2. Policy: **$0.005 ≤ $0.01 → AUTO** — charged against the standing Prava **mandate**,
     **no passkey**. (Prava dashboard shows the card charge.)
  3. `POST /settle` → USDC leg settles on Base — **settle receipt / tx hash** on screen.
  4. Agent answers using the data + the `outcome_verified` flag it got back.
- Say: *"A half-cent call shouldn't interrupt a human. Under the mandate cap it just
  happens — card charged, USDC settled, data returned, question answered."*

## Beat 2 — passkey escalation (0:45–1:25)
- Same agent, a **pricier** endpoint (wallet history, **$0.02 > $0.01 threshold**).
- On screen:
  1. `POST /pay` → policy: **$0.02 > $0.01 → ESCALATE**, instrument = **session**.
  2. Bridge creates a Prava **payment session** → **passkey prompt** → you approve with
     biometry. (This is the *permissions / trust / controls* the Visa track judges.)
  3. `POST /settle` → USDC leg → data → richer answer.
- Say: *"Above the cap, the human is back in the loop — one passkey, explicit consent,
  fully logged. Small stuff is autonomous, big stuff asks."*

## Closing line (1:25–1:30)
*"Any card-carrying agent can now buy from any wallet-only x402 API. The seller's market
grows from a handful of USDC agents to everyone with a card. The buyer needs no wallet
and no top-up. Prava is what makes the card side possible — it's the core, not a button."*

## Disclosure (say it, and put it in the submission)
- **Pre-existing:** Predge (the x402 seller) was live before the event — it's the merchant, not the entry.
- **Built during the hackathon:** the whole bridge (402 probe, spend-policy, escalation, settle) + the demo agent.
- **Honesty:** the Prava card leg runs in **sandbox** (test Visa card) — stated on screen; the USDC leg is a real on-chain settle on Base (testnet in the demo). No mocked/faked transactions.

## Audit
`GET /audit` after the run — one structured line per call: url, amount, `path: auto|escalated`,
`instrument: mandate|session`, outcome. That's the "controls" evidence in one view.
