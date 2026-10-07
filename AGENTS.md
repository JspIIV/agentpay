# AgentPay

> Built with Arc Studio — money-powered apps in minutes

Agent-to-agent USDC payment rail with x402 (HTTP 402) enforcement, on Arc Mainnet.

---

## What This App Does

AgentPay lets AI agents pay each other per-call in USDC on Arc Mainnet. Any agent can:
1. Register as a paid service with a name, URL, and per-call price in 6-decimal USDC units.
2. Other agents call the x402 endpoint (GET /api/service/:agentAddress), receive a 402 with a callId, approve USDC, call AgentPay.pay(to, callId, maxAmount), then retry with the tx hash and their payer address.
3. The server verifies the PaymentMade event on-chain and returns the service response.

A drop-in client helper (`server/agent-client.ts`) handles the full 402→approve→pay→retry cycle in one function call.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS, Arc Dark design
- Web3: wagmi v2, viem v2, ConnectKit
- Contract: Solidity ^0.8.20 + Foundry. Source: `contracts/AgentPay.sol`
- Backend: Bun HTTP server (`server/index.ts`) proxied through Vite at `/api`
- Chain: **Arc Mainnet** (Chain ID: 5042, RPC: https://rpc.mainnet.arc.io)
- Token: USDC ERC-20 at `0x3600000000000000000000000000000000000000` (6 decimals)

## Contract — AgentPay.sol

Deployed and verified on Arc Mainnet at
[`0xCcf147e5D564033114f1cA6e86E0A47185eab26C`](https://explorer.arc.io/address/0xCcf147e5D564033114f1cA6e86E0A47185eab26C)
(deploy block 24786205). Constructor arg: `usdc_ = 0x3600000000000000000000000000000000000000`.

`.env` needs both of these:
```
VITE_AGENTPAY_ADDRESS=0xCcf147e5D564033114f1cA6e86E0A47185eab26C
VITE_AGENTPAY_DEPLOY_BLOCK=24786205
```

The deploy block is not optional. The Activity screen scans `PaymentMade` logs
from it; left at 0 the scan starts at genesis and never finishes.

Key functions:
- `registerAgent(name, serviceUrl, pricePerCall)` — registers the caller's own record
- `updateAgent(name, serviceUrl, pricePerCall)` — the registered agent updates its own record
- `setActive(bool)` — the registered agent enables/disables its own listing
- `pay(address to, bytes32 callId, uint256 maxAmount)` — pulls `pricePerCall` from the caller via `transferFrom`; reverts with `Price moved` if the payee raised the price above `maxAmount`; callId dedup is per-payer
- `setSpendingLimit(uint256 perDay)` — rolling 24h USDC cap, must be > 0. `pay` reverts until the caller has set one
- `isLimitConfigured(address)` / `spentToday(address)` — views for the cap
- `listActiveAgents(uint256 offset, uint256 limit_)` — paginated, returns (addresses, agents, totalActive); limit clamped to 200
- `getAgent(address)` — view

Payment history is not stored on chain. Read the `PaymentMade` event instead.

Security: no admin, no owner, no pause, no upgrade. The USDC address is
`immutable` and validated in the constructor. The contract holds no USDC — `pay`
transfers directly from payer to payee — and takes no fee.

## Key Files

- `contracts/AgentPay.sol` — contract source
- `contracts/test/AgentPay.t.sol` — 16 tests with a mock 6-decimal USDC
- `src/agentpay-abi.ts` — full ABI + helper types/utils
- `src/config.ts` — wagmi config for Arc Mainnet
- `src/App.tsx` — tab shell (Directory / Register / Pay / Activity)
- `src/components/Directory.tsx` — paginated agent listing with search
- `src/components/Register.tsx` — register/update agent, set daily spending limit
- `src/components/Pay.tsx` — approve + pay flow, gated on a configured limit
- `src/components/Activity.tsx` — payment history from `PaymentMade` logs, fetched in block chunks
- `server/index.ts` — x402 endpoint (GET /service/:agentAddress)
- `server/agent-client.ts` — drop-in agent client helper

## x402 Endpoint

Start backend: `bun run server` (port 3001, proxied via Vite at `/api`)

```
GET /api/service/:agentAddress
  No X-Payment  → 402 { payment: { payTo, amount, callId, chainId, usdcAddress } }
  X-Payment: <txHash> + ?callId=<callId>&payer=<address>  → 200 service response
  Replay → 409
```

Verification matches the `PaymentMade` event signature, the payer, the payee and
the callId, and requires the amount to cover `pricePerCall`. Redeemed callIds are
written to `CALLID_STORE_PATH` (default `.callid-store.json`) so a restart cannot
un-redeem a payment.

## To Run

```bash
bun install
cp .env.example .env   # fill in the two VITE_ values above
# in one terminal:
bun run dev
# in another terminal:
bun run server
```

Contract tests run against Arc's own runtime with
[Arc Foundry](https://github.com/circlefin/arc-foundry):

```bash
arc-forge test --network arc
```
