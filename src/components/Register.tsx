/**
 * Register screen — register/update an agent AND set a spending limit in the same flow.
 * The spending limit step appears after agent registration/update and is required
 * before the Pay screen will work (pay() requires limits[caller].configured).
 */
import { useState } from 'react'
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
  useReadContract,
} from 'wagmi'
import { Loader2, CheckCircle, AlertCircle, ShieldCheck } from 'lucide-react'
import {
  AGENTPAY_ABI,
  formatUsdc,
  parseUsdc,
  explorerTx,
  ARC_MAINNET_CHAIN_ID,
} from '@/agentpay-abi'

interface RegisterProps {
  contractAddress: `0x${string}` | undefined
}

// ---- Spending limit sub-form ---------------------------------------------------

function SpendingLimitForm({
  contractAddress,
  alreadyConfigured,
}: {
  contractAddress: `0x${string}` | undefined
  alreadyConfigured: boolean
}) {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const wrongChain = isConnected && chainId !== ARC_MAINNET_CHAIN_ID

  const [limitInput, setLimitInput] = useState('')
  const [formError, setFormError] = useState('')

  const {
    writeContract,
    data: hash,
    isPending,
    isError: writeError,
    error: writeErr,
    reset,
  } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const limitRaw = parseUsdc(limitInput)
  const isValid = limitRaw > 0n

  function handleSubmit() {
    setFormError('')
    if (!contractAddress) { setFormError('Contract not deployed yet.'); return }
    if (!address) { setFormError('Connect your wallet.'); return }
    if (!isValid) { setFormError('Enter a positive USDC amount.'); return }
    reset()
    writeContract({
      address: contractAddress,
      abi: AGENTPAY_ABI,
      functionName: 'setSpendingLimit',
      args: [limitRaw],
      chainId: ARC_MAINNET_CHAIN_ID,
    })
  }

  return (
    <div
      className="rounded-2xl p-5 space-y-4"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-5 shrink-0" style={{ color: 'var(--accent)' }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Daily spending limit</p>
          <p className="text-xs" style={{ color: 'var(--subtle)' }}>
            {alreadyConfigured
              ? 'Already set. Update it here.'
              : 'Required before you can call pay(). Sets your max outflow per rolling 24h.'}
          </p>
        </div>
      </div>

      <div
        className="flex items-center gap-2 rounded-xl px-3 py-2.5"
        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
      >
        <input
          type="text"
          inputMode="decimal"
          placeholder="e.g. 10.00"
          value={limitInput}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9.]/g, '')
            if (v === '' || /^\d*\.?\d*$/.test(v)) setLimitInput(v)
          }}
          className="mono w-full bg-transparent text-sm tabular-nums outline-none"
          style={{ color: 'var(--ink)' }}
        />
        <span className="text-xs font-semibold" style={{ color: 'var(--subtle)' }}>USDC / day</span>
      </div>

      {limitRaw > 0n && (
        <p className="mono text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
          {limitRaw.toString()} units = {formatUsdc(limitRaw)} USDC per rolling 24h window
        </p>
      )}

      {wrongChain ? (
        <button
          onClick={() => switchChain({ chainId: ARC_MAINNET_CHAIN_ID })}
          className="w-full rounded-2xl py-3 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{ background: 'var(--accent)', color: '#0d1b2f' }}
        >
          Switch to Arc Mainnet
        </button>
      ) : (
        <button
          disabled={!isConnected || !isValid || isPending || isConfirming}
          onClick={handleSubmit}
          className="w-full rounded-2xl py-3 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#0d1b2f' }}
        >
          {isPending ? (
            <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> Confirm in wallet…</span>
          ) : isConfirming ? (
            <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> Confirming…</span>
          ) : alreadyConfigured ? (
            'Update Spending Limit'
          ) : (
            'Set Spending Limit'
          )}
        </button>
      )}

      {isSuccess && hash && (
        <div className="flex items-start gap-3 rounded-xl p-3" style={{ background: 'rgba(141,216,159,0.08)', border: '1px solid rgba(141,216,159,0.2)' }}>
          <CheckCircle className="size-4 mt-0.5 shrink-0" style={{ color: 'var(--success)' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--success)' }}>Spending limit set</p>
            <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="text-xs hover:opacity-80" style={{ color: 'var(--accent-hover)' }}>
              View on ArcScan
            </a>
          </div>
        </div>
      )}
      {(formError || writeError) && (
        <div className="flex items-start gap-3 rounded-xl p-3" style={{ background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.2)' }}>
          <AlertCircle className="size-4 mt-0.5 shrink-0" style={{ color: 'var(--danger)' }} />
          <p className="text-xs" style={{ color: 'var(--danger)' }}>{formError || writeErr?.message}</p>
        </div>
      )}
    </div>
  )
}

// ---- Agent registration form --------------------------------------------------

interface FormProps extends RegisterProps {
  existingName: string
  existingUrl: string
  existingPrice: string
  isRegistered: boolean
  limitConfigured: boolean
}

function RegisterForm({
  contractAddress,
  existingName,
  existingUrl,
  existingPrice,
  isRegistered,
  limitConfigured,
}: FormProps) {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const wrongChain = isConnected && chainId !== ARC_MAINNET_CHAIN_ID

  const [name, setName] = useState(existingName)
  const [serviceUrl, setServiceUrl] = useState(existingUrl)
  const [priceInput, setPriceInput] = useState(existingPrice)
  const [error, setError] = useState('')

  const funcName = isRegistered ? 'updateAgent' : 'registerAgent'

  const {
    writeContract,
    data: hash,
    isPending,
    isError: writeError,
    error: writeErr,
    reset,
  } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const priceRaw = parseUsdc(priceInput)
  const isValid = name.trim().length > 0 && serviceUrl.trim().length > 0 && priceRaw > 0n

  function handleSubmit() {
    setError('')
    if (!contractAddress) { setError('Contract not deployed yet — set VITE_AGENTPAY_ADDRESS in .env'); return }
    if (!address) { setError('Connect your wallet.'); return }
    if (!isValid) { setError('Fill in all fields. Price must be > 0.'); return }
    reset()
    writeContract({
      address: contractAddress,
      abi: AGENTPAY_ABI,
      functionName: funcName,
      args: [name.trim(), serviceUrl.trim(), priceRaw],
      chainId: ARC_MAINNET_CHAIN_ID,
    })
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h2 className="display text-xl font-semibold" style={{ color: 'var(--ink)' }}>
          {isRegistered ? 'Update Agent' : 'Register Agent'}
        </h2>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--subtle)' }}>
          {isRegistered
            ? 'Your agent is registered. Update its details below.'
            : 'Register your address as a paid service endpoint on AgentPay.'}
        </p>
      </div>

      {/* Agent fields */}
      <div className="rounded-2xl p-5 space-y-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>
            Agent Name
          </label>
          <input
            type="text"
            placeholder="e.g. WeatherOracle-v1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>
            Service URL
          </label>
          <input
            type="url"
            placeholder="https://my-agent.example.com/api"
            value={serviceUrl}
            onChange={(e) => setServiceUrl(e.target.value)}
            className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--subtle)' }}>
            Price per Call
          </label>
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.000500"
              value={priceInput}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9.]/g, '')
                if (v === '' || /^\d*\.?\d*$/.test(v)) setPriceInput(v)
              }}
              className="mono w-full bg-transparent text-sm tabular-nums outline-none"
              style={{ color: 'var(--ink)' }}
            />
            <span className="text-xs font-semibold" style={{ color: 'var(--subtle)' }}>USDC</span>
          </div>
          {priceRaw > 0n && (
            <p className="mono mt-1.5 text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
              {priceRaw.toString()} units = {formatUsdc(priceRaw)} USDC
            </p>
          )}
        </div>
      </div>

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
          disabled={!isConnected || !isValid || isPending || isConfirming}
          onClick={handleSubmit}
          className="w-full rounded-2xl py-3.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#0d1b2f' }}
        >
          {!isConnected ? 'Connect Wallet'
            : isPending ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> Confirm in wallet…</span>
            : isConfirming ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> Confirming…</span>
            : isRegistered ? 'Update Agent'
            : 'Register Agent'}
        </button>
      )}

      {isSuccess && hash && (
        <div className="flex items-start gap-3 rounded-2xl p-4" style={{ background: 'rgba(141,216,159,0.08)', border: '1px solid rgba(141,216,159,0.2)' }}>
          <CheckCircle className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--success)' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--success)' }}>
              {isRegistered ? 'Agent updated' : 'Agent registered'}
            </p>
            <a href={explorerTx(hash)} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs hover:opacity-80" style={{ color: 'var(--accent-hover)' }}>
              View on ArcScan
            </a>
          </div>
        </div>
      )}

      {(error || writeError) && (
        <div className="flex items-start gap-3 rounded-2xl p-4" style={{ background: 'rgba(232,109,122,0.08)', border: '1px solid rgba(232,109,122,0.2)' }}>
          <AlertCircle className="size-4 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
          <p className="text-xs" style={{ color: 'var(--danger)' }}>{error || writeErr?.message || 'Transaction failed'}</p>
        </div>
      )}

      {/* Spending limit — always shown below agent form */}
      <SpendingLimitForm contractAddress={contractAddress} alreadyConfigured={limitConfigured} />
    </div>
  )
}

// ---- Public export ------------------------------------------------------------

export function Register({ contractAddress }: RegisterProps) {
  const { address } = useAccount()

  const { data: existing } = useReadContract({
    address: contractAddress,
    abi: AGENTPAY_ABI,
    functionName: 'getAgent',
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

  const isRegistered =
    !!existing && existing.owner !== '0x0000000000000000000000000000000000000000'

  const key = isRegistered ? `edit-${address}` : `new-${address}`

  return (
    <RegisterForm
      key={key}
      contractAddress={contractAddress}
      existingName={isRegistered ? existing.name : ''}
      existingUrl={isRegistered ? existing.serviceUrl : ''}
      existingPrice={isRegistered ? (Number(existing.pricePerCall) / 1_000_000).toString() : ''}
      isRegistered={isRegistered}
      limitConfigured={!!limitConfigured}
    />
  )
}
