'use client'

import { useEffect, useState } from 'react'
import Navbar from '@/components/ui/Navbar'
import CustomerPeek from '@/components/ui/CustomerPeek'
import { createClient } from '@/lib/supabase/client'
import { INTERESTS } from '@/lib/signals'

// Walk-in registration — lean, counter-speed capture. Everything the salesman
// ticks becomes a wa_signals row (source='walkin'), so the visitor is instantly
// reach-targetable and shows on their profile with walk-in provenance. Occasion
// (wedding/gift/festival) is a first-class signal too. (Deeper prospect-style
// profiling comes later, once staff are trained.)

const GROUPS: Array<{ key: string; label: string }> = [
  { key: 'engagement', label: 'Interested in' },
  { key: 'occasion',   label: 'Occasion' },
  { key: 'metal',      label: 'Metal' },
  { key: 'product',    label: 'Product' },
]

const TIMING = [
  ['within_7_days', 'Within 7 days'],
  ['within_1_month', 'Within 1 month'],
  ['1_3_months', '1–3 months'],
  ['browsing', 'Just browsing'],
] as const

export default function WalkInPage() {
  const supabase = createClient()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [timing, setTiming] = useState('')
  const [isVip, setIsVip] = useState(false)
  const [notes, setNotes] = useState('')
  const [salesmen, setSalesmen] = useState<Array<{ id: string; name: string; alias: string }>>([])
  const [salesmanId, setSalesmanId] = useState<string>('')

  useEffect(() => {
    supabase.from('salesmen').select('id, name, alias').eq('is_active', true).order('created_at')
      .then(({ data }) => {
        const list = (data ?? []) as Array<{ id: string; name: string; alias: string }>
        setSalesmen(list)
        const saved = typeof window !== 'undefined' ? localStorage.getItem('mc_salesman') : null
        setSalesmanId(list.find(s => s.id === saved)?.id ?? list[0]?.id ?? '')
      })
  }, [supabase])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ phone: string; created: boolean; signals: number } | null>(null)
  const [peekPhone, setPeekPhone] = useState<string | null>(null)

  function toggle(key: string) {
    setSelected(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  function reset() {
    setName(''); setPhone(''); setSelected(new Set()); setTiming(''); setIsVip(false); setNotes('')
    setError(''); setDone(null)
  }

  async function save() {
    setError('')
    const cleaned = phone.replace(/\D/g, '').replace(/^91/, '')
    if (!name.trim()) { setError('Name is required.'); return }
    if (cleaned.length !== 10) { setError('Enter a valid 10-digit phone number.'); return }
    if (selected.size === 0) { setError('Tick at least one thing they showed interest in.'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/walkin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), phone: cleaned, interests: [...selected],
          timing: timing || undefined, notes: notes.trim() || undefined, isVip,
          salesmanId: salesmanId || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not save.'); setSaving(false); return }
      setDone({ phone: data.phone, created: data.created, signals: data.signals })
    } catch { setError('Network error — try again.') }
    finally { setSaving(false) }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-4 pb-28">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Walk-in</h1>
          <p className="text-xs text-gray-500">Log an in-store visitor and what they showed interest in. It goes straight onto their profile and into Reach.</p>
        </div>

        {done ? (
          <div className="card p-5 text-center space-y-3">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            </div>
            <div>
              <p className="font-semibold text-gray-900">{done.created ? 'Walk-in registered' : 'Walk-in updated'}</p>
              <p className="text-xs text-gray-500 mt-0.5">+91 {done.phone} · {done.signals} signal{done.signals !== 1 ? 's' : ''} saved</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setPeekPhone(done.phone)} className="btn-secondary flex-1">View profile</button>
              <button onClick={reset} className="btn-primary flex-1">Register another</button>
            </div>
          </div>
        ) : (
          <>
            {/* Identity */}
            <div className="card p-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input value={name} onChange={e => setName(e.target.value)} className="input" placeholder="Customer name" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <div className="flex gap-2 items-center">
                  <span className="text-sm text-gray-500 font-medium bg-gray-100 px-3 py-2.5 rounded-lg border border-gray-300">+91</span>
                  <input value={phone} onChange={e => setPhone(e.target.value)} className="input flex-1" placeholder="10-digit number" inputMode="numeric" maxLength={13} />
                </div>
              </div>
              {salesmen.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Enrolled by</label>
                  <select value={salesmanId} onChange={e => { setSalesmanId(e.target.value); if (typeof window !== 'undefined' && e.target.value) localStorage.setItem('mc_salesman', e.target.value) }} className="input text-sm">
                    {salesmen.map(s => <option key={s.id} value={s.id}>{s.alias} · {s.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Signals */}
            <div className="card p-4 space-y-4">
              <p className="text-sm font-semibold text-gray-800">What did they show interest in?</p>
              {GROUPS.map(g => {
                const items = INTERESTS.filter(i => i.group === g.key)
                return (
                  <div key={g.key}>
                    <p className="text-[11px] font-medium text-gray-400 mb-1.5">{g.label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {items.map(i => (
                        <button key={i.key} type="button" onClick={() => toggle(i.key)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] border font-medium ${selected.has(i.key) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                          {i.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Context */}
            <div className="card p-4 space-y-3">
              <div>
                <p className="text-[11px] font-medium text-gray-400 mb-1.5">Planning to buy</p>
                <div className="flex flex-wrap gap-1.5">
                  {TIMING.map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setTiming(timing === v ? '' : v)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] border font-medium ${timing === v ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={isVip} onChange={e => setIsVip(e.target.checked)} />
                Mark as hot lead (priority follow-up)
              </label>
              <input value={notes} onChange={e => setNotes(e.target.value)} className="input text-sm" placeholder="Note (optional) — e.g. wants bridal set for March wedding" />
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

            <button onClick={save} disabled={saving} className="btn-primary w-full disabled:opacity-60">
              {saving ? 'Saving…' : 'Register walk-in'}
            </button>
          </>
        )}
      </main>

      <CustomerPeek phone={peekPhone} onClose={() => setPeekPhone(null)} />
    </div>
  )
}
