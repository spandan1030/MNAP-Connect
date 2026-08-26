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
  const [sendWelcome, setSendWelcome] = useState(true)
  const [hasWelcomeTemplate, setHasWelcomeTemplate] = useState(false)
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
    // Is an approved walk-in welcome template configured? If not, hide the toggle
    // and the success card explains why nothing was sent.
    supabase.from('wa_message_templates').select('id')
      .eq('is_active', true).eq('category', 'walkin').limit(1)
      .then(({ data }) => setHasWelcomeTemplate((data ?? []).length > 0))
  }, [supabase])

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ phone: string; name: string; created: boolean; signals: number; welcome: string; hot: boolean } | null>(null)
  const [peekPhone, setPeekPhone] = useState<string | null>(null)

  // Existing-number lookup — search the whole contact spine as the salesman types.
  const [suggest, setSuggest] = useState<Array<{ phone: string; name: string }>>([])
  const [showSuggest, setShowSuggest] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    const digits = phone.replace(/\D/g, '').replace(/^91/, '')
    if (digits.length < 3 || digits === picked) { setSuggest([]); setShowSuggest(false); return }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts?q=${digits}&limit=8`)
        const data = await res.json()
        const rows = ((data.contacts ?? []) as Array<{ phone: string; name: string }>).map(c => ({ phone: c.phone, name: c.name }))
        setSuggest(rows); setShowSuggest(rows.length > 0)
      } catch { /* ignore */ }
    }, 250)
    return () => clearTimeout(t)
  }, [phone, picked])

  function pickContact(c: { phone: string; name: string }) {
    setPhone(c.phone); setPicked(c.phone)
    if (c.name && c.name !== 'Unknown') setName(c.name)
    setShowSuggest(false)
  }

  function toggle(key: string) {
    setSelected(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  function reset() {
    setName(''); setPhone(''); setSelected(new Set()); setTiming(''); setIsVip(false); setNotes('')
    setSendWelcome(true)
    setError(''); setDone(null); setPicked(null); setSuggest([]); setShowSuggest(false)
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
          salesmanId: salesmanId || undefined, sendWelcome,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not save.'); setSaving(false); return }
      setDone({ phone: data.phone, name: name.trim(), created: data.created, signals: data.signals, welcome: data.welcome?.status ?? 'disabled', hot: isVip })
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

            {/* Touch 0 outcome — exactly what the automated welcome did. */}
            <WelcomeStatus status={done.welcome} />

            {/* Hot lead → the salesman follows up personally, on top of the auto-message. */}
            {done.hot && (
              <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-left space-y-2">
                <p className="text-sm font-bold text-amber-900 flex items-center gap-1.5">
                  <span>🔥</span> Hot lead — follow up personally
                </p>
                <p className="text-[11px] text-amber-700 leading-snug">
                  The welcome message is automated. For a hot lead, add a personal touch now — open their WhatsApp and say hello yourself.
                </p>
                <a
                  href={`https://wa.me/91${done.phone}?text=${encodeURIComponent(`Hi ${done.name || 'there'}! It was lovely having you at M N Alankar Palace today. I'd be happy to help you find exactly what you're looking for — do reply here anytime. 🙏`)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="btn-primary w-full inline-flex items-center justify-center gap-2 !bg-green-600 !border-green-600"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 018.413 3.488 11.824 11.824 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.51 5.26l-.999 3.648 3.978-.607z"/></svg>
                  Message {done.name?.split(' ')[0] || 'them'} on WhatsApp
                </a>
              </div>
            )}

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
                  <div className="relative flex-1">
                    <input value={phone} onChange={e => { setPicked(null); setPhone(e.target.value) }}
                      onFocus={() => { if (suggest.length) setShowSuggest(true) }}
                      className="input w-full" placeholder="10-digit number" inputMode="numeric" maxLength={13}
                      autoComplete="off" autoCorrect="off" spellCheck={false} name="walkin-phone-lookup" />
                    {showSuggest && suggest.length > 0 && (
                      <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden max-h-60 overflow-y-auto">
                        <p className="text-[10px] text-gray-400 px-3 pt-2 pb-1">Existing customers — tap to fill</p>
                        {suggest.map(c => (
                          <button key={c.phone} type="button" onClick={() => pickContact(c)}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-gray-50 border-t border-gray-50">
                            <span className="text-sm text-gray-800 truncate">{c.name}</span>
                            <span className="text-xs text-gray-500 flex-shrink-0">+91 {c.phone}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {picked && <p className="text-[11px] text-green-600 mt-1">Existing customer — details filled. Their new walk-in will update this profile.</p>}
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
              {hasWelcomeTemplate && (
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={sendWelcome} onChange={e => setSendWelcome(e.target.checked)} className="mt-0.5" />
                  <span>
                    Send welcome WhatsApp now
                    <span className="block text-[11px] text-gray-400">Today&apos;s rate + fresh designs. Skipped automatically if they&apos;ve opted out or were messaged recently.</span>
                  </span>
                </label>
              )}
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

// The Touch 0 outcome, told plainly so the salesman knows whether to follow up.
function WelcomeStatus({ status }: { status: string }) {
  const MAP: Record<string, { tone: string; text: string }> = {
    sent:               { tone: 'green', text: '✓ Welcome message sent on WhatsApp' },
    skipped_suppressed: { tone: 'gray',  text: 'Already messaged recently — welcome skipped (no repeat)' },
    skipped_dnc:        { tone: 'gray',  text: 'Customer has opted out — no message sent' },
    skipped_no_rate:    { tone: 'amber', text: "Today's rate isn't set yet — welcome held. Set the rate, then message manually." },
    no_template:        { tone: 'amber', text: 'No welcome template set up yet — nothing sent.' },
    disabled:           { tone: 'gray',  text: 'Welcome message was turned off for this walk-in.' },
    failed:             { tone: 'red',   text: "Welcome couldn't be sent — please message them manually." },
    error:              { tone: 'red',   text: "Welcome couldn't be sent — please message them manually." },
  }
  const m = MAP[status] ?? MAP.error
  const cls: Record<string, string> = {
    green: 'bg-green-50 border-green-200 text-green-700',
    gray:  'bg-gray-50 border-gray-200 text-gray-500',
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    red:   'bg-red-50 border-red-200 text-red-700',
  }
  return <p className={`rounded-lg border px-3 py-2 text-[12px] font-medium ${cls[m.tone]}`}>{m.text}</p>
}
