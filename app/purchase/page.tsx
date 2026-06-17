'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchCatalogueOptions, addCatalogueOptions, type Options } from '@/lib/catalogue'
import Navbar from '@/components/ui/Navbar'
import type { WaProduct, WaPurchaseRequirement, WaPurchaseLine } from '@/lib/types'

type Mode = 'plan' | 'buy' | 'parties'

const norm = (s: string | null | undefined) => (s ?? '').trim()
const lineKeyOf = (i: string | null, d: string | null, de: string | null, p: string | null) =>
  [norm(i), norm(d), norm(de), norm(p)].join('')
const bLabel = (b: number) => (b > 0 ? `${b}g` : '—')

interface Cell { bucket: number; stock: number; reqId: string | null; need: number }
interface DLine { key: string; item_name: string | null; design: string | null; description: string | null; purity: string | null; cells: Cell[] }

export default function PurchasePage() {
  const supabase = createClient()

  const [products, setProducts]         = useState<WaProduct[]>([])
  const [requirements, setRequirements] = useState<WaPurchaseRequirement[]>([])
  const [lines, setLines]               = useState<WaPurchaseLine[]>([])
  const [options, setOptions]           = useState<Options>({ item_name: [], design: [], description: [], purity: [], party: [] })
  const [extras, setExtras]             = useState<Record<string, Set<number>>>({}) // locally-added buckets, before a Need is typed
  const [loading, setLoading]           = useState(true)

  const [mode, setMode]       = useState<Mode>('plan')
  const [itemFilter, setItem] = useState('')   // '' = all items
  const [party, setParty]     = useState('')   // active buying session
  const [adding, setAdding]   = useState(false)
  const [draft, setDraft]     = useState({ item_name: '', design: '', description: '', purity: '22K', weight_bucket: '', qty_needed: '1' })

  async function reload() {
    const [prodRes, reqRes, lineRes] = await Promise.all([
      supabase.from('wa_products').select('item_name, design, description, purity, weight').eq('is_active', true).eq('is_sold', false),
      supabase.from('wa_purchase_requirements').select('*'),
      supabase.from('wa_purchase_lines').select('*'),
    ])
    setProducts((prodRes.data ?? []) as WaProduct[])
    setRequirements((reqRes.data ?? []) as WaPurchaseRequirement[])
    setLines((lineRes.data ?? []) as WaPurchaseLine[])
    setLoading(false)
  }
  useEffect(() => { reload(); fetchCatalogueOptions().then(setOptions) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  // Build the grid: design-lines from catalogue ∪ requirements, with stock/need per weight bucket
  const grid = useMemo<DLine[]>(() => {
    interface Acc { item: string | null; design: string | null; description: string | null; purity: string | null; cells: Map<number, Cell> }
    const map = new Map<string, Acc>()
    const ensure = (i: string | null, d: string | null, de: string | null, p: string | null) => {
      const k = lineKeyOf(i, d, de, p)
      let a = map.get(k)
      if (!a) { a = { item: i, design: d, description: de, purity: p, cells: new Map() }; map.set(k, a) }
      return { k, a }
    }
    for (const pr of products) {
      if (pr.weight == null) continue
      const b = Math.round(pr.weight)
      const { a } = ensure(pr.item_name, pr.design, pr.description, pr.purity)
      const c = a.cells.get(b) ?? { bucket: b, stock: 0, reqId: null, need: 0 }
      c.stock++; a.cells.set(b, c)
    }
    for (const r of requirements) {
      const b = r.weight_bucket ?? 0
      const { a } = ensure(r.item_name, r.design, r.description, r.purity)
      const c = a.cells.get(b) ?? { bucket: b, stock: 0, reqId: null, need: 0 }
      c.reqId = r.id; c.need = r.qty_needed; a.cells.set(b, c)
    }
    for (const [lk, set] of Object.entries(extras)) {
      const a = map.get(lk)
      if (!a) continue
      for (const b of set) if (!a.cells.get(b)) a.cells.set(b, { bucket: b, stock: 0, reqId: null, need: 0 })
    }
    const arr: DLine[] = [...map.entries()].map(([k, a]) => ({
      key: k, item_name: a.item, design: a.design, description: a.description, purity: a.purity,
      cells: [...a.cells.values()].sort((x, y) => x.bucket - y.bucket),
    }))
    arr.sort((x, y) => (norm(x.item_name) || '~').localeCompare(norm(y.item_name) || '~') || norm(x.design).localeCompare(norm(y.design)))
    return arr
  }, [products, requirements, extras])

  const items = useMemo(() => {
    const s = new Set<string>()
    for (const l of grid) if (norm(l.item_name)) s.add(norm(l.item_name))
    return [...s].sort()
  }, [grid])

  const filteredGrid = useMemo(
    () => (itemFilter ? grid.filter(l => norm(l.item_name) === itemFilter) : grid),
    [grid, itemFilter]
  )

  const boughtTotal = useMemo(() => {
    const m: Record<string, number> = {}
    for (const l of lines) m[l.requirement_id] = (m[l.requirement_id] ?? 0) + l.qty
    return m
  }, [lines])
  const boughtHere = useMemo(() => {
    const m: Record<string, number> = {}
    for (const l of lines) if (l.party === party) m[l.requirement_id] = l.qty
    return m
  }, [lines, party])

  // progress over the current item filter
  const totals = useMemo(() => {
    let needed = 0, bought = 0
    for (const l of filteredGrid) for (const c of l.cells) {
      if (c.need <= 0) continue
      needed += c.need
      bought += Math.min(c.reqId ? (boughtTotal[c.reqId] ?? 0) : 0, c.need)
    }
    return { needed, bought }
  }, [filteredGrid, boughtTotal])

  // Per-party summary: pieces + approx weight (qty * bucket)
  const parties = useMemo(() => {
    const bucketOf: Record<string, number | null> = {}
    for (const r of requirements) bucketOf[r.id] = r.weight_bucket
    const m: Record<string, { qty: number; weight: number }> = {}
    for (const l of lines) {
      if (l.qty <= 0) continue
      const e = (m[l.party] ??= { qty: 0, weight: 0 })
      e.qty += l.qty
      const b = bucketOf[l.requirement_id]
      if (b) e.weight += l.qty * b
    }
    return Object.entries(m).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.qty - a.qty)
  }, [requirements, lines])

  const titleOf = (l: DLine) => [l.item_name, l.design, l.description].filter(Boolean).join(' · ') || 'Untitled'

  // ── Mutations ──────────────────────────────────────────────────────────────
  async function commitNeed(l: DLine, c: Cell, raw: string) {
    const n = Math.max(0, parseInt(raw || '0', 10) || 0)
    if (c.reqId) {
      if (n === c.need) return
      await supabase.from('wa_purchase_requirements').update({ qty_needed: n, updated_at: new Date().toISOString() }).eq('id', c.reqId)
    } else if (n > 0) {
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('wa_purchase_requirements').insert({
        item_name: l.item_name, design: l.design, description: l.description, purity: l.purity,
        weight_bucket: c.bucket || null, qty_needed: n, created_by: user?.id ?? null,
      })
    } else return
    await reload()
  }

  function addBucket(l: DLine, raw: string) {
    const g = Math.max(1, parseInt(raw, 10) || 0)
    if (!g) return
    setExtras(prev => {
      const set = new Set(prev[l.key] ?? [])
      set.add(g)
      return { ...prev, [l.key]: set }
    })
  }

  async function adjust(c: Cell, delta: number) {
    if (!party.trim() || !c.reqId) return
    const reqId = c.reqId
    const existing = lines.find(x => x.requirement_id === reqId && x.party === party)
    const nextQty = Math.max(0, (existing?.qty ?? 0) + delta)
    setLines(prev => {
      if (existing) return prev.map(x => x.id === existing.id ? { ...x, qty: nextQty } : x)
      if (nextQty === 0) return prev
      return [...prev, { id: `tmp-${reqId}-${party}`, requirement_id: reqId, party, qty: nextQty, created_at: '', updated_at: '' }]
    })
    if (existing) {
      await supabase.from('wa_purchase_lines').update({ qty: nextQty, updated_at: new Date().toISOString() }).eq('id', existing.id)
    } else if (nextQty > 0) {
      await supabase.from('wa_purchase_lines').insert({ requirement_id: reqId, party, qty: nextQty })
      await addCatalogueOptions([{ field: 'party', value: party }])
      const { data: fresh } = await supabase.from('wa_purchase_lines').select('*')
      if (fresh) setLines(fresh as WaPurchaseLine[])
      fetchCatalogueOptions().then(setOptions)
    }
  }

  async function addLine() {
    if (!draft.item_name.trim() && !draft.design.trim() && !draft.description.trim()) return
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('wa_purchase_requirements').insert({
      item_name: draft.item_name.trim() || null, design: draft.design.trim() || null,
      description: draft.description.trim() || null, purity: draft.purity.trim() || null,
      weight_bucket: draft.weight_bucket ? Math.max(1, parseInt(draft.weight_bucket, 10)) : null,
      qty_needed: Math.max(0, parseInt(draft.qty_needed || '0', 10)), created_by: user?.id ?? null,
    })
    await addCatalogueOptions([
      { field: 'item_name', value: draft.item_name }, { field: 'design', value: draft.design },
      { field: 'description', value: draft.description }, { field: 'purity', value: draft.purity },
    ])
    setDraft({ item_name: '', design: '', description: '', purity: '22K', weight_bucket: '', qty_needed: '1' })
    setAdding(false)
    await reload(); fetchCatalogueOptions().then(setOptions)
  }

  async function startNewRound() {
    if (!confirm('Start a new buying round? This clears all “bought” counts but keeps your plan (Need values).')) return
    await supabase.from('wa_purchase_lines').delete().not('id', 'is', null)
    await reload()
  }

  function cellStatus(need: number, bought: number): 'none' | 'under' | 'met' | 'over' {
    if (need <= 0) return bought > 0 ? 'over' : 'none'
    if (bought < need) return 'under'
    if (bought === need) return 'met'
    return 'over'
  }
  const STATUS_BG: Record<string, string> = {
    none: 'bg-white border-gray-200', under: 'bg-amber-50 border-amber-300',
    met: 'bg-green-50 border-green-300', over: 'bg-red-50 border-red-300',
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-3 pb-24">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Purchase plan</h1>
          {mode === 'plan' && (
            <button onClick={() => setAdding(a => !a)} className="text-xs font-semibold bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg">
              {adding ? 'Close' : '+ Add line'}
            </button>
          )}
          {mode === 'buy' && (
            <button onClick={startNewRound} className="text-xs font-medium text-gray-600 border border-gray-300 px-3 py-1.5 rounded-lg active:bg-gray-50">
              New round
            </button>
          )}
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2">
          {([['plan', 'Plan'], ['buy', 'Buy'], ['parties', 'By party']] as const).map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                mode === m ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300'
              }`}>{label}</button>
          ))}
        </div>

        {/* Add-line form (not-yet-stocked items) */}
        {mode === 'plan' && adding && (
          <div className="card p-4 space-y-2.5">
            <p className="text-xs text-gray-500">Add a line for something you don’t stock yet. Items you already have appear automatically.</p>
            <Field label="Item name"><input list="po-item_name" value={draft.item_name} onChange={e => setDraft(d => ({ ...d, item_name: e.target.value }))} className="input" placeholder="Pick or type" /></Field>
            <Field label="Design"><input list="po-design" value={draft.design} onChange={e => setDraft(d => ({ ...d, design: e.target.value }))} className="input" placeholder="Pick or type" /></Field>
            <Field label="Description"><input list="po-description" value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} className="input" placeholder="Pick or type" /></Field>
            <div className="flex gap-3">
              <Field label="Purity" className="flex-1"><input list="po-purity" value={draft.purity} onChange={e => setDraft(d => ({ ...d, purity: e.target.value }))} className="input" placeholder="22K" /></Field>
              <Field label="Weight (g)" className="flex-1"><input type="number" min={1} value={draft.weight_bucket} onChange={e => setDraft(d => ({ ...d, weight_bucket: e.target.value }))} className="input" placeholder="e.g. 5" /></Field>
              <Field label="Need" className="w-20"><input type="number" min={0} value={draft.qty_needed} onChange={e => setDraft(d => ({ ...d, qty_needed: e.target.value }))} className="input" /></Field>
            </div>
            <button onClick={addLine} className="btn-primary w-full">Add line</button>
          </div>
        )}

        <datalist id="po-item_name">{options.item_name.map(o => <option key={o} value={o} />)}</datalist>
        <datalist id="po-design">{options.design.map(o => <option key={o} value={o} />)}</datalist>
        <datalist id="po-description">{options.description.map(o => <option key={o} value={o} />)}</datalist>
        <datalist id="po-purity">{options.purity.map(o => <option key={o} value={o} />)}</datalist>

        {/* Item filter */}
        {items.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            <button onClick={() => setItem('')} className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border ${itemFilter === '' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'}`}>All items</button>
            {items.map(it => (
              <button key={it} onClick={() => setItem(it)} className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border ${itemFilter === it ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'}`}>{it}</button>
            ))}
          </div>
        )}

        {/* Buy-mode party + progress */}
        {mode === 'buy' && (
          <>
            <div className="card p-3 space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Buying from (party)</label>
              <input list="po-party" value={party} onChange={e => setParty(e.target.value)} className="input" placeholder="Select or type the party you're visiting" />
              <datalist id="po-party">{options.party.map(o => <option key={o} value={o} />)}</datalist>
              <p className="text-[11px] text-gray-400">
                {party.trim() ? <>Recording from <span className="font-semibold text-gray-600">{party}</span>. +/− counts pieces bought here.</> : 'Pick a party to start marking what you buy.'}
              </p>
            </div>
            {totals.needed > 0 && (
              <div className="card p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Bought{itemFilter ? ` · ${itemFilter}` : ''}</span>
                  <span className="font-bold text-gray-900">{totals.bought} <span className="text-gray-400 font-medium">/ {totals.needed}</span></span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-green-600 rounded-full transition-all" style={{ width: `${totals.needed ? (totals.bought / totals.needed) * 100 : 0}%` }} />
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 text-[11px] text-gray-500 px-1">
              <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-amber-200 inline-block" />Under</span>
              <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-green-300 inline-block" />Met</span>
              <span className="flex items-center gap-1"><i className="w-3 h-3 rounded bg-red-300 inline-block" />Excess</span>
            </div>
          </>
        )}

        {/* ───────── PARTIES ───────── */}
        {mode === 'parties' ? (
          loading ? <Spinner /> : parties.length === 0 ? (
            <div className="card p-8 text-center text-gray-400 text-sm">No purchases recorded yet.</div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-gray-400">Approx weight = pieces × each line’s weight bucket. A rough helper — the catalogue is the real in-stock count.</p>
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
        ) : loading ? <Spinner /> : filteredGrid.length === 0 ? (
          <div className="card p-8 text-center text-gray-400 text-sm">
            No products yet. Add pieces in the Catalogue, or “+ Add line” for items you plan to stock.
          </div>
        ) : (
          /* ───────── PLAN / BUY GRID ───────── */
          <div className="space-y-2">
            {filteredGrid.map(l => {
              const buyCells = l.cells.filter(c => c.need > 0 || (c.reqId ? (boughtTotal[c.reqId] ?? 0) : 0) > 0)
              if (mode === 'buy' && buyCells.length === 0) return null
              const cells = mode === 'buy' ? buyCells : l.cells
              return (
                <div key={l.key} className="card p-3">
                  <p className="font-semibold text-gray-900 text-sm truncate">{titleOf(l)}</p>
                  <p className="text-[11px] text-amber-700 mb-2">{l.purity || 'Any purity'}</p>

                  <div className="space-y-1.5">
                    {cells.map(c => {
                      const total = c.reqId ? (boughtTotal[c.reqId] ?? 0) : 0
                      const here = c.reqId ? (boughtHere[c.reqId] ?? 0) : 0
                      const st = cellStatus(c.need, total)
                      if (mode === 'plan') {
                        return (
                          <div key={c.bucket} className="flex items-center gap-2">
                            <span className="w-10 text-sm font-semibold text-gray-700">{bLabel(c.bucket)}</span>
                            <span className="flex-1 text-[11px] text-gray-400">in stock {c.stock}</span>
                            <span className="text-[11px] text-gray-500">Need</span>
                            <input type="number" min={0} defaultValue={c.need || ''} key={`${c.reqId ?? 'new'}-${c.need}`}
                              onBlur={e => commitNeed(l, c, e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                              className="input w-16 !py-1.5 text-sm text-center" placeholder="0" />
                          </div>
                        )
                      }
                      return (
                        <div key={c.bucket} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${STATUS_BG[st]}`}>
                          <span className="w-10 text-sm font-semibold text-gray-800">{bLabel(c.bucket)}</span>
                          <span className="flex-1 text-[11px] text-gray-500">stock {c.stock} · need {c.need} · got {total}</span>
                          <button onClick={() => adjust(c, -1)} disabled={!party.trim() || here <= 0}
                            className="w-7 h-7 rounded-lg border border-gray-300 bg-white text-gray-700 font-bold leading-none disabled:opacity-40">−</button>
                          <span className="w-6 text-center font-bold text-gray-900 text-sm">{here}</span>
                          <button onClick={() => adjust(c, +1)} disabled={!party.trim()}
                            className="w-7 h-7 rounded-lg bg-green-600 text-white font-bold leading-none disabled:opacity-40">+</button>
                        </div>
                      )
                    })}
                  </div>

                  {mode === 'plan' && (
                    <AddBucket onAdd={g => addBucket(l, g)} />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}

function AddBucket({ onAdd }: { onAdd: (g: string) => void }) {
  const [v, setV] = useState('')
  return (
    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100">
      <input type="number" min={1} value={v} onChange={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && v) { onAdd(v); setV('') } }}
        className="input w-20 !py-1.5 text-sm" placeholder="+ wt (g)" />
      <button onClick={() => { if (v) { onAdd(v); setV('') } }} disabled={!v}
        className="text-xs font-medium text-green-600 disabled:opacity-40">Add weight</button>
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

function Spinner() {
  return <div className="flex justify-center pt-10"><div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
}
