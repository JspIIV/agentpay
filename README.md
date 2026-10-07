# AgentPay

A per-call payment rail for AI agents on [Arc](https://arc.io), Circle's
USDC-native L1. An agent registers a price, another agent pays it one call at a
time in USDC, and an HTTP 402 endpoint serves the response once the payment is
confirmed on chain.

**Deployed on Arc Mainnet:**
[`0xCcf147e5D564033114f1cA6e86E0A47185eab26C`](https://explorer.arc.io/address/0xCcf147e5D564033114f1cA6e86E0A47185eab26C)
— verified, exact match.

## Why it exists

Agents that call each other's services need a way to settle per call, without
subscriptions, invoices, or a custodian holding a float. Arc makes that
practical: USDC is the gas token, finality is deterministic and sub-second, and
a call costs a fraction of a cent to settle.

AgentPay is the smallest contract that does it honestly. It holds no money,
takes no fee, and nobody — including whoever deployed it — can move anyone
else's USDC.

## How it works

1. An agent calls `registerAgent(name, serviceUrl, pricePerCall)`.
2. A paying agent sets a daily cap once with `setSpendingLimit(perDay)`.
3. To buy one call, it approves the price and calls
   `pay(to, callId, maxAmount)`. USDC moves straight from payer to payee.
4. The service endpoint returns `402 Payment Required` with a `callId`, then
   serves the result after verifying the matching `PaymentMade` log on chain.

## Design decisions

**No owner, no admin, no pause, no upgrade path.** There is no privileged
address in the contract. The USDC address is `immutable` and checked in the
constructor. The deployer holds no special rights after deployment.

**The contract never holds USDC.** `pay` calls `safeTransferFrom(msg.sender, to,
amount)`, so funds go directly from payer to payee. A test asserts the contract's
balance is zero after a payment.

**No protocol fee.** The payee receives 100% of `pricePerCall`. The only cost is
gas.

**`maxAmount` guards against a moving price.** `pay` reads `pricePerCall` at call
time, so a payee could raise it between a payer's approval and their transaction.
The caller passes the price it was quoted, and the call reverts rather than
spending an unexpectedly large allowance.

**A spending limit is required, not optional.** `perDay == 0` does not mean
"unlimited" — `pay` reverts until the caller has explicitly set a cap, which then
applies over a rolling 24-hour window.

**Replay protection is scoped per payer.** `callIdUsed[payer][callId]` means two
agents can independently use the same `callId`, but neither can spend the same
one twice. The flag is set before the transfer.

**History lives in events, not storage.** `PaymentMade` carries everything the
Activity view needs. Writing a payment record to storage on every call would cost
roughly 240k extra gas and would eventually make the read exceed the RPC gas cap.

## USDC decimals on Arc

Arc's USDC has two interfaces over one balance: native at 18 decimals
(`msg.value`, gas, `getBalance`) and ERC-20 at 6 decimals (`balanceOf` at
`0x3600000000000000000000000000000000000000`). The two differ by a factor of
10^12. This contract works entirely in 6-decimal ERC-20 units; the UI formats
them for display and never mixes the two.

## Layout

```
contracts/AgentPay.sol        the contract
contracts/test/AgentPay.t.sol Foundry tests with a mock 6-decimal USDC
src/                          React app: Directory, Register, Pay, Activity
server/index.ts               x402 endpoint — 402 challenge, on-chain verification
server/agent-client.ts        client helper for the full 402 -> pay -> retry cycle
```

## Running it

```shell
bun install
cp .env.example .env     # fill in the contract address and deploy block
bun run dev              # the app
bun run server           # the x402 endpoint
```

Tests run against Arc's own runtime with
[Arc Foundry](https://github.com/circlefin/arc-foundry), which reproduces
protocol differences a generic EVM simulator does not:

```shell
arc-forge test --network arc
```

## Known limits

The 402 flow identifies the payer by an address passed back on the retry. Every
value involved — transaction hash, `callId`, payer — is public in the
`PaymentMade` log, so an observer watching the chain can race the real payer to
redeem the response. Closing this properly needs a signed challenge: the server
issues a nonce, the payer signs it, and the server recovers the address and
checks it against the log. The contract is unaffected either way.

## License

MIT

---

Built with [Arc Studio](https://studio.arc.io).
