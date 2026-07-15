'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Navbar from '@/components/ui/Navbar'
import CustomerPeek from '@/components/ui/CustomerPeek'

// Customer Book — the unified contact spine (all customers: chat + sales + calls).
// Search by name or number; tap anyone for their full biography (CustomerPeek).

interface ContactRow {
  id: string
  phone: string
  name: string
  fromChat: boolean
  fromSales: boolean
  isOptedOut: boolean
  valueTier: string | null
  recencyTier: string | null
  lastPurchase: string | null
  lifetimeValue: number | null
}

type Filter = 'all' | 'active' | 'opted_out'
const PAGE = 30

export default function ContactsPage() {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [rows, setRows] = useState<ContactRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [peekPhone, setPeekPhone] = useState<string | null>(null)
  const reqId = useRef(0)

  const load = useCallback(async (query: string, f: Filter, offset: number) => {
    const my = ++reqId.current
    setLoading(true)
    try {
      const res = await fetch(`/api/contacts?q=${encodeURIComponent(query)}&filter=${f}&limit=${PAGE}&offset=${offset}`)
      const data = await res.json()
      if (my !== reqId.current) return // a newer request superseded this one
      if (res.ok) {
        setTotal(data.total ?? 0)
        setRows(prev => offset === 0 ? data.contacts : [...prev, ...data.contacts])
      }
    } finally {
      if (my === reqId.current) setLoading(false)
    }
  }, [])

  // Debounced search / filter changes reset to first page.
  useEffect(() => {
    const t = setTimeout(() => load(q, filter, 0), 250)
    return () => clearTimeout(t)
  }, [q, filter, load])

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 pt-4 pb-24">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-bold text-gray-900">Customer Book</h1>
          <span className="text-xs text-gray-400">{total.toLocaleString('en-IN')} contacts</span>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
          </svg>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            className="input pl-9"
            placeholder="Search by name or number"
            inputMode="search"
          />
        </div>

        {/* Filter */}
        <div className="flex gap-2 mb-3">
          {(['all', 'active', 'opted_out'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                filter === f ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'
              }`}>
              {f === 'all' ? 'All' : f === 'active' ? 'Active' : 'Opted out'}
            </button>
          ))}
        </div>

        {rows.length === 0 && !loading && (
          <p className="text-sm text-gray-400 text-center py-10">No contacts found.</p>
        )}

        <div className="card divide-y divide-gray-100 overflow-hidden">
          {rows.map(c => (
            <button
              key={c.id}
              onClick={() => setPeekPhone(c.phone)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left active:bg-gray-50"
            >
              <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                <span className="text-gray-600 font-bold text-sm">{c.name.charAt(0).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="font-semibold text-gray-900 text-sm truncate">{c.name}</p>
                  {c.valueTier && <Badge cls="bg-amber-50 text-amber-700 border-amber-200">{c.valueTier}</Badge>}
                  {c.isOptedOut && <Badge cls="bg-red-50 text-red-600 border-red-200">Opted out</Badge>}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-xs text-gray-500">+91 {c.phone}</span>
                  {c.fromChat && <Dot cls="bg-green-500" title="Chat" />}
                  {c.fromSales && <Dot cls="bg-blue-500" title="Sales" />}
                  {c.lastPurchase && <span className="text-[11px] text-gray-400">· last {new Date(c.lastPurchase).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })}</span>}
                </div>
              </div>
              <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex justify-center py-4">
            <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && rows.length < total && (
          <button
            onClick={() => load(q, filter, rows.length)}
            className="w-full mt-3 py-2.5 text-sm font-medium text-green-700 border border-green-200 rounded-xl bg-green-50 active:bg-green-100"
          >
            Load more ({(total - rows.length).toLocaleString('en-IN')} more)
          </button>
        )}
      </main>

      <CustomerPeek phone={peekPhone} onClose={() => setPeekPhone(null)} />
    </div>
  )
}

function Badge({ children, cls }: { children: React.ReactNode; cls: string }) {
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0 ${cls}`}>{children}</span>
}
function Dot({ cls, title }: { cls: string; title: string }) {
  return <span title={title} className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cls}`} />
}
