/**
 * AgentPay contract ABI and types.
 * Deploy to Arc Mainnet (chainId 5042) with constructor arg:
 *   USDC = 0x3600000000000000000000000000000000000000
 *
 * After deployment, set in .env:
 *   VITE_AGENTPAY_ADDRESS=0x<address>
 *   VITE_AGENTPAY_DEPLOY_BLOCK=<deployment block number>
 */

export const AGENTPAY_ABI = [
  // Events
  {
    type: 'event',
    name: 'AgentRegistered',
    inputs: [
      { name: 'agent', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'serviceUrl', type: 'string', indexed: false },
      { name: 'pricePerCall', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AgentUpdated',
    inputs: [
      { name: 'agent', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
      { name: 'serviceUrl', type: 'string', indexed: false },
      { name: 'pricePerCall', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'AgentActiveChanged',
    inputs: [
      { name: 'agent', type: 'address', indexed: true },
      { name: 'active', type: 'bool', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'PaymentMade',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'callId', type: 'bytes32', indexed: true },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SpendingLimitSet',
    inputs: [
      { name: 'caller', type: 'address', indexed: true },
      { name: 'perDay', type: 'uint256', indexed: false },
    ],
  },
  // Constructor
  {
    type: 'constructor',
    inputs: [{ name: 'usdc_', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  // State-changing
  {
    type: 'function',
    name: 'registerAgent',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'serviceUrl', type: 'string' },
      { name: 'pricePerCall', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'updateAgent',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'serviceUrl', type: 'string' },
      { name: 'pricePerCall', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setActive',
    inputs: [{ name: 'active_', type: 'bool' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'pay',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'callId', type: 'bytes32' },
      { name: 'maxAmount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setSpendingLimit',
    inputs: [{ name: 'perDay', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // Views
  {
    type: 'function',
    name: 'USDC',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
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
  {
    type: 'function',
    name: 'listActiveAgents',
    inputs: [
      { name: 'offset', type: 'uint256' },
      { name: 'limit_', type: 'uint256' },
    ],
    outputs: [
      { name: 'pageAddresses', type: 'address[]' },
      {
        name: 'pageAgents',
        type: 'tuple[]',
        components: [
          { name: 'name', type: 'string' },
          { name: 'serviceUrl', type: 'string' },
          { name: 'pricePerCall', type: 'uint256' },
          { name: 'owner', type: 'address' },
          { name: 'active', type: 'bool' },
          { name: 'totalCallsPaid', type: 'uint256' },
        ],
      },
      { name: 'totalActive', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'spentToday',
    inputs: [{ name: 'caller', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isLimitConfigured',
    inputs: [{ name: 'caller', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'callIdUsed',
    inputs: [
      { name: 'payer', type: 'address' },
      { name: 'callId', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'agents',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'name', type: 'string' },
      { name: 'serviceUrl', type: 'string' },
      { name: 'pricePerCall', type: 'uint256' },
      { name: 'owner', type: 'address' },
      { name: 'active', type: 'bool' },
      { name: 'totalCallsPaid', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const

export type AgentStruct = {
  name: string
  serviceUrl: string
  pricePerCall: bigint
  owner: `0x${string}`
  active: boolean
  totalCallsPaid: bigint
}

// PaymentMade log decoded by viem getLogs
export type PaymentMadeLog = {
  args: {
    from: `0x${string}`
    to: `0x${string}`
    amount: bigint
    callId: `0x${string}`
    timestamp: bigint
  }
  transactionHash: `0x${string}` | null
  blockNumber: bigint | null
}

// Arc Mainnet constants
export const ARC_MAINNET_CHAIN_ID = 5042
export const ARC_MAINNET_USDC = '0x3600000000000000000000000000000000000000' as const
export const EXPLORER_BASE = 'https://explorer.arc.io'

// Block to start scanning from — set VITE_AGENTPAY_DEPLOY_BLOCK after deployment
export const DEPLOY_BLOCK = BigInt(
  String(import.meta.env.VITE_AGENTPAY_DEPLOY_BLOCK ?? '0'),
)

export function explorerTx(hash: string) {
  return `${EXPLORER_BASE}/tx/${hash}`
}

export function explorerAddr(addr: string) {
  return `${EXPLORER_BASE}/address/${addr}`
}

// Format 6-decimal USDC amount to human string
export function formatUsdc(raw: bigint): string {
  const n = Number(raw) / 1_000_000
  if (n === 0) return '0'
  if (n < 0.001) return n.toFixed(6)
  if (n < 1) return n.toFixed(4)
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}

// Parse human USDC string to 6-decimal bigint
export function parseUsdc(val: string): bigint {
  const f = parseFloat(val)
  if (isNaN(f) || f <= 0) return 0n
  return BigInt(Math.round(f * 1_000_000))
}

export function formatAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export function formatTs(ts: bigint): string {
  return new Date(Number(ts) * 1000).toLocaleString()
}
