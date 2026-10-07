/**
 * Pay screen — approve USDC + pay agent in a single async handler.
 * Passes maxAmount (the displayed price) to pay() for slippage protection.
 * Shows a "Set daily limit first" gate when the caller hasn't configured one.
 */
import { useState, useMemo } from 'react'
import {
  useAccount,
  useReadContract,
  useSwitchChain,
  usePublicClient,
  useWalletClient,
} from 'wagmi'
import { erc20Abi } from 'viem'
import { Loader2, CheckCircle, AlertCircle, ChevronDown, ShieldAlert } from 'lucide-react'
import {
  AGENTPAY_ABI,
  type AgentStruct,
  formatUsdc,
  explorerTx,
  formatAddr,
  ARC_MAINNET_CHAIN_ID,
  ARC_MAINNET_USDC,
} from '@/agentpay-abi'

interface PayProps {
  contractAddress: `0x${string}` | undefined
}

type PayStep =
  | 'idle'
  | 'approving'
  | 'approve-wait'
  | 'paying'
  | 'pay-wait'
  | 'success'

function makeCallId(): `0x${string}` {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

export function Pay({ contractAddress }: PayProps) {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const wrongChain = isConnected && chainId !== ARC_MAINNET_CHAIN_ID

  const publicClient = usePublicClient({ chainId: ARC_MAINNET_CHAIN_ID })
  const { data: walletClient } = useWalletClient({ chainId: ARC_MAINNET_CHAIN_ID })

  const [selectedAddr, setSelectedAddr] = useState<`0x${string}` | ''>('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [step, setStep] = useState<PayStep>('idle')
  const [txHashApprove, setTxHashApprove] = useState<`0x${string}` | undefined>()
  const [txHashPay, setTxHashPay] = useState<`0x${string}` | undefined>()
  const [txError, setTxError] = useState('')

  // Load page 0 of active agents (up to 50)
  const { data: agentsData } = useReadContract({
    address: contractAddress,
    abi: AGENTPAY_ABI,
    functionName: 'listActiveAgents',
    args: [0n, 50n],
    chainId: ARC_MAINNET_CHAIN_ID,
    query: { enabled: !!contractAddress },
  })

  const [addresses, agents] = useMemo<[`0x${string}`[], AgentStruct[]]>(() => {
    if (!agentsData) return [[], []]
    return [agentsData[0] as `0x${string}`[], agentsData[1] as AgentStruct[]]
  }, [agentsData])

  const selectedAgent = useMemo(() => {
    if (!selectedAddr) return null
    const idx = addresses.findIndex((a) => a.toLowerCase() === selectedAddr.toLowerCase())
    return idx >= 0 ? agents[idx] : null
  }, [selectedAddr, addresses, agents])

  const { data: spentTodayRaw } = useReadContract({
    address: contractAddress,
    abi: AGENTPAY_ABI,
    functionName: 'spentToday',
    args: address ? [address] : undefined,
    chainId: ARC_MAINNET_CHAIN_ID,
    query: { enabled: !!contractAddress && !!address },
  })

  const { data: limitConfigured } = useReadContract({
    address: contractAddress,
    abi: AGENTPAY_ABI,
    functionName: 'isLimitConfigured',
    args: address ? [address] : undefined,
    chainId: ARC_MAINNET_CHAIN_ID,
    query: { enabled: !!contractAddress && !!address },
  })

  const { data: allowance } = useReadContract({
    address: ARC_MAINNET_USDC,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && contractAddress ? [address, contractAddress] : undefined,
    chainId: ARC_MAINNET_CHAIN_ID,
    query: { enabled: !!address && !!contractAddress },
  })

  const price = selectedAgent?.pricePerCall ?? 0n
  const needsApproval = allowance !== undefined && price > 0n && allowance < price
  const isWorking = ['approving', 'approve-wait', 'paying', 'pay-wait'].includes(step)

  async function handlePay() {
    if (!contractAddress || !selectedAddr || price === 0n || !walletClient || !publicClient) return
    if (!address) return

    setTxError('')
    setTxHashApprove(undefined)
    setTxHashPay(undefined)
    const callId = makeCallId()
    // Snapshot the price at quote time — passed as maxAmount to prevent payee price manipulation
    const maxAmount = price

    try {
      if (needsApproval) {
        setStep('approving')
        const approveTx = await walletClient.writeContract({
          address: ARC_MAINNET_USDC,
          abi: erc20Abi,
          functionName: 'approve',
          args: [contractAddress, maxAmount],
          account: address,
          chain: null,
        })
        setTxHashApprove(approveTx)
        setStep('approve-wait')
        const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx })
        if (approveReceipt.status !== 'success') throw new Error('Approve transaction reverted')
      }

      setStep('paying')
      const payTx = await walletClient.writeContract({
        address: contractAddress,
        abi: AGENTPAY_ABI,
        functionName: 'pay',
        // Pass maxAmount — if the payee raised pricePerCall since the quote, this reverts
        args: [selectedAddr, callId, maxAmount],
        account: address,
        chain: null,
      })
      setTxHashPay(payTx)
      setStep('pay-wait')
      const payReceipt = await publicClient.waitForTransactionReceipt({ hash: payTx })
      if (payReceipt.status !== 'success') throw new Error('Pay transaction reverted')
      setStep('success')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setTxError(
        msg.includes('user rejected') || msg.includes('User denied')
          ? 'Transaction cancelled.'
          : msg.slice(0, 300),
      )
      setStep('idle')
    }
  }

  function stepLabel(): React.ReactNode {
    if (!isConnected) return 'Connect Wallet'
    switch (step) {
      case 'approving':
        return <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> Approve USDC in wallet…</span>
      case 'approve-wait':
        return <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> Confirming approve…</span>
      case 'paying':
        return <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> Confirm payment…</span>
      case 'pay-wait':
        return <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> Confirming payment…</span>
      default:
        return needsApproval
          ? `Approve + Pay ${formatUsdc(price)} USDC`
          : `Pay ${formatUsdc(price)} USDC`
    }
  }

  // Spending limit gate — shown when configured is definitively false (not loading)
  const limitGate = isConnected && limitConfigured === false

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h2 className="display text-xl font-semibold" style={{ color: 'var(--ink)' }}>Pay an Agent</h2>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--subtle)' }}>
          One-click USDC payment with slippage protection and daily spend cap.
        </p>
      </div>

      {/* Spending limit gate */}
      {limitGate && (
        <div
          className="flex items-start gap-3 rounded-2xl p-4"
          style={{ background: 'rgba(172,198,233,0.08)', border: '1px solid rgba(172,198,233,0.25)' }}
        >
          <ShieldAlert className="mt-0.5 size-5 shrink-0" style={{ color: 'var(--accent)' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Daily spending limit required</p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
              The contract requires every payer to set an explicit daily USDC cap before paying.
              Go to the <strong>Register</strong> tab to set your limit, or call{' '}
              <code className="mono text-xs" style={{ color: 'var(--ink-2)' }}>setSpendingLimit(perDay)</code> directly.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-2xl p-5 space-y-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {/* Agent selector */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>
            Select Agent
          </label>
          <div className="relative">
            <button
              onClick={() => setDropdownOpen((o) => !o)}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm"
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink)' }}
            >
              {selectedAddr && selectedAgent ? (
                <span>{selectedAgent.name} — <span className="mono text-xs">{formatAddr(selectedAddr)}</span></span>
              ) : (
                <span style={{ color: 'var(--subtle)' }}>Choose an agent…</span>
              )}
              <ChevronDown className="size-4 shrink-0" style={{ color: 'var(--subtle)' }} />
            </button>
            {dropdownOpen && (
              <div
                className="absolute left-0 top-full z-20 mt-1 w-full rounded-xl py-1 shadow-xl"
                style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
              >
                {addresses.length === 0 && (
                  <div className="px-4 py-3 text-xs" style={{ color: 'var(--subtle)' }}>No active agents</div>
                )}
                {addresses.map((addr, i) => (
                  <button
                    key={addr}
                    onClick={() => { setSelectedAddr(addr); setDropdownOpen(false); setStep('idle') }}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-sm hover:bg-white/10"
                    style={{ color: 'var(--ink)' }}
                  >
                    <span>{agents[i].name}</span>
                    <span className="mono text-xs" style={{ color: 'var(--subtle)' }}>
                      {formatUsdc(agents[i].pricePerCall)} USDC
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Price / limit info */}
        {selectedAgent && (
          <div className="rounded-xl p-4 space-y-2" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            <InfoRow label="Price per call (quoted)" value={`${formatUsdc(price)} USDC`} mono />
            <InfoRow label="6-decimal units" value={price.toString()} mono />
            <InfoRow
              label="Your daily spend (rolling 24h)"
              value={spentTodayRaw !== undefined ? `${formatUsdc(spentTodayRaw)} USDC` : '—'}
              mono
            />
            <InfoRow
              label="Current allowance"
              value={`${allowance !== undefined ? formatUsdc(allowance) : '—'} USDC${needsApproval ? ' (needs approval)' : ' (sufficient)'}`}
              mono
              highlight={needsApproval ? 'danger' : 'success'}
            />
            <InfoRow
              label="Daily limit configured"
              value={limitConfigured === undefined ? '…' : limitConfigured ? 'Yes' : 'No — set one on Register tab'}
              highlight={limitConfigured === false ? 'danger' : limitConfigured ? 'success' : undefined}
            />
          </div>
        )}
      </div>

      {/* CTA */}
      {wrongChain ? (
        <button
          onClick={() => switchChain({ chainId: ARC_MAINNET_CHAIN_ID })}
          className="w-full rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{ background: 'var(--accent)', color: '#0d1b2f' }}
        >
          Switch to Arc Mainnet
        </button>
      ) : (
        <button
          disabled={!isConnected || !selectedAddr || isWorking || step === 'success' || limitGate}
          onClick={() => { void handlePay() }}
          className="w-full rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#0d1b2f' }}
        >
          {stepLabel()}
        </button>
      )}

      {/* Success */}
      {step === 'success' && txHashPay && (
        <div className="space-y-2 rounded-2xl p-4" style={{ background: 'rgba(141,216,159,0.08)', border: '1px solid rgba(141,216,159,0.2)' }}>
          <div className="flex items-center gap-2">
            <CheckCircle className="size-4" style={{ color: 'var(--success)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--success)' }}>Payment confirmed</span>
          </div>
          {txHashApprove && (
            <a href={explorerTx(txHashApprove)} target="_blank" rel="noreferrer" className="block text-xs hover:opacity-80" style={{ color: 'var(--muted)' }}>
              Approve tx → View on ArcScan
            </a>
          )}
          <a href={explorerTx(txHashPay)} target="_blank" rel="noreferrer" className="block text-xs hover:opacity-80" style={{ color: 'var(--accent-hover)' }}>
            Pay tx → View on ArcScan
          </a>
          <button
            onClick={() => { setStep('idle'); setTxError('') }}
            className="mt-2 text-xs"
            style={{ color: 'var(--muted)' }}
          >
            Pay again
          </button>
        </div>
      )}

      {txError && (
        <div className="flex items-start gap-3 rounded-2xl p-4" style={{ background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.2)' }}>
          <AlertCircle className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
          <p className="text-xs" style={{ color: 'var(--danger)' }}>{txError}</p>
        </div>
      )}
    </div>
  )
}

function InfoRow({
  label,
  value,
  mono = false,
  highlight,
}: {
  label: string
  value: string
  mono?: boolean
  highlight?: 'success' | 'danger'
}) {
  return (
    <div className="flex items-center justify-between text-xs" style={{ color: 'var(--subtle)' }}>
      <span>{label}</span>
      <span
        className={mono ? 'mono tabular-nums' : ''}
        style={{
          color:
            highlight === 'success'
              ? 'var(--success)'
              : highlight === 'danger'
              ? 'var(--danger)'
              : 'var(--ink-2)',
        }}
      >
        {value}
      </span>
    </div>
  )
}
