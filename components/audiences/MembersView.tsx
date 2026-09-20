'use client'

import { useCallback, useEffect, useState } from 'react'
import CustomerPeek from '@/components/ui/CustomerPeek'

// Who is in a cohort — name + phone + opt-out — with search, a tap-to-peek, and
// a CSV download. Backed by POST /api/audiences/members. Give it the same body
// you'd send there: { audienceId, subRules?/subFilter? } for an audience (or its
// send set), or { rules } for any subset of the total pool.

interface Member { phone: string; name: string | null; optedOut: boolean }
interface Result { count: number; sendable: number; optedOut: number; members: Member[]; truncated: boolean }

export default function MembersView({
  body, filename, autoLoad = true,
}: {
  body: Record<string, unknown>
  filename: string
  autoLoad?: boolean
}) {
  const [data, setData] = useState<Result | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [peek, setPeek] = useState<string | null>(null)

  const bodyKey = JSON.stringify(body)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/audiences/members', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(bodyKey), limit: 500 }),
      })
      const d = await res.json()
      if (!res.ok) { setError(d.error ?? 'Could not load members.'); setData(null) }
      else setData(d)
    } catch { setError('Network error.') } finally { setLoading(false) }
  }, [bodyKey])

  useEffect(() => { if (autoLoad) load() }, [autoLoad, load])

  async function download() {
    setDownloading(true); setError(null)
    try {
      const res = await fetch('/api/audiences/members', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(bodyKey), limit: 0 }),
      })
      const d = await res.json() as Result
      if (!res.ok) { setError((d as unknown as { error?: string }).error ?? 'Export failed.'); return }
      const header = ['Name', 'Phone', 'Opted out']
      const rows = d.members.map(m => [m.name ?? '', `91${m.phone}`, m.optedOut ? 'Yes' : 'No'])
      const csv = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`.replace(/\s+/g, '_')
      a.click()
      URL.revokeObjectURL(url)
    } catch { setError('Network error.') } finally { setDownloading(false) }
  }

  const shown = (data?.members ?? []).filter(m => {
    if (!q.trim()) return true
    const s = q.trim().toLowerCase()
    return (m.name ?? '').toLowerCase().includes(s) || m.phone.includes(s.replace(/\D/g, ''))
  })

  return (
    <div className="space-y-2">
      {!autoLoad && !data && !loading && (
        <button onClick={load} className="w-full text-xs font-semibold border border-gray-200 bg-white py-2 rounded-lg">
          Load recipients
        </button>
      )}
      {loading && <div className="flex justify-center py-3"><div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>}
      {error && <p className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      {data && (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-[11px] text-gray-500">
              <b className="text-gray-800">{data.count.toLocaleString('en-IN')}</b> in cohort
              {data.optedOut > 0 && <> · <b className="text-gray-800">{data.sendable.toLocaleString('en-IN')}</b> reachable · {data.optedOut} opted out</>}
            </p>
            <div className="flex items-center gap-1.5">
              <button onClick={load} className="text-[11px] font-medium text-gray-600 border border-gray-200 bg-white px-2 py-0.5 rounded-full">Refresh</button>
              <button onClick={download} disabled={downloading}
                className="text-[11px] font-semibold text-white bg-gray-900 px-2.5 py-0.5 rounded-full disabled:opacity-50">
                {downloading ? 'Preparing…' : 'Download CSV'}
              </button>
            </div>
          </div>

          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name or number"
            className="input text-xs" />

          <div className="space-y-1 max-h-[50vh] overflow-y-auto">
            {shown.map(m => (
              <button key={m.phone} onClick={() => setPeek(m.phone)}
                className="w-full flex items-center gap-2 bg-white border border-gray-100 rounded-lg px-2.5 py-1.5 text-left">
                <span className="min-w-0 flex-1">
                  <span className="text-xs font-medium text-gray-800 truncate underline decoration-dotted underline-offset-2">{m.name || 'Unknown'}</span>
                  <span className="text-[11px] text-gray-400 ml-1.5">+91 {m.phone}</span>
                </span>
                {m.optedOut && <span className="flex-shrink-0 text-[10px] font-semibold text-gray-600 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded-full">Opted out</span>}
              </button>
            ))}
            {shown.length === 0 && <p className="text-[11px] text-gray-400 py-2 text-center">No one matches.</p>}
          </div>

          {data.truncated && <p className="text-[10px] text-gray-400">Showing the first 500 — Download CSV for all {data.count.toLocaleString('en-IN')}.</p>}
        </>
      )}
      <CustomerPeek phone={peek} onClose={() => setPeek(null)} />
    </div>
  )
}
