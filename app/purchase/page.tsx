'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchCatalogueOptions, addCatalogueOptions, type Options } from '@/lib/catalogue'
import Navbar from '@/components/ui/Navbar'
import type { WaPurchaseRequirement, WaPurchaseLine } from '@/lib/types'

type Tab = 'buy' | 'parties'
type Filter = 'open' | 'done' | 'all'

export default function PurchasePage() {
  const supabase = createClient()

  const [rows, setRows]       = useState<WaPurchaseRequirement[]>([])
  const [lines, setLines]     = useState<WaPurchaseLine[]>([])
  const [options, setOptions] = useState<Options>({ item_name: [], design: [], description: [], purity: [], party: [] })
  const [loading, setLoading] = useState(true)

  const [tab, setTab]         = useState<Tab>('buy')
  const [filter, setFilter]   = useState<Filter>('open')
  const [party, setParty]     = useState('')   // active buying session

  const [adding, setAdding]   = useState(false)
  const [draft, setDraft]     = useState({ item_name: '', design: '', description: '', purity: '22K', weight_bucket: '', qty_needed: '1', notes: '' })
  const [busy, setBusy]       = useState(false)

  async function reload() {
    const [reqRes, lineRes] = await Promise.all([
      supabase.from('wa_purchase_requirements').select('*').order('created_at', { ascending: false }),
      supabase.from('wa_purchase_lines').select('*'),
    ])
    setRows((reqRes.data ?? []) as WaPurchaseRequirement[])
    setLines((lineRes.data ?? []) as WaPurchaseLine[])
    setLoading(false)
  }
  useEffect(() => { reload(); fetchCatalogueOptions().then(setOptions) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  // requirement_id -> total purchased across all parties
  const purchasedTotal = useMemo(() => {
    const m: Record<string, number> = {}
    for (const l of lines) m[l.requirement_id] = (m[l.requirement_id] ?? 0) + l.qty
    return m
  }, [lines])

  // qty bought from the active party, per requirement
  const partyQty = useMemo(() => {
    const m: Record<string, number> = {}
    for (const l of lines) if (l.party === party) m[l.requirement_id] = l.qty
    return m
  }, [lines, party])

  const visible = useMemo(() => {
    if (filter === 'open') return rows.filter(r => (purchasedTotal[r.id] ?? 0) < r.qty_needed)
    if (filter === 'done') return rows.filter(r => (purchasedTotal[r.id] ?? 0) >= r.qty_needed)
    return rows
  }, [rows, filter, purchasedTotal])

  const totals = useMemo(() => {
    const needed = rows.reduce((s, r) => s + r.qty_needed, 0)
    const bought = rows.reduce((s, r) => s + Math.min(purchasedTotal[r.id] ?? 0, r.qty_needed), 0)
    return { needed, bought }
  }, [rows, purchasedTotal])

  // Per-party summary: pieces + approx weight (qty * requirement bucket)
  const parties = useMemo(() => {
    const bucketOf: Record<string, number | null> = {}
    for (const r of rows) bucketOf[r.id] = r.weight_bucket
    const m: Record<string, { qty: number; weight: number }> = {}
    for (const l of lines) {
      if (l.qty <= 0) continue
      const e = (m[l.party] ??= { qty: 0, weight: 0 })
      e.qty += l.qty
      const b = bucketOf[l.requirement_id]
      if (b) e.weight += l.qty * b
    }
    return Object.entries(m).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.qty - a.qty)
  }, [rows, lines])

  function setD(k: keyof typeof draft, v: string) { setDraft(d => ({ ...d, [k]: v })) }

  async function addRow() {
    if (!draft.item_name.trim() && !draft.design.trim() && !draft.description.trim()) return
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('wa_purchase_requirements').insert({
      item_name:     draft.item_name.trim()   || null,
      design:        draft.design.trim()      || null,
      description:   draft.description.trim()  || null,
      purity:        draft.purity.trim()       || null,
      weight_bucket: draft.weight_bucket ? Math.max(1, parseInt(draft.weight_bucket, 10)) : null,
      qty_needed:    Math.max(1, parseInt(draft.qty_needed || '1', 10)),
      notes:         draft.notes.trim()        || null,
      created_by:    user?.id ?? null,
    })
    await addCatalogueOptions([
      { field: 'item_name', value: draft.item_name }, { field: 'design', value: draft.design },
      { field: 'description', value: draft.description }, { field: 'purity', value: draft.purity },
    ])
    setDraft({ item_name: '', design: '', description: '', purity: '22K', weight_bucket: '', qty_needed: '1', notes: '' })
    setAdding(false)
    await reload(); fetchCatalogueOptions().then(setOptions)
    setBusy(false)
  }

  // Adjust the active party's line for a requirement by +1 / -1
  async function adjust(r: WaPurchaseRequirement, delta: number) {
    if (!party.trim()) return
    const existing = lines.find(l => l.requirement_id === r.id && l.party === party)
    const nextQty = Math.max(0, (existing?.qty ?? 0) + delta)

    // optimistic update
    setLines(prev => {
      if (existing) return prev.map(l => l.id === existing.id ? { ...l, qty: nextQty } : l)
      if (nextQty === 0) return prev
      return [...prev, { id: `tmp-${r.id}-${party}`, requirement_id: r.id, party, qty: nextQty, created_at: '', updated_at: '' }]
    })

    if (existing) {
      await supabase.from('wa_purchase_lines').update({ qty: nextQty, updated_at: new Date().toISOString() }).eq('id', existing.id)
    } else if (nextQty > 0) {
      await supabase.from('wa_purchase_lines').insert({ requirement_id: r.id, party, qty: nextQty })
      // register the party for future dropdowns
      await addCatalogueOptions([{ field: 'party', value: party }])
      // replace the optimistic temp row with the real one (gets its DB id)
      const { data: fresh } = await supabase.from('wa_purchase_lines').select('*')
      if (fresh) setLines(fresh as WaPurchaseLine[])
    }
    // keep the cached total/flag on the requirement in sync
    const total = lines.filter(l => l.requirement_id === r.id && l.party !== party).reduce((s, l) => s + l.qty, 0) + nextQty
    await supabase.from('wa_purchase_requirements')
      .update({ qty_purchased: total, is_done: total >= r.qty_needed, updated_at: new Date().toISOString() })
      .eq('id', r.id)
    setRows(prev => prev.map(x => x.id === r.id ? { ...x, qty_purchased: total, is_done: total >= r.qty_needed } : x))
  }

  async function remove(r: WaPurchaseRequirement) {
    if (!confirm('Remove this requirement?')) return
    setRows(prev => prev.filter(x => x.id !== r.id))
    setLines(prev => prev.filter(l => l.requirement_id !== r.id))
    await supabase.from('wa_purchase_requirements').delete().eq('id', r.id)  // lines cascade
  }

  const titleOf = (r: WaPurchaseRequirement) =>
    [r.item_name, r.design, r.description].filter(Boolean).join(' · ') || 'Untitled'
  const subOf = (r: WaPurchaseRequirement) =>
    [r.purity || 'Any purity', r.weight_bucket ? `~${r.weight_bucket} g` : null, r.notes].filter(Boolean).join(' · ')

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-3 pb-24">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Purchase list</h1>
          <button onClick={() => setAdding(a => !a)} className="text-xs font-semibold bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg">
            {adding ? 'Close' : '+ Add'}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {([['buy', 'Buying'], ['parties', 'By party']] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                tab === t ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300'
              }`}>{label}</button>
          ))}
        </div>

        {/* Add form */}
        {adding && (
          <div className="card p-4 space-y-2.5">
            <Field label="Item name"><input list="po-item_name" value={draft.item_name} onChange={e => setD('item_name', e.target.value)} className="input" placeholder="Pick or type" /></Field>
            <Field label="Design"><input list="po-design" value={draft.design} onChange={e => setD('design', e.target.value)} className="input" placeholder="Pick or type" /></Field>
            <Field label="Description"><input list="po-description" value={draft.description} onChange={e => setD('description', e.target.value)} className="input" placeholder="Pick or type" /></Field>
            <div className="flex gap-3">
              <Field label="Purity" className="flex-1"><input list="po-purity" value={draft.purity} onChange={e => setD('purity', e.target.value)} className="input" placeholder="22K" /></Field>
              <Field label="Weight bucket (g)" className="flex-1"><input type="number" inputMode="numeric" min={1} step={1} value={draft.weight_bucket} onChange={e => setD('weight_bucket', e.target.value)} className="input" placeholder="e.g. 5" /></Field>
              <Field label="Qty" className="w-20"><input type="number" inputMode="numeric" min={1} value={draft.qty_needed} onChange={e => setD('qty_needed', e.target.value)} className="input" /></Field>
            </div>
            <Field label="Notes"><input value={draft.notes} onChange={e => setD('notes', e.target.value)} className="input" placeholder="Optional" /></Field>

            <datalist id="po-item_name">{options.item_name.map(o => <option key={o} value={o} />)}</datalist>
            <datalist id="po-design">{options.design.map(o => <option key={o} value={o} />)}</datalist>
            <datalist id="po-description">{options.description.map(o => <option key={o} value={o} />)}</datalist>
            <datalist id="po-purity">{options.purity.map(o => <option key={o} value={o} />)}</datalist>

            <button onClick={addRow} disabled={busy} className="btn-primary w-full disabled:opacity-60">{busy ? 'Adding…' : 'Add to list'}</button>
          </div>
        )}

        {/* ───────── BUYING TAB ───────── */}
        {tab === 'buy' && (
          <>
            {/* Party session selector */}
            <div className="card p-3 space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Buying from (party)</label>
              <input list="po-party" value={party} onChange={e => setParty(e.target.value)} className="input"
                placeholder="Select or type the party you're visiting" />
              <datalist id="po-party">{options.party.map(o => <option key={o} value={o} />)}</datalist>
              <p className="text-[11px] text-gray-400">
                {party.trim() ? <>Recording purchases from <span className="font-semibold text-gray-600">{party}</span>. The +/− below counts pieces bought here.</> : 'Pick a party first to start marking what you buy.'}
              </p>
            </div>

            {/* Progress */}
            {!loading && rows.length > 0 && (
              <div className="card p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Purchased (all parties)</span>
                  <span className="font-bold text-gray-900">{totals.bought} <span className="text-gray-400 font-medium">/ {totals.needed}</span></span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-green-600 rounded-full transition-all" style={{ width: `${totals.needed ? (totals.bought / totals.needed) * 100 : 0}%` }} />
                </div>
              </div>
            )}

            <div className="flex gap-2">
              {([['open', 'To buy'], ['done', 'Done'], ['all', 'All']] as const).map(([f, label]) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                    filter === f ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'
                  }`}>{label}</button>
              ))}
            </div>

            {loading ? (
              <div className="flex justify-center pt-10"><div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
            ) : visible.length === 0 ? (
              <div className="card p-8 text-center text-gray-400 text-sm">
                {filter === 'open' ? 'Nothing left to buy.' : filter === 'done' ? 'Nothing completed yet.' : 'No requirements yet. Tap “+ Add”.'}
              </div>
            ) : (
              <div className="space-y-1.5">
                {visible.map(r => {
                  const total = purchasedTotal[r.id] ?? 0
                  const here = partyQty[r.id] ?? 0
                  const fromOthers = total - here
                  const done = total >= r.qty_needed && r.qty_needed > 0
                  const remaining = Math.max(0, r.qty_needed - total)
                  return (
                    <div key={r.id} className={`card p-3 ${done ? 'bg-green-50 border-green-200' : ''}`}>
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 text-sm truncate">{titleOf(r)}</p>
                          <p className="text-[11px] text-amber-700 truncate">{subOf(r)}</p>
                        </div>
                        <button onClick={() => remove(r)} className="text-gray-300 hover:text-red-500 px-1 -mt-0.5">×</button>
                      </div>

                      <div className="flex items-center justify-between mt-2.5">
                        <span className={`text-xs font-medium ${done ? 'text-green-700' : 'text-gray-500'}`}>
                          {done ? '✓ Complete' : `${remaining} left · ${total}/${r.qty_needed}`}
                          {fromOthers > 0 && <span className="text-gray-400"> · {fromOthers} elsewhere</span>}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => adjust(r, -1)} disabled={!party.trim() || here <= 0}
                            className="w-8 h-8 rounded-lg border border-gray-300 text-gray-700 font-bold text-lg leading-none disabled:opacity-40">−</button>
                          <span className="w-8 text-center font-bold text-gray-900">{here}</span>
                          <button onClick={() => adjust(r, +1)} disabled={!party.trim()}
                            className="w-8 h-8 rounded-lg bg-green-600 text-white font-bold text-lg leading-none disabled:opacity-40">+</button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ───────── BY PARTY TAB ───────── */}
        {tab === 'parties' && (
          loading ? (
            <div className="flex justify-center pt-10"><div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : parties.length === 0 ? (
            <div className="card p-8 text-center text-gray-400 text-sm">No purchases recorded yet.</div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-gray-400">Approximate weight = pieces bought × each item’s weight bucket. A rough helper — the catalogue is the real in-stock count.</p>
              {parties.map(p => (
                <div key={p.name} className="card p-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{p.name}</p>
                    <p className="text-[11px] text-gray-400">{p.qty} piece{p.qty !== 1 ? 's' : ''}</p>
                  </div>
                  <span className="text-sm font-bold text-amber-700">{p.weight > 0 ? `~${p.weight} g` : '—'}</span>
                </div>
              ))}
            </div>
          )
        )}
      </main>
    </div>
  )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="text-xs font-medium text-gray-600">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  )
}
