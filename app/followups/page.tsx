'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/ui/Navbar'
import CustomerPeek from '@/components/ui/CustomerPeek'
import { INTEREST_LABEL } from '@/lib/signals'

// Follow-ups module — every scheduled contact (from chat or walk-in) that is
// still pending, grouped by when it's due. Tap a row for the full profile;
// mark done, reschedule, call, or open the chat.

interface Followup {
  id: string
  phone: string
  name: string | null
  customerId: string | null
  dueOn: string          // YYYY-MM-DD
  interests: string[]
  note: string | null
  status: string
  salesman: string | null
}

// Whole-day difference (dueOn - today), so "today" is 0 regardless of clock time.
function daysUntil(dueOn: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const due = new Date(dueOn + 'T00:00:00'); due.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - today.getTime()) / 86_400_000)
}

const BUCKETS: Array<{ key: string; label: string; test: (d: number) => boolean; tone: string }> = [
  { key: 'overdue',  label: 'Overdue',   test: d => d < 0,            tone: 'text-red-600' },
  { key: 'today',    label: 'Due today', test: d => d === 0,          tone: 'text-amber-600' },
  { key: 'tomorrow', label: 'Tomorrow',  test: d => d === 1,          tone: 'text-gray-800' },
  { key: 'in2',      label: 'In 2 days', test: d => d === 2,          tone: 'text-gray-800' },
  { key: 'week',     label: 'This week', test: d => d >= 3 && d <= 7, tone: 'text-gray-800' },
  { key: 'later',    label: 'Later',     test: d => d > 7,            tone: 'text-gray-500' },
]

function fmtDue(dueOn: string): string {
  return new Date(dueOn + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function FollowupsPage() {
  const router = useRouter()
  const [rows, setRows] = useState<Followup[]>([])
  const [loading, setLoading] = useState(true)
  const [peekPhone, setPeekPhone] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [rescheduleId, setRescheduleId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/followups?scope=pending')
      const data = await res.json()
      if (res.ok) setRows((data.followups ?? []) as Followup[])
    } finally { setLoading(false) }
  }, [])

  // Defer out of the synchronous effect body (load() flips loading state).
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t) }, [load])

  async function act(id: string, action: 'done' | 'cancel' | 'reschedule', dueInDays?: number) {
    setBusy(id)
    try {
      const res = await fetch('/api/followups', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, dueInDays }),
      })
      if (res.ok) {
        if (action === 'reschedule') { setRescheduleId(null); await load() }
        else setRows(rs => rs.filter(r => r.id !== id))   // done / cancel leave the pending list
      }
    } finally { setBusy(null) }
  }

  async function callNow(f: Followup) {
    const salesmanId = typeof window !== 'undefined' ? localStorage.getItem('mc_salesman') : null
    fetch('/api/calls/log', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: f.phone, salesmanId }),
    }).catch(() => {})
    window.location.assign(`tel:+91${f.phone}`)
  }

  const grouped = BUCKETS.map(b => ({ ...b, items: rows.filter(r => b.test(daysUntil(r.dueOn))) })).filter(g => g.items.length)

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 pt-4 pb-24">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Follow-ups</h1>
            <p className="text-xs text-gray-500">Scheduled contacts from chat &amp; walk-in — who to reach, and when.</p>
          </div>
          <span className="text-xs text-gray-400">{rows.length} pending</span>
        </div>

        {loading && (
          <div className="flex justify-center py-10">
            <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && rows.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-12">No pending follow-ups. Schedule one from a chat or a walk-in.</p>
        )}

        <div className="space-y-5">
          {grouped.map(g => (
            <div key={g.key}>
              <p className={`text-[11px] font-semibold uppercase tracking-wide mb-1.5 ${g.tone}`}>
                {g.label} <span className="text-gray-400 font-normal">· {g.items.length}</span>
              </p>
              <div className="card divide-y divide-gray-100 overflow-hidden">
                {g.items.map(f => {
                  const d = daysUntil(f.dueOn)
                  const due = d < 0 ? `overdue ${-d}d` : d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d}d`
                  return (
                    <div key={f.id} className="p-3">
                      <div className="flex items-start gap-2">
                        <button onClick={() => setPeekPhone(f.phone)} className="flex-1 min-w-0 text-left">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-semibold text-gray-900 text-sm truncate">{f.name || `+91 ${f.phone}`}</p>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${d < 0 ? 'bg-red-50 text-red-600 border-red-200' : d === 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                              {due}
                            </span>
                            {f.salesman && <span className="text-[10px] bg-pink-50 text-pink-700 border border-pink-200 px-1.5 py-0.5 rounded-full">{f.salesman}</span>}
                          </div>
                          <p className="text-[11px] text-gray-400 mt-0.5">+91 {f.phone} · due {fmtDue(f.dueOn)}</p>
                          {f.interests.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {f.interests.map(k => (
                                <span key={k} className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded-full">{INTEREST_LABEL[k] ?? k}</span>
                              ))}
                            </div>
                          )}
                          {f.note && <p className="text-xs text-gray-600 mt-1 italic">“{f.note}”</p>}
                        </button>
                      </div>

                      {/* Row actions */}
                      <div className="flex items-center gap-2 mt-2">
                        <button onClick={() => callNow(f)} className="text-[11px] font-semibold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full">Call</button>
                        <button onClick={() => router.push(`/messages/${f.phone}`)} className="text-[11px] font-semibold text-gray-700 bg-gray-50 border border-gray-200 px-2.5 py-1 rounded-full">Chat</button>
                        <button onClick={() => setRescheduleId(rescheduleId === f.id ? null : f.id)} className="text-[11px] font-semibold text-gray-700 bg-gray-50 border border-gray-200 px-2.5 py-1 rounded-full">Reschedule</button>
                        <button onClick={() => act(f.id, 'done')} disabled={busy === f.id}
                          className="ml-auto text-[11px] font-semibold text-white bg-green-600 px-3 py-1 rounded-full disabled:opacity-50">
                          {busy === f.id ? '…' : '✓ Done'}
                        </button>
                      </div>

                      {rescheduleId === f.id && (
                        <div className="flex items-center gap-1.5 mt-2 pl-0.5">
                          <span className="text-[11px] text-gray-400">Push to:</span>
                          {[1, 3, 7, 15, 30].map(n => (
                            <button key={n} onClick={() => act(f.id, 'reschedule', n)} disabled={busy === f.id}
                              className="text-[11px] font-medium text-gray-700 bg-white border border-gray-300 px-2 py-0.5 rounded-full active:bg-gray-100 disabled:opacity-50">
                              +{n}d
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </main>

      <CustomerPeek phone={peekPhone} onClose={() => setPeekPhone(null)} />
    </div>
  )
}
