import { useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useAccount } from 'wagmi'
import { Cpu, PenLine, Zap, Activity as ActivityIcon } from 'lucide-react'
import { Directory } from '@/components/Directory'
import { Register } from '@/components/Register'
import { Pay } from '@/components/Pay'
import { Activity } from '@/components/Activity'

type Tab = 'directory' | 'register' | 'pay' | 'activity'

const CONTRACT_ADDRESS = (import.meta.env.VITE_AGENTPAY_ADDRESS ?? '') as `0x${string}` | ''

const TABS: { id: Tab; label: string; icon: typeof Cpu }[] = [
  { id: 'directory', label: 'Directory', icon: Cpu },
  { id: 'register', label: 'Register', icon: PenLine },
  { id: 'pay', label: 'Pay', icon: Zap },
  { id: 'activity', label: 'Activity', icon: ActivityIcon },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('directory')
  const { isConnected } = useAccount()

  const contractAddr = CONTRACT_ADDRESS || undefined

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      {/* Top bar */}
      <header
        className="sticky top-0 z-30 border-b"
        style={{
          background: 'rgba(13,27,47,0.85)',
          backdropFilter: 'blur(20px)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div
              className="flex size-7 items-center justify-center rounded-lg"
              style={{ background: 'var(--accent)', opacity: 0.9 }}
            >
              <Zap className="size-4 text-[#0d1b2f]" />
            </div>
            <span className="display text-sm font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
              AgentPay
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wider"
              style={{ background: 'rgba(172,198,233,0.12)', color: 'var(--accent)' }}
            >
              Arc Mainnet
            </span>
          </div>

          <div className="flex items-center gap-3">
            {!contractAddr && (
              <span className="hidden text-xs sm:block" style={{ color: 'var(--danger)' }}>
                Set VITE_AGENTPAY_ADDRESS
              </span>
            )}
            <ConnectKitButton />
          </div>
        </div>

        {/* Tab bar */}
        <div className="mx-auto flex max-w-5xl gap-0 overflow-x-auto px-4">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap"
                style={{
                  color: active ? 'var(--accent)' : 'var(--subtle)',
                  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                }}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            )
          })}
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-5xl px-4 py-6">
        {/* Contract status banner */}
        {!contractAddr && (
          <div
            className="mb-5 rounded-2xl px-5 py-3.5 text-sm"
            style={{ background: 'rgba(186,43,76,0.08)', border: '1px solid rgba(186,43,76,0.2)' }}
          >
            <p className="font-semibold" style={{ color: 'var(--danger)' }}>
              Contract not configured
            </p>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
              Deploy AgentPay.sol to Arc Mainnet, then add{' '}
              <code className="mono rounded px-1 py-0.5" style={{ background: 'rgba(255,255,255,0.07)' }}>
                VITE_AGENTPAY_ADDRESS=0x...
              </code>{' '}
              to your .env file.
            </p>
          </div>
        )}

        {/* Connection prompt on activity tab */}
        {tab === 'activity' && !isConnected && (
          <div
            className="mb-4 rounded-2xl px-5 py-3.5 text-sm"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <p style={{ color: 'var(--muted)' }}>Connect your wallet to see your payment activity.</p>
          </div>
        )}

        {tab === 'directory' && <Directory contractAddress={contractAddr} />}
        {tab === 'register' && <Register contractAddress={contractAddr} />}
        {tab === 'pay' && <Pay contractAddress={contractAddr} />}
        {tab === 'activity' && <Activity contractAddress={contractAddr} />}
      </main>

      {/* Footer */}
      <footer className="mx-auto mt-8 max-w-5xl border-t px-4 py-4" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs" style={{ color: 'var(--subtle)' }}>
          <div className="flex items-center gap-4">
            <span>
              Chain:{' '}
              <span className="mono tabular-nums" style={{ color: 'var(--ink-2)' }}>
                5042 (Arc Mainnet)
              </span>
            </span>
            {contractAddr && (
              <span>
                Contract:{' '}
                <a
                  href={`https://explorer.arc.io/address/${contractAddr}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mono hover:opacity-80"
                  style={{ color: 'var(--accent)' }}
                >
                  {contractAddr.slice(0, 10)}…
                </a>
              </span>
            )}
          </div>
          <span>x402 · USDC · Arc</span>
        </div>
      </footer>
    </div>
  )
}
