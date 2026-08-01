# Clean testnet recording (0 real money)

Records the full flow with the **x402 USDC leg on Base Sepolia** (testnet) instead of
mainnet — so nothing on-chain costs real money. The Prava card leg is unchanged
(sandbox participant card). Verified end-to-end: real Base Sepolia settle tx
(`0x3e53cda5…`) + whale data returned.

## One-time
- `docker start x402-local-pg` (local Postgres on :5439, already seeded).
- The float wallet `~/.predge-x402/buyer.json` (0x469E…) is funded with Base Sepolia
  USDC. Top up if needed: https://faucet.circle.com (Base Sepolia, 20 USDC/2h).

## Three terminals

**T1 — local Predge on Base Sepolia (:4021):**
```bash
cd ~/Documents/Playground/predge-x402-api-wallet-attest
NODE_TLS_REJECT_UNAUTHORIZED=0 X402_NETWORK=base-sepolia \
  PAY_TO_ADDRESS=0x9084f5000e07c7133d6da5ee4f271ab6d1821144 \
  DATABASE_URL='postgresql://postgres:x402@localhost:5439/predge' \
  PORT=4021 npm run dev
```
Wait for `server.started … network":"eip155:84532" … testnet:true`.

**T2 — the bridge (:8899):**
```bash
cd ~/Documents/Playground/x402-prava-bridge
npm run server
```

**T3 — the demo agent, pointed at the testnet Predge, with settle:**
```bash
cd ~/Documents/Playground/x402-prava-bridge
PREDGE_BASE=http://localhost:4021 node --env-file=.env src/demo-agent.mjs --prava --settle
```

Flow on camera: 402 (Base **Sepolia** USDC) → spend-policy → open the Prava hosted
checkout → participant card + OTP + passkey → **Payment Successful** → back to T3, press
Enter → **card leg APPROVED** → the bridge **settles USDC on Base Sepolia** (real tx, 0
real money) → the agent answers with the whale data + `outcome_verified`.

For the escalation beat, add a wallet address to the question:
```bash
PREDGE_BASE=http://localhost:4021 node --env-file=.env src/demo-agent.mjs --prava --settle "profile wallet 0x8dab6cf42d7e4d1cd6cca897b9e12a8cbe6d69e8"
```

## Note for the submission
Disclose: the Prava card leg is **sandbox**; the x402 USDC leg here is **Base Sepolia
testnet** (both stated on screen). Predge (the seller) also runs live on Base **mainnet**
— pointing `PREDGE_BASE` at the prod URL settles a real $0.005 on mainnet instead.
