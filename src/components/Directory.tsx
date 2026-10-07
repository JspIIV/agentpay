/**
 * Directory — paginated agent listing using listActiveAgents(offset, limit).
 */
import { useState, useMemo } from 'react'
import { useReadContract } from 'wagmi'
import { Search, ExternalLink, Cpu, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { AGENTPAY_ABI, type AgentStruct, formatUsdc, explorerAddr, formatAddr } from '@/agentpay-abi'
import { ARC_MAINNET_CHAIN_ID } from '@/agentpay-abi'

interface DirectoryProps {
  contractAddress: `0x${string}` | undefined
}

const PAGE_SIZE = 20n

export function Directory({ contractAddress }: DirectoryProps) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0n)

  const offset = page * PAGE_SIZE

  const { data, isLoading, refetch, isFetching } = useReadContract({
    address: contractAddress,
    abi: AGENTPAY_ABI,
    functionName: 'listActiveAgents',
    args: [offset, PAGE_SIZE],
    chainId: ARC_MAINNET_CHAIN_ID,
    query: { enabled: !!contractAddress },
  })

  const addresses = useMemo<`0x${string}`[]>(
    () => (data ? (data[0] as `0x${string}`[]) : []),
    [data],
  )
  const agents = useMemo<AgentStruct[]>(
    () => (data ? (data[1] as AgentStruct[]) : []),
    [data],
  )
  const totalActive = data ? Number(data[2]) : 0
  const totalPages = Math.max(1, Math.ceil(totalActive / Number(PAGE_SIZE)))

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return addresses
      .map((addr, i) => ({ addr, agent: agents[i] }))
      .filter(({ addr, agent }) =>
        !q ||
        agent.name.toLowerCase().includes(q) ||
        addr.toLowerCase().includes(q) ||
        agent.serviceUrl.toLowerCase().includes(q),
      )
  }, [addresses, agents, search])

  const handleSearch = (val: string) => {
    setSearch(val)
    setPage(0n) // reset to first page when searching
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="display text-xl font-semibold" style={{ color: 'var(--ink)' }}>Agent Directory</h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--subtle)' }}>
            {isLoading ? 'Loading…' : `${totalActive} active agent${totalActive !== 1 ? 's' : ''} total`}
            {contractAddress ? '' : ' — deploy contract first'}
          </p>
        </div>
        <button
          onClick={() => { void refetch() }}
          disabled={isFetching}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all hover:opacity-80 disabled:opacity-40"
          style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
        >
          <RefreshCw className={`size-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Search */}
      <div
        className="flex items-center gap-2 rounded-xl px-3 py-2.5"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <Search className="size-4 shrink-0" style={{ color: 'var(--subtle)' }} />
        <input
          type="text"
          placeholder="Search by name, address, URL…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--subtle)]"
          style={{ color: 'var(--ink)' }}
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl" style={{ background: 'var(--surface-muted)' }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="rounded-2xl px-6 py-10 text-center"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <Cpu className="mx-auto mb-3 size-8 opacity-30" style={{ color: 'var(--subtle)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--muted)' }}>
            {search ? 'No agents match your search' : 'No active agents yet'}
          </p>
          {!search && (
            <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
              Register the first agent on the Register tab.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-muted)' }}>
                  {['Agent', 'Address', 'Price / call', 'Total calls', 'Service URL'].map((h) => (
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
                {filtered.map(({ addr, agent }, idx) => (
                  <tr
                    key={addr}
                    className="transition-colors hover:bg-white/5"
                    style={{
                      borderBottom: idx < filtered.length - 1 ? '1px solid var(--border)' : undefined,
                      background: 'var(--surface)',
                    }}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                          style={{ background: 'var(--surface-muted)', color: 'var(--accent)' }}
                        >
                          {agent.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="font-medium" style={{ color: 'var(--ink)' }}>{agent.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={explorerAddr(addr)}
                        target="_blank"
                        rel="noreferrer"
                        className="mono flex items-center gap-1 text-xs hover:opacity-80"
                        style={{ color: 'var(--accent)' }}
                      >
                        {formatAddr(addr)}
                        <ExternalLink className="size-3" />
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span className="mono tabular-nums font-semibold" style={{ color: 'var(--ink)' }}>
                        {formatUsdc(agent.pricePerCall)}
                      </span>
                      <span className="ml-1 text-xs" style={{ color: 'var(--subtle)' }}>USDC</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="mono tabular-nums" style={{ color: 'var(--ink-2)' }}>
                        {agent.totalCallsPaid.toString()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={agent.serviceUrl.startsWith('http') ? agent.serviceUrl : `https://${agent.serviceUrl}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex max-w-[180px] items-center gap-1 truncate text-xs hover:opacity-80"
                        style={{ color: 'var(--accent-hover)' }}
                      >
                        <span className="truncate">{agent.serviceUrl || '—'}</span>
                        {agent.serviceUrl && <ExternalLink className="size-3 shrink-0" />}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: 'var(--subtle)' }}>
                Page {Number(page) + 1} of {totalPages} ({totalActive} agents)
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page === 0n}
                  onClick={() => setPage((p) => p - 1n)}
                  className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all hover:opacity-80 disabled:opacity-30"
                  style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
                >
                  <ChevronLeft className="size-3.5" /> Prev
                </button>
                <button
                  disabled={Number(page) >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1n)}
                  className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all hover:opacity-80 disabled:opacity-30"
                  style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
                >
                  Next <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
