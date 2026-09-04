'use client'

import { useEffect, useState, useCallback } from 'react'
import Navbar from '@/components/ui/Navbar'
import CustomerPeek from '@/components/ui/CustomerPeek'
import { createClient } from '@/lib/supabase/client'
import type { WaCoupon, WaCouponOffer } from '@/lib/types'
import {
  MONTHS, DISCOUNT_TYPE_LABEL, OCCASION_LABEL, offerLine, couponState,
  STATE_LABEL, STATE_TONE, COUPON_VALID_DAYS, type CouponState,
} from '@/lib/coupons'

// Coupon management + birthday/anniversary module. Three tabs:
//   · This month — whose birthday/anniversary falls now → issue + send a coupon
//   · Coupons    — every issued code: state, whose, redeem / void, code lookup
//   · Offers     — the reusable offer definitions codes are cut from

type Tab = 'month' | 'coupons' | 'offers'
interface Person {
  phone: string; name: string | null; is_opted_out: boolean
  coupon: { id: string; code: string; state: string; offer_name: string | null; sent_at: string | null } | null
}

const TONE_CLS: Record<string, string> = {
  green: 'bg-green-50 text-green-700 border-green-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  gray: 'bg-gray-100 text-gray-600 border-gray-200',
}
function StatePill({ state }: { state: CouponState }) {
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${TONE_CLS[STATE_TONE[state]]}`}>{STATE_LABEL[state]}</span>
}
function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function CouponsPage() {
  const supabase = createClient()
  const [tab, setTab] = useState<Tab>('month')
  const [offers, setOffers] = useState<WaCouponOffer[]>([])
  const [salesmen, setSalesmen] = useState<Array<{ id: string; name: string; alias: string }>>([])
  const [peekPhone, setPeekPhone] = useState<string | null>(null)
  const [flash, setFlash] = useState<string>('')

  const loadOffers = useCallback(async () => {
    const res = await fetch('/api/coupons/offers'); const d = await res.json()
    setOffers(d.offers ?? [])
  }, [])

  useEffect(() => {
    loadOffers()
    supabase.from('salesmen').select('id, name, alias').eq('is_active', true).order('created_at')
      .then(({ data }) => setSalesmen((data ?? []) as Array<{ id: string; name: string; alias: string }>))
  }, [loadOffers, supabase])

  const activeOffers = offers.filter(o => o.is_active)

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4 pb-28">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Coupons</h1>
          <p className="text-xs text-gray-500">Send birthday & anniversary coupon codes, track redemption, and manage your offers.</p>
        </div>

        {flash && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{flash}</p>}

        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {([['month', 'This month'], ['coupons', 'Coupons'], ['offers', 'Offers']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`flex-1 text-sm font-medium py-1.5 rounded-lg ${tab === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{l}</button>
          ))}
        </div>

        {tab === 'month' && <MonthTab activeOffers={activeOffers} salesmen={salesmen} onPeek={setPeekPhone} onFlash={setFlash} />}
        {tab === 'coupons' && <CouponsTab activeOffers={activeOffers} salesmen={salesmen} onPeek={setPeekPhone} onFlash={setFlash} />}
        {tab === 'offers' && <OffersTab offers={offers} reload={loadOffers} onFlash={setFlash} />}
      </main>
      <CustomerPeek phone={peekPhone} onClose={() => setPeekPhone(null)} />
    </div>
  )
}

// ── This month ──────────────────────────────────────────────────────────────
function MonthTab({ activeOffers, onPeek, onFlash }: {
  activeOffers: WaCouponOffer[]; salesmen: Array<{ id: string; name: string; alias: string }>; onPeek: (p: string) => void; onFlash: (s: string) => void
}) {
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [data, setData] = useState<{ birthdays: Person[]; anniversaries: Person[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [offerId, setOfferId] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async (m: number) => {
    setLoading(true)
    const res = await fetch(`/api/occasions?month=${m}`); const d = await res.json()
    setData({ birthdays: d.birthdays ?? [], anniversaries: d.anniversaries ?? [] }); setLoading(false)
  }, [])
  useEffect(() => { load(month) }, [month, load])
  useEffect(() => { if (!offerId && activeOffers[0]) setOfferId(activeOffers[0].id) }, [activeOffers, offerId])

  async function send(recipients: Array<{ phone: string; name: string | null; occasion: string }>) {
    if (!offerId) { onFlash('Pick an offer first.'); return }
    if (recipients.length === 0) return
    setBusy(recipients.length === 1 ? recipients[0].phone : 'all')
    try {
      const res = await fetch('/api/coupons/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId, recipients }),
      })
      const d = await res.json()
      if (!res.ok) { onFlash(d.error ?? 'Send failed.'); return }
      const skips = (d.skipped ?? 0) + ((d.issueSkipped ?? []).length)
      onFlash(`Sent ${d.sent} coupon${d.sent !== 1 ? 's' : ''}${d.failed ? `, ${d.failed} failed` : ''}${skips ? `, ${skips} skipped` : ''}.`)
      load(month)
    } catch { onFlash('Network error.') }
    finally { setBusy('') }
  }

  const eligible = (list: Person[]) => list.filter(p => !p.is_opted_out && !(p.coupon && (p.coupon.state === 'sent' || p.coupon.state === 'issued')))

  const Group = ({ title, list, occasion }: { title: string; list: Person[]; occasion: string }) => {
    const elig = eligible(list)
    return (
      <div className="card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-800">{title} <span className="text-gray-400 font-normal">({list.length})</span></p>
          {elig.length > 0 && (
            <button disabled={!!busy || !offerId} onClick={() => send(elig.map(p => ({ phone: p.phone, name: p.name, occasion })))}
              className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50">
              {busy === 'all' ? 'Sending…' : `Send to all (${elig.length})`}
            </button>
          )}
        </div>
        {list.length === 0 ? <p className="text-xs text-gray-400">Nobody this month.</p> : (
          <div className="divide-y divide-gray-100">
            {list.map(p => {
              const done = p.coupon && (p.coupon.state === 'sent' || p.coupon.state === 'redeemed' || p.coupon.state === 'issued')
              return (
                <div key={p.phone} className="flex items-center justify-between gap-2 py-2">
                  <button onClick={() => onPeek(p.phone)} className="min-w-0 text-left">
                    <p className="text-sm text-gray-800 truncate">{p.name || 'Unknown'}</p>
                    <p className="text-[11px] text-gray-400">+91 {p.phone}</p>
                  </button>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {p.is_opted_out ? <span className="text-[10px] text-gray-400">opted out</span>
                      : p.coupon && done ? (
                        <span className="flex items-center gap-1">
                          <StatePill state={p.coupon.state as CouponState} />
                          <span className="text-[10px] text-gray-400 font-mono">{p.coupon.code}</span>
                        </span>
                      ) : (
                        <button disabled={!!busy || !offerId} onClick={() => send([{ phone: p.phone, name: p.name, occasion }])}
                          className="btn-secondary text-xs px-3 py-1 disabled:opacity-50">
                          {busy === p.phone ? 'Sending…' : 'Send coupon'}
                        </button>
                      )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select value={month} onChange={e => setMonth(Number(e.target.value))} className="input text-sm flex-1">
          {MONTHS.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}{i + 1 === now.getMonth() + 1 ? ' (this month)' : ''}</option>)}
        </select>
      </div>

      {activeOffers.length === 0 ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No active offer yet. Create one in the <b>Offers</b> tab before you can send coupons.
        </p>
      ) : (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Offer to send</label>
          <select value={offerId} onChange={e => setOfferId(e.target.value)} className="input text-sm">
            {activeOffers.map(o => <option key={o.id} value={o.id}>{o.name} — {offerLine(o)}</option>)}
          </select>
          <p className="text-[11px] text-gray-400 mt-1">Each recipient gets a unique code, valid {COUPON_VALID_DAYS} days. Opted-out people and anyone who already holds a live coupon are skipped.</p>
        </div>
      )}

      {loading ? <p className="text-sm text-gray-400 text-center py-6">Loading…</p> : data && (
        <>
          <Group title="🎂 Birthdays" list={data.birthdays} occasion="birthday" />
          <Group title="💍 Anniversaries" list={data.anniversaries} occasion="anniversary" />
        </>
      )}
    </div>
  )
}

// ── Coupons list + lookup + redeem/void ──────────────────────────────────────
function CouponsTab({ salesmen, onPeek, onFlash }: {
  activeOffers: WaCouponOffer[]; salesmen: Array<{ id: string; name: string; alias: string }>; onPeek: (p: string) => void; onFlash: (s: string) => void
}) {
  const [coupons, setCoupons] = useState<WaCoupon[]>([])
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState('')     // '' | active | redeemed | expired | void | issued
  const [q, setQ] = useState('')
  const [redeem, setRedeem] = useState<WaCoupon | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (state) params.set('status', state)
    if (q.trim()) params.set('q', q.trim())
    const res = await fetch(`/api/coupons?${params}`); const d = await res.json()
    setCoupons(d.coupons ?? []); setLoading(false)
  }, [state, q])
  useEffect(() => { const t = setTimeout(load, q ? 300 : 0); return () => clearTimeout(t) }, [load, q])

  async function act(id: string, body: Record<string, unknown>) {
    const res = await fetch('/api/coupons', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }),
    })
    const d = await res.json()
    if (!res.ok) { onFlash(d.error ?? 'Failed.'); return false }
    load(); return true
  }

  return (
    <div className="space-y-3">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Look up a code (e.g. MNAP-7F4K2)…" className="input text-sm" />
      <div className="flex gap-1.5 flex-wrap">
        {([['', 'All'], ['active', 'Active'], ['redeemed', 'Redeemed'], ['expired', 'Expired'], ['issued', 'Not sent'], ['void', 'Void']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setState(k)}
            className={`text-xs px-2.5 py-1 rounded-lg border font-medium ${state === k ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'}`}>{l}</button>
        ))}
      </div>

      {loading ? <p className="text-sm text-gray-400 text-center py-6">Loading…</p>
        : coupons.length === 0 ? <p className="text-sm text-gray-400 text-center py-6">No coupons.</p>
          : coupons.map(c => {
            const s = couponState(c)
            return (
              <div key={c.id} className="card p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-gray-900">{c.code}</span>
                  <StatePill state={s} />
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <button onClick={() => onPeek(c.phone)} className="text-left min-w-0">
                    <span className="text-gray-800">{c.customer_name || 'Unknown'}</span>
                    <span className="text-gray-400"> · +91 {c.phone}</span>
                  </button>
                  {c.occasion && <span className="text-[10px] text-gray-400">{OCCASION_LABEL[c.occasion] ?? c.occasion}</span>}
                </div>
                <p className="text-xs text-gray-600">{c.offer ? offerLine(c.offer) : '—'}</p>
                <p className="text-[11px] text-gray-400">
                  {s === 'issued' ? 'Not sent yet'
                    : s === 'redeemed' ? `Redeemed ${fmtDate(c.redeemed_at)}${c.redeemed_bill_no ? ` · bill ${c.redeemed_bill_no}` : ''}`
                      : c.valid_until ? `Valid till ${fmtDate(c.valid_until)}` : ''}
                </p>
                <div className="flex gap-2 pt-1">
                  {s === 'issued' && (
                    <button onClick={async () => {
                      const res = await fetch('/api/coupons/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ couponIds: [c.id] }) })
                      const d = await res.json(); if (!res.ok) onFlash(d.error ?? 'Send failed.'); else { onFlash(d.sent ? 'Sent.' : `Skipped (${d.results?.[0]?.status ?? 'not sent'}).`); load() }
                    }} className="btn-primary text-xs px-3 py-1">Send</button>
                  )}
                  {s === 'sent' && (
                    <button onClick={() => setRedeem(c)} className="btn-primary text-xs px-3 py-1">Mark redeemed</button>
                  )}
                  {s === 'redeemed' && (
                    <button onClick={() => act(c.id, { action: 'unredeem' })} className="btn-secondary text-xs px-3 py-1">Undo redeem</button>
                  )}
                  {(s === 'issued' || s === 'sent' || s === 'expired') && (
                    <button onClick={() => { if (confirm('Void this coupon? It can no longer be redeemed.')) act(c.id, { action: 'void' }) }}
                      className="text-xs px-3 py-1 text-red-600 border border-red-200 rounded-lg">Void</button>
                  )}
                </div>
              </div>
            )
          })}

      {redeem && (
        <RedeemModal coupon={redeem} salesmen={salesmen} onClose={() => setRedeem(null)}
          onDone={(msg) => { setRedeem(null); onFlash(msg); load() }} />
      )}
    </div>
  )
}

function RedeemModal({ coupon, salesmen, onClose, onDone }: {
  coupon: WaCoupon; salesmen: Array<{ id: string; name: string; alias: string }>; onClose: () => void; onDone: (msg: string) => void
}) {
  const [salesmanId, setSalesmanId] = useState('')
  const [billNo, setBillNo] = useState('')
  const [busy, setBusy] = useState(false)
  async function confirm() {
    setBusy(true)
    const res = await fetch('/api/coupons', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: coupon.id, action: 'redeem', salesmanId: salesmanId || undefined, billNo: billNo.trim() || undefined }),
    })
    const d = await res.json(); setBusy(false)
    onDone(res.ok ? `${coupon.code} marked redeemed.` : (d.error ?? 'Failed.'))
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-t-2xl w-full max-w-2xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <p className="font-bold text-gray-900">Redeem <span className="font-mono">{coupon.code}</span></p>
        <p className="text-xs text-gray-500">{coupon.customer_name || 'Unknown'} · +91 {coupon.phone} · {coupon.offer ? offerLine(coupon.offer) : ''}</p>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Redeemed by (optional)</label>
          <select value={salesmanId} onChange={e => setSalesmanId(e.target.value)} className="input text-sm">
            <option value="">—</option>
            {salesmen.map(s => <option key={s.id} value={s.id}>{s.alias} · {s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Bill number (optional)</label>
          <input value={billNo} onChange={e => setBillNo(e.target.value)} className="input text-sm" placeholder="e.g. 1043" />
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={confirm} disabled={busy} className="btn-primary flex-1 disabled:opacity-50">{busy ? 'Saving…' : 'Confirm redeemed'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Offers CRUD ───────────────────────────────────────────────────────────────
const FORM_TYPES: Array<[string, string]> = [
  ['making_pct', '% off making charges'], ['free_gift', 'Free gift / silver coin'], ['custom', 'Custom (write your own)'],
]
function OffersTab({ offers, reload, onFlash }: { offers: WaCouponOffer[]; reload: () => void; onFlash: (s: string) => void }) {
  const [editing, setEditing] = useState<WaCouponOffer | null>(null)
  const [creating, setCreating] = useState(false)

  async function toggle(o: WaCouponOffer) {
    await fetch('/api/coupons/offers', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: o.id, is_active: !o.is_active }) })
    reload()
  }

  return (
    <div className="space-y-3">
      {!creating && !editing && (
        <button onClick={() => setCreating(true)} className="btn-primary w-full">+ New offer</button>
      )}
      {(creating || editing) && (
        <OfferForm offer={editing} onCancel={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); reload(); onFlash('Offer saved.') }} />
      )}
      {offers.length === 0 && !creating ? <p className="text-sm text-gray-400 text-center py-4">No offers yet.</p>
        : offers.map(o => (
          <div key={o.id} className={`card p-3 space-y-1 ${!o.is_active ? 'opacity-60' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-gray-900 text-sm">{o.name}</p>
              <span className="text-[10px] text-gray-400">{DISCOUNT_TYPE_LABEL[o.discount_type] ?? o.discount_type}</span>
            </div>
            <p className="text-sm text-gray-700">{offerLine(o)}</p>
            <p className="text-[11px] text-gray-400">
              {o.min_bill_amount ? `Min bill ₹${Math.round(o.min_bill_amount).toLocaleString('en-IN')} · ` : ''}
              {o.applies_to !== 'all' ? `${o.applies_to} · ` : ''}{o.terms || 'No extra terms'}
            </p>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditing(o)} className="btn-secondary text-xs px-3 py-1">Edit</button>
              <button onClick={() => toggle(o)} className="text-xs px-3 py-1 border border-gray-300 rounded-lg text-gray-600">
                {o.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        ))}
    </div>
  )
}

function OfferForm({ offer, onCancel, onSaved }: { offer: WaCouponOffer | null; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(offer?.name ?? '')
  const [discountType, setDiscountType] = useState(offer?.discount_type ?? 'making_pct')
  const [discountValue, setDiscountValue] = useState(offer?.discount_value != null ? String(offer.discount_value) : '')
  const [offerText, setOfferText] = useState(offer?.offer_text ?? '')
  const [offerTextTouched, setTouched] = useState(!!offer)
  const [minBill, setMinBill] = useState(offer?.min_bill_amount != null ? String(offer.min_bill_amount) : '')
  const [appliesTo, setAppliesTo] = useState(offer?.applies_to ?? 'all')
  const [terms, setTerms] = useState(offer?.terms ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // Auto-suggest the customer-facing line from type+value until the owner edits it.
  const suggested = discountType === 'making_pct' ? (discountValue ? `${discountValue}% off making charges` : '')
    : discountType === 'free_gift' ? 'Free silver coin on your purchase' : ''
  const effectiveText = offerTextTouched ? offerText : (offerText || suggested)

  async function save() {
    setErr('')
    if (!name.trim()) { setErr('Name is required.'); return }
    const finalText = (offerTextTouched ? offerText : (offerText || suggested)).trim()
    if (!finalText) { setErr('Write the customer-facing offer wording.'); return }
    setBusy(true)
    const body = {
      ...(offer ? { id: offer.id } : {}),
      name: name.trim(), discount_type: discountType,
      discount_value: discountType === 'making_pct' ? (discountValue || null) : null,
      offer_text: finalText, min_bill_amount: minBill || null, applies_to: appliesTo, terms: terms.trim() || null,
    }
    const res = await fetch('/api/coupons/offers', {
      method: offer ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const d = await res.json(); setBusy(false)
    if (!res.ok) { setErr(d.error ?? 'Save failed.'); return }
    onSaved()
  }

  return (
    <div className="card p-4 space-y-3">
      <p className="font-semibold text-gray-900">{offer ? 'Edit offer' : 'New offer'}</p>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Offer name (internal)</label>
        <input value={name} onChange={e => setName(e.target.value)} className="input text-sm" placeholder="e.g. Birthday 2026" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
        <select value={discountType} onChange={e => setDiscountType(e.target.value as WaCouponOffer['discount_type'])} className="input text-sm">
          {FORM_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {discountType === 'making_pct' && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Percent off making charges</label>
          <input value={discountValue} onChange={e => setDiscountValue(e.target.value)} inputMode="numeric" className="input text-sm" placeholder="e.g. 20" />
        </div>
      )}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Customer-facing wording (goes in the WhatsApp)</label>
        <input value={effectiveText} onChange={e => { setTouched(true); setOfferText(e.target.value) }} className="input text-sm" placeholder="e.g. 20% off making charges" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Min bill ₹ (optional)</label>
          <input value={minBill} onChange={e => setMinBill(e.target.value)} inputMode="numeric" className="input text-sm" placeholder="—" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Applies to</label>
          <select value={appliesTo} onChange={e => setAppliesTo(e.target.value)} className="input text-sm">
            {['all', 'gold', 'silver', 'diamond'].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Terms / fine print (optional)</label>
        <input value={terms} onChange={e => setTerms(e.target.value)} className="input text-sm" placeholder="e.g. Not clubbable with other offers" />
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex gap-2">
        <button onClick={onCancel} className="btn-secondary flex-1">Cancel</button>
        <button onClick={save} disabled={busy} className="btn-primary flex-1 disabled:opacity-50">{busy ? 'Saving…' : 'Save offer'}</button>
      </div>
    </div>
  )
}
