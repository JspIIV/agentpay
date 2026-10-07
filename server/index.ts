/**
 * AgentPay x402 service endpoint.
 *
 * GET /service/:agentAddress
 *   - No X-Payment header  → 402 with payment instructions (includes a payer challenge)
 *   - X-Payment: <txHash>  → verify PaymentMade on-chain, return service result
 *     Required query params on retry: ?callId=<hex>&payer=<address>
 *
 * GET /health
 *
 * Security fixes (issue 7-9):
 *   7. verifyPayment checks topics[0] (event sig) + topics[1] (payer) + topics[2] (to) + topics[3] (callId)
 *   8. usedCallIds persisted to a local JSON file so restarts don't un-redeem payments
 *   9. cache key is `payer:agent:callId` matching the contract's per-payer dedup
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createPublicClient, http, keccak256, toBytes, type Address, type Hex } from 'viem'
import { defineChain } from 'viem'

// ---- Chain / RPC config -------------------------------------------------------
// arc-studio-allow-onchain-literal (Arc RPC — public endpoint, no key required)
const PUBLIC_ARC_RPC = 'https://rpc.mainnet.arc.io'

const proxyChains = (process.env.RPC_PROXY_CHAINS ?? '').split(',').map((s) => s.trim())
const rpcUrl =
  process.env.RPC_PROXY_BASE_URL && proxyChains.includes('Arc_Mainnet')
    ? `${process.env.RPC_PROXY_BASE_URL}/api/rpc/Arc_Mainnet?_rpc_token=${process.env.RPC_PROXY_TOKEN}`
    : PUBLIC_ARC_RPC

const ARC_MAINNET = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: 'ArcScan', url: 'https://explorer.arc.io' } },
})

// arc-studio-allow-onchain-literal (Arc mainnet USDC — well-known protocol address)
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as Address
const CONTRACT_ADDRESS = (process.env.VITE_AGENTPAY_ADDRESS ?? '') as Address
const CHAIN_ID = 5042
const EXPLORER_BASE = 'https://explorer.arc.io'

// PaymentMade(address indexed from, address indexed to, uint256 amount, bytes32 indexed callId, uint256 timestamp)
const PAYMENT_MADE_SIG = keccak256(
  toBytes('PaymentMade(address,address,uint256,bytes32,uint256)'),
) as Hex

const publicClient = createPublicClient({
  chain: ARC_MAINNET,
  transport: http(rpcUrl),
})

// ---- ABI fragments ------------------------------------------------------------
const GET_AGENT_ABI = [
  {
    type: 'function',
    name: 'getAgent',
    inputs: [{ name: 'a', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'serviceUrl', type: 'string' },
          { name: 'pricePerCall', type: 'uint256' },
          { name: 'owner', type: 'address' },
          { name: 'active', type: 'bool' },
          { name: 'totalCallsPaid', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const

// ---- Persistent used-callId store ---------------------------------------------
// Format: payer:agent:callId (matches contract's per-payer dedup scope)
const STORE_PATH = process.env.CALLID_STORE_PATH ?? '.callid-store.json'

function loadStore(): Set<string> {
  try {
    if (existsSync(STORE_PATH)) {
      const raw = readFileSync(STORE_PATH, 'utf8')
      const arr = JSON.parse(raw) as string[]
      if (Array.isArray(arr)) return new Set(arr)
    }
  } catch {
    // ignore — start fresh
  }
  return new Set()
}

function saveStore(store: Set<string>) {
  try {
    writeFileSync(STORE_PATH, JSON.stringify([...store]), 'utf8')
  } catch {
    // best-effort; the on-chain check is the authoritative guard
  }
}

const usedCallIds = loadStore()

function markUsed(key: string) {
  usedCallIds.add(key)
  saveStore(usedCallIds)
}

function cacheKey(payer: string, agent: string, callId: string): string {
  return `${payer.toLowerCase()}:${agent.toLowerCase()}:${callId.toLowerCase()}`
}

// ---- Helpers ------------------------------------------------------------------

function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'X-Payment, Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
}

function json(res: ServerResponse, status: number, body: unknown) {
  cors(res)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body, null, 2))
}

async function getAgentOnchain(address: Address) {
  if (!CONTRACT_ADDRESS) return null
  try {
    return await publicClient.readContract({
      address: CONTRACT_ADDRESS,
      abi: GET_AGENT_ABI,
      functionName: 'getAgent',
      args: [address],
    })
  } catch {
    return null
  }
}

/**
 * Verify that a PaymentMade event exists in the given tx matching ALL of:
 *   topics[0] == PaymentMade event signature
 *   topics[1] == payer address (indexed, padded)
 *   topics[2] == agentAddress (indexed, padded)
 *   topics[3] == expectedCallId (indexed bytes32)
 *   amount (from data) >= minAmount
 */
async function verifyPayment(
  txHash: Hex,
  payer: Address,
  agentAddress: Address,
  expectedCallId: Hex,
  minAmount: bigint,
): Promise<boolean> {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash })
    if (!receipt || receipt.status !== 'success') return false

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) continue
      if (log.topics.length < 4) continue

      // Verify event signature
      if (log.topics[0]?.toLowerCase() !== PAYMENT_MADE_SIG.toLowerCase()) continue

      // topics[1] = from (payer), topics[2] = to (agent), topics[3] = callId
      const fromTopic = log.topics[1]
      const toTopic = log.topics[2]
      const callIdTopic = log.topics[3]
      if (!fromTopic || !toTopic || !callIdTopic) continue

      const fromAddr = ('0x' + fromTopic.slice(26)).toLowerCase()
      const toAddr = ('0x' + toTopic.slice(26)).toLowerCase()

      if (fromAddr !== payer.toLowerCase()) continue
      if (toAddr !== agentAddress.toLowerCase()) continue
      if (callIdTopic.toLowerCase() !== expectedCallId.toLowerCase()) continue

      // data = abi.encode(uint256 amount, uint256 timestamp)
      if (log.data.length < 130) continue // 0x + 128 hex chars
      const amount = BigInt('0x' + log.data.slice(2, 66))
      if (amount >= minAmount) return true
    }
    return false
  } catch {
    return false
  }
}

// ---- Route handlers -----------------------------------------------------------

async function handleServiceRequest(
  req: IncomingMessage,
  res: ServerResponse,
  agentAddress: Address,
) {
  const agent = await getAgentOnchain(agentAddress)
  if (!agent || !agent.active) {
    return json(res, 404, { error: 'Agent not found or not active' })
  }

  const paymentHeader = (req.headers['x-payment'] ?? '') as string
  const url = new URL(req.url ?? '/', 'http://localhost')

  // No payment header → issue 402 challenge
  if (!paymentHeader.trim()) {
    const callId = ('0x' + Array.from(
      crypto.getRandomValues(new Uint8Array(32)),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('')) as Hex

    return json(res, 402, {
      error: 'Payment required',
      payment: {
        payTo: agentAddress,
        amount: agent.pricePerCall.toString(),
        amountUsdc: `${(Number(agent.pricePerCall) / 1_000_000).toFixed(6)} USDC`,
        callId,
        chainId: CHAIN_ID,
        usdcAddress: USDC_ADDRESS,
        contractAddress: CONTRACT_ADDRESS || null,
        explorerContract: CONTRACT_ADDRESS ? `${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}` : null,
        instructions: [
          `1. USDC.approve("${CONTRACT_ADDRESS || '<contractAddress>'}", ${agent.pricePerCall})`,
          `2. AgentPay.pay("${agentAddress}", "${callId}", ${agent.pricePerCall})`,
          `3. Retry GET with X-Payment: <txHash>  and ?callId=${callId}&payer=<yourAddress>`,
        ],
      },
    })
  }

  // Has payment header → verify
  const txHash = paymentHeader.trim() as Hex
  const callId = url.searchParams.get('callId') as Hex | null
  const payer = url.searchParams.get('payer') as Address | null

  if (!callId) {
    return json(res, 400, { error: 'Missing ?callId — pass the callId from the 402 response.' })
  }
  if (!payer || !/^0x[0-9a-fA-F]{40}$/.test(payer)) {
    return json(res, 400, { error: 'Missing or invalid ?payer — pass your wallet address.' })
  }

  const key = cacheKey(payer, agentAddress, callId)
  if (usedCallIds.has(key)) {
    return json(res, 409, { error: 'callId already used — this payment has already been served.' })
  }

  const verified = await verifyPayment(txHash, payer, agentAddress, callId, agent.pricePerCall)
  if (!verified) {
    return json(res, 402, {
      error: 'Payment not verified. Ensure the tx is confirmed, callId and payer match the 402 challenge.',
      txHash,
      callId,
      payer,
    })
  }

  markUsed(key)

  return json(res, 200, {
    success: true,
    agent: { address: agentAddress, name: agent.name, serviceUrl: agent.serviceUrl },
    callId,
    payer,
    txHash,
    explorerTx: `${EXPLORER_BASE}/tx/${txHash}`,
    result: {
      message: `Paid service response from agent "${agent.name}"`,
      timestamp: Date.now(),
      data: `Placeholder result. Wire agent.serviceUrl (${agent.serviceUrl}) to produce the real response.`,
    },
  })
}

// ---- HTTP server --------------------------------------------------------------

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const method = req.method ?? 'GET'

  if (method === 'OPTIONS') {
    cors(res)
    res.writeHead(204)
    return res.end()
  }

  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname

  if (pathname === '/health') {
    return json(res, 200, {
      status: 'ok',
      chainId: CHAIN_ID,
      contract: CONTRACT_ADDRESS || 'not configured — set VITE_AGENTPAY_ADDRESS',
      rpc: rpcUrl.includes('_rpc_token') ? 'proxy' : 'public',
      storedCallIds: usedCallIds.size,
    })
  }

  const m = pathname.match(/^\/service\/([0-9a-fA-Fx]+)$/)
  if (m && method === 'GET') {
    const addr = m[1]
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      return json(res, 400, { error: 'Invalid agent address' })
    }
    return handleServiceRequest(req, res, addr as Address)
  }

  return json(res, 404, { error: 'Not found', routes: ['GET /health', 'GET /service/:agentAddress'] })
})

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001
server.listen(PORT, () => {
  console.log(
    `AgentPay x402 server on port ${PORT} (rpc: ${rpcUrl.includes('_rpc_token') ? 'proxy' : 'public'}, stored callIds: ${usedCallIds.size})`,
  )
})
