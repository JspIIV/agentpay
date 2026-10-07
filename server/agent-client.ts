/**
 * AgentPay client helper — import this into any AI agent.
 *
 * Usage:
 *   import { callAgentService } from './agent-client'
 *   import { createWalletClient, createPublicClient, http } from 'viem'
 *
 *   const result = await callAgentService({
 *     agentAddress: '0xABC...',
 *     serviceBaseUrl: 'https://your-agentpay-server.example.com',
 *     walletClient,       // viem WalletClient connected to Arc Mainnet (chainId 5042)
 *     publicClient,       // viem PublicClient for Arc Mainnet
 *     contractAddress: '0xDEF...',
 *   })
 *
 * Handles the full 402 → approve → pay(maxAmount) → retry cycle automatically.
 * Passes maxAmount to pay() for slippage protection.
 * Includes payer address in the retry request (required by server issue #7 fix).
 */

import type { WalletClient, PublicClient, Address, Hex } from 'viem'
import { erc20Abi } from 'viem'

// Minimal ABI for pay(address to, bytes32 callId, uint256 maxAmount)
const AGENTPAY_ABI_PAY = [
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
] as const

export interface CallAgentOptions {
  /** Address of the target agent */
  agentAddress: Address
  /** Base URL of the AgentPay service endpoint (no trailing slash) */
  serviceBaseUrl: string
  /** viem WalletClient — must be on Arc Mainnet (chainId 5042) */
  walletClient: WalletClient
  /** viem PublicClient for Arc Mainnet */
  publicClient: PublicClient
  /** Deployed AgentPay contract address */
  contractAddress: Address
  /** USDC ERC-20 address on Arc Mainnet (defaults to the well-known address) */
  usdcAddress?: Address
  /** Extra query params appended to the service URL */
  queryParams?: Record<string, string>
}

export interface ServiceResponse {
  success: boolean
  callId: string
  payer: string
  txHash: string
  result: unknown
  agent: { address: string; name: string; serviceUrl: string }
}

/**
 * Call an AgentPay-protected endpoint, handling the full x402 flow automatically.
 *
 * Flow:
 *   1. GET the endpoint — expect 402
 *   2. Parse payment challenge: payTo, amount, callId
 *   3. Approve USDC allowance for the contract
 *   4. Call AgentPay.pay(payTo, callId, amount) — amount is the quoted price (maxAmount guard)
 *   5. Retry with X-Payment, ?callId, and ?payer headers
 */
export async function callAgentService(opts: CallAgentOptions): Promise<ServiceResponse> {
  const {
    agentAddress,
    serviceBaseUrl,
    walletClient,
    publicClient,
    contractAddress,
    // arc-studio-allow-onchain-literal (Arc mainnet USDC — well-known protocol address)
    usdcAddress = '0x3600000000000000000000000000000000000000' as Address,
    queryParams = {},
  } = opts

  const endpoint = `${serviceBaseUrl}/service/${agentAddress}`
  const params = new URLSearchParams(queryParams)
  const urlWithoutPayment = params.toString() ? `${endpoint}?${params}` : endpoint

  // Step 1: initial unpaid request
  const resp402 = await fetch(urlWithoutPayment)
  if (resp402.status === 200) {
    return resp402.json() as Promise<ServiceResponse>
  }
  if (resp402.status !== 402) {
    const text = await resp402.text()
    throw new Error(`Unexpected status ${resp402.status}: ${text}`)
  }

  // Step 2: parse payment challenge
  const body = (await resp402.json()) as {
    payment: {
      payTo: Address
      amount: string
      callId: Hex
      chainId: number
      usdcAddress: Address
      contractAddress: Address
    }
  }

  const { amount, callId, payTo } = body.payment
  // Snapshot the quoted price — passed as maxAmount to prevent price manipulation
  const amountBn = BigInt(amount)

  const [account] = await walletClient.getAddresses()
  if (!account) throw new Error('No wallet account available')

  // Step 3: approve USDC
  console.log(`[AgentPay] Approving ${amount} units (6-decimal USDC) for ${contractAddress}…`)
  const approveTx = await walletClient.writeContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: 'approve',
    args: [contractAddress, amountBn],
    account,
    chain: null,
  })
  await publicClient.waitForTransactionReceipt({ hash: approveTx })
  console.log(`[AgentPay] Approved. tx: ${approveTx}`)

  // Step 4: pay(agentAddress, callId, maxAmount=amountBn)
  console.log(`[AgentPay] Paying agent ${payTo} callId ${callId} maxAmount ${amountBn}…`)
  const payTx = await walletClient.writeContract({
    address: contractAddress,
    abi: AGENTPAY_ABI_PAY,
    functionName: 'pay',
    args: [payTo, callId, amountBn],
    account,
    chain: null,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash: payTx })
  if (receipt.status !== 'success') throw new Error(`pay() reverted: ${payTx}`)
  console.log(`[AgentPay] Paid. tx: ${payTx}`)

  // Step 5: retry with payment proof + payer address
  const retryParams = new URLSearchParams({ ...queryParams, callId, payer: account })
  const retryUrl = `${endpoint}?${retryParams}`
  const retryResp = await fetch(retryUrl, { headers: { 'X-Payment': payTx } })

  if (!retryResp.ok) {
    const errBody = await retryResp.text()
    throw new Error(`Service returned ${retryResp.status} after payment: ${errBody}`)
  }

  return retryResp.json() as Promise<ServiceResponse>
}
