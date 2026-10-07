/**
 * Activity screen — reads PaymentMade logs from the chain via viem getLogs.
 * Chunked log fetching so large block ranges never fail in one request.
 * Deploy block read from VITE_AGENTPAY_DEPLOY_BLOCK.
 */
import { useState, useCallback } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { parseAbiItem } from 'viem'
import { ArrowUpRight, ArrowDownLeft, ExternalLink, RefreshCw } from 'lucide-react'
import {
  type PaymentMadeLog,
  formatUsdc,
  explorerTx,
  explorerAddr,
  formatAddr,
  formatTs,
  ARC_MAINNET_CHAIN_ID,
  DEPLOY_BLOCK,
} from '@/agentpay-abi'

interface ActivityProps {
  contractAddress: `0x${string}` | undefined
}

const CHUNK_SIZE = BigInt(2000)

const PAYMENT_MADE_EVENT = parseAbiItem(
  'event PaymentMade(address indexed from, address indexed to, uint256 amount, bytes32 indexed callId, uint256 timestamp)',
)

type CombinedRow = {
  dir: 'in' | 'out'
  from: `0x${string}`
  to: `0x${string}`
  amount: bigint
  callId: `0x${string}`
  timestamp: bigint
  txHash: `0x${string}` | null
}

export function Activity({ contractAddress }: ActivityProps) {
  const { address, isConnected } = useAccount()
  const publicClient = usePublicClient({ chainId: ARC_MAINNET_CHAIN_ID })

  const [rows, setRows] = useState<CombinedRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  const fetchLogs = useCallback(() => {
    if (!contractAddress || !address || !publicClient) return

    setLoading(true)
    setError('')

    publicClient.getBlockNumber().then((latestBlock) => {
      const fromBlock = DEPLOY_BLOCK > 0n ? DEPLOY_BLOCK : 0n
      const combined: CombinedRow[] = []
      const chunks: Array<{ start: bigint; end: bigint }> = []

      for (let s = fromBlock; s <= latestBlock; s += CHUNK_SIZE) {
        const e = s + CHUNK_SIZE - 1n < latestBlock ? s + CHUNK_SIZE - 1n : latestBlock
        chunks.push({ start: s, end: e })
      }

      const fetchChunk = (idx: number): Promise<void> => {
        if (idx >= chunks.length) return Promise.resolve()
        const { start, end } = chunks[idx]

        return Promise.all([
          publicClient.getLogs({
            address: contractAddress,
            event: PAYMENT_MADE_EVENT,
            args: { from: address },
            fromBlock: start,
            toBlock: end,
          }),
          publicClient.getLogs({
            address: contractAddress,
            event: PAYMENT_MADE_EVENT,
            args: { to: address },
            fromBlock: start,
            toBlock: end,
          }),
        ]).then(([sentLogs, receivedLogs]) => {
          for (const log of sentLogs as unknown as PaymentMadeLog[]) {
            if (!log.args.from || !log.args.to) continue
            combined.push({
              dir: 'out',
              from: log.args.from,
              to: log.args.to,
              amount: log.args.amount,
              callId: log.args.callId,
              timestamp: log.args.timestamp,
              txHash: log.transactionHash,
            })
          }
          for (const log of receivedLogs as unknown as PaymentMadeLog[]) {
            if (!log.args.from || !log.args.to) continue
            // Self-pay is blocked on-chain; guard here for defence-in-depth
            if (log.args.from.toLowerCase() === address.toLowerCase()) continue
            combined.push({
              dir: 'in',
              from: log.args.from,
              to: log.args.to,
              amount: log.args.amount,
              callId: log.args.callId,
              timestamp: log.args.timestamp,
              txHash: log.transactionHash,
            })
          }
          return fetchChunk(idx + 1)
        })
      }

      fetchChunk(0)
        .then(() => {
          combined.sort((a, b) => Number(b.timestamp - a.timestamp))
          setRows(combined)
          setLoaded(true)
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message.slice(0, 200) : 'Failed to fetch logs')
        })
        .finally(() => {
          setLoading(false)
        })
    }).catch((e: unknown) => {
      setError(e instanceof Error ? e.message.slice(0, 200) : 'Failed to get block number')
      setLoading(false)
    })
  }, [contractAddress, address, publicClient])

  // Load on first render when connected
  if (isConnected && contractAddress && address && !loaded && !loading) {
    fetchLogs()
  }

  const inCount = rows.filter((r) => r.dir === 'in').length
  const outCount = rows.filter((r) => r.dir === 'out').length

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-16" style={{ color: 'var(--subtle)' }}>
        <ArrowUpRight className="mb-3 size-8 opacity-40" />
        <p className="text-sm">Connect wallet to view activity</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="display text-xl font-semibold" style={{ color: 'var(--ink)' }}>Activity</h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--subtle)' }}>
            Payments in &amp; out — live from PaymentMade on-chain logs
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--success)' }}>
            <ArrowDownLeft className="size-3.5" />{inCount} in
          </span>
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--danger)' }}>
            <ArrowUpRight className="size-3.5" />{outCount} out
          </span>
          <button
            onClick={fetchLogs}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all hover:opacity-80 disabled:opacity-40"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl p-3 text-xs" style={{ background: 'rgba(232,109,122,0.08)', color: 'var(--danger)', border: '1px solid rgba(232,109,122,0.2)' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl" style={{ background: 'var(--surface-muted)' }} />
          ))}
        </div>
      ) : rows.length === 0 && loaded ? (
        <div className="rounded-2xl px-6 py-12 text-center" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>No payments yet for this address</p>
          <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
            {contractAddress
              ? 'Payments appear here after they confirm on Arc Mainnet.'
              : 'Deploy the contract and set VITE_AGENTPAY_ADDRESS first.'}
          </p>
        </div>
      ) : rows.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-muted)' }}>
                {['Dir', 'Amount', 'Counterparty', 'Call ID', 'Time', 'Tx'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-widest"
                    style={{ color: 'var(--subtle)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const counterparty = row.dir === 'in' ? row.from : row.to
                return (
                  <tr
                    key={`${row.dir}-${row.callId}-${idx}`}
                    className="transition-colors hover:bg-white/5"
                    style={{
                      borderBottom: idx < rows.length - 1 ? '1px solid var(--border)' : undefined,
                      background: 'var(--surface)',
                    }}
                  >
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold"
                        style={{
                          background: row.dir === 'in' ? 'rgba(141,216,159,0.10)' : 'rgba(232,109,122,0.10)',
                          color: row.dir === 'in' ? 'var(--success)' : 'var(--danger)',
                        }}
                      >
                        {row.dir === 'in' ? <ArrowDownLeft className="size-3" /> : <ArrowUpRight className="size-3" />}
                        {row.dir === 'in' ? 'IN' : 'OUT'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="mono tabular-nums font-semibold" style={{ color: 'var(--ink)' }}>
                        {formatUsdc(row.amount)}
                      </span>
                      <span className="ml-1 text-xs" style={{ color: 'var(--subtle)' }}>USDC</span>
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={explorerAddr(counterparty)}
                        target="_blank"
                        rel="noreferrer"
                        className="mono flex items-center gap-1 text-xs hover:opacity-80"
                        style={{ color: 'var(--accent)' }}
                      >
                        {formatAddr(counterparty)}
                        <ExternalLink className="size-3" />
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span className="mono text-xs" style={{ color: 'var(--muted)' }}>
                        {row.callId.slice(0, 10)}…
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs" style={{ color: 'var(--subtle)' }}>
                        {formatTs(row.timestamp)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {row.txHash ? (
                        <a
                          href={explorerTx(row.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-xs hover:opacity-80"
                          style={{ color: 'var(--accent-hover)' }}
                        >
                          View <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--subtle)' }}>—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
