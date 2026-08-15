'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'
import { suggestName } from '@/lib/inventory-maps'

type ItemRow = { itm_id: number; sample_raw: string | null; n: number }
type ItemMap = { itm_id: number; clean_name: string; source: string; hits: number }
type PurityRow = { raw_key: string; raw_sample: string; n: number }
type PurityMap = { raw_key: string; clean: string; source: string }

const badge = (s: string) =>
  s === 'manual' ? 'bg-amber-100 text-amber-700'
  : s === 'learned' ? 'bg-blue-50 text-blue-600'
  : 'bg-gray-100 text-gray-500'

export default function MappingsPage() {
  const supabase = createClient()
  const router = useRouter()

  const [tab, setTab] = useState<'items' | 'purity'>('items')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [items, setItems] = useState<ItemRow[]>([])
  const [itemMap, setItemMap] = useState<Map<number, ItemMap>>(new Map())
  const [purities, setPurities] = useState<PurityRow[]>([])
  const [purityMap, setPurityMap] = useState<Map<string, PurityMap>>(new Map())
  const [candidates, setCandidates] = useState<string[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({}) // key → edited clean value

  async function load() {
    setLoading(true)
    const [it, im, pu, pm, cand] = await Promise.all([
      supabase.from('wa_inventory_items').select('*'),
      supabase.from('wa_item_name_map').select('*'),
      supabase.from('wa_inventory_purities').select('*'),
      supabase.from('wa_purity_map').select('*'),
      supabase.from('wa_catalogue_options').select('value').eq('field', 'item_name'),
    ])
    setItems(((it.data ?? []) as ItemRow[]).sort((a, b) => b.n - a.n))
    setItemMap(new Map(((im.data ?? []) as ItemMap[]).map(r => [r.itm_id, r])))
    setPurities(((pu.data ?? []) as PurityRow[]).sort((a, b) => b.n - a.n))
    setPurityMap(new Map(((pm.data ?? []) as PurityMap[]).map(r => [r.raw_key, r])))
    setCandidates(((cand.data ?? []) as Array<{ value: string }>).map(r => r.value).filter(Boolean))
    setDraft({})
    setLoading(false)
  }
  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  async function rebuild() {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/inventory/rebuild-name-map', { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Rebuild failed')
      setMsg(j.mapped > 0
        ? `Learned ${j.mapped} item names from ${j.matched} barcoded products (kept ${j.preservedManual} manual).`
        : (j.note || 'Nothing to learn yet.'))
      await load()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Rebuild failed') }
    finally { setBusy(false) }
  }

  async function saveItem(row: ItemRow, value: string) {
    const clean = value.trim(); if (!clean) return
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('wa_item_name_map').upsert({
      itm_id: row.itm_id, clean_name: clean, source: 'manual',
      sample_raw: row.sample_raw, hits: itemMap.get(row.itm_id)?.hits ?? 1,
      updated_by: user?.id ?? null, updated_at: new Date().toISOString(),
    }, { onConflict: 'itm_id' })
    if (error) { setMsg(error.message); return }
    setItemMap(prev => new Map(prev).set(row.itm_id, { itm_id: row.itm_id, clean_name: clean, source: 'manual', hits: itemMap.get(row.itm_id)?.hits ?? 1 }))
    setDraft(d => { const n = { ...d }; delete n[`i${row.itm_id}`]; return n })
  }

  async function savePurity(row: PurityRow, value: string) {
    const clean = value.trim(); if (!clean) return
    const { error } = await supabase.from('wa_purity_map').upsert({
      raw_key: row.raw_key, raw_sample: row.raw_sample, clean, source: 'manual',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'raw_key' })
    if (error) { setMsg(error.message); return }
    setPurityMap(prev => new Map(prev).set(row.raw_key, { raw_key: row.raw_key, clean, source: 'manual' }))
    setDraft(d => { const n = { ...d }; delete n[`p${row.raw_key}`]; return n })
  }

  const q = search.trim().toLowerCase()
  const shownItems = useMemo(() => !q ? items : items.filter(r =>
    (r.sample_raw ?? '').toLowerCase().includes(q) || (itemMap.get(r.itm_id)?.clean_name ?? '').toLowerCase().includes(q) || String(r.itm_id).includes(q)
  ), [items, itemMap, q])
  const shownPurities = useMemo(() => !q ? purities : purities.filter(r =>
    r.raw_sample.toLowerCase().includes(q) || (purityMap.get(r.raw_key)?.clean ?? '').toLowerCase().includes(q)
  ), [purities, purityMap, q])

  const mappedItems = items.filter(r => itemMap.has(r.itm_id)).length
  const mappedPur = purities.filter(r => purityMap.has(r.raw_key)).length

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-3 pb-24">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">←</button>
          <h1 className="text-lg font-bold text-gray-900">Name &amp; purity mapping</h1>
        </div>
        <p className="text-xs text-gray-400">
          Maps the software&apos;s messy item names &amp; purities to the clean values shown in the app.
          Only the clean value is fed to customers. Edit any row to fix or teach a mapping.
        </p>

        {/* Tabs */}
        <div className="flex gap-2">
          <button onClick={() => setTab('items')} className={`flex-1 py-2 rounded-lg text-sm font-medium ${tab === 'items' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
            Item names <span className="opacity-60">({mappedItems}/{items.length})</span>
          </button>
          <button onClick={() => setTab('purity')} className={`flex-1 py-2 rounded-lg text-sm font-medium ${tab === 'purity' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
            Purity <span className="opacity-60">({mappedPur}/{purities.length})</span>
          </button>
        </div>

        {msg && <div className="card p-2.5 text-xs text-gray-700 bg-blue-50">{msg}</div>}

        {tab === 'items' && (
          <button onClick={rebuild} disabled={busy}
            className="w-full py-2 rounded-lg bg-green-600 text-white text-sm font-medium disabled:opacity-40">
            {busy ? 'Learning…' : '↻ Rebuild from barcoded products (majority vote)'}
          </button>
        )}

        <input type="search" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} className="input" />

        {loading ? (
          <div className="flex justify-center pt-10"><div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : tab === 'items' ? (
          <div className="space-y-1.5">
            {shownItems.map(row => {
              const cur = itemMap.get(row.itm_id)
              const key = `i${row.itm_id}`
              const val = draft[key] ?? cur?.clean_name ?? ''
              const changed = val.trim() !== (cur?.clean_name ?? '')
              const sug = !cur && row.sample_raw ? suggestName(row.sample_raw, candidates) : null
              return (
                <div key={row.itm_id} className="card p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700 truncate flex-1">{row.sample_raw || <em className="text-gray-400">— no name —</em>}</span>
                    <span className="text-[11px] text-gray-400">×{row.n}</span>
                    {cur && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${badge(cur.source)}`}>{cur.source}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-300 text-xs">→</span>
                    <input value={val} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                      placeholder="clean name for the app" className="input flex-1 !py-1.5 text-sm" />
                    <button onClick={() => saveItem(row, val)} disabled={!changed}
                      className="text-xs font-medium text-green-700 disabled:text-gray-300 px-2">Save</button>
                  </div>
                  {sug && (
                    <button onClick={() => setDraft(d => ({ ...d, [key]: sug.name }))}
                      className="text-[11px] text-blue-600">Suggest: {sug.name} <span className="text-gray-400">({Math.round(sug.score * 100)}%)</span></button>
                  )}
                </div>
              )
            })}
            {shownItems.length === 0 && <div className="card p-6 text-center text-gray-400 text-sm">Nothing here. Import an inventory file first.</div>}
          </div>
        ) : (
          <div className="space-y-1.5">
            {shownPurities.map(row => {
              const cur = purityMap.get(row.raw_key)
              const key = `p${row.raw_key}`
              const val = draft[key] ?? cur?.clean ?? ''
              const changed = val.trim() !== (cur?.clean ?? '')
              return (
                <div key={row.raw_key} className="card p-3 flex items-center gap-2">
                  <span className="text-sm text-gray-700 truncate w-28 shrink-0">{row.raw_sample}</span>
                  <span className="text-[11px] text-gray-400">×{row.n}</span>
                  <span className="text-gray-300 text-xs">→</span>
                  <input value={val} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                    placeholder="clean" className="input flex-1 !py-1.5 text-sm" />
                  {cur && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${badge(cur.source)}`}>{cur.source}</span>}
                  <button onClick={() => savePurity(row, val)} disabled={!changed}
                    className="text-xs font-medium text-green-700 disabled:text-gray-300 px-1">Save</button>
                </div>
              )
            })}
            {shownPurities.length === 0 && <div className="card p-6 text-center text-gray-400 text-sm">Nothing here. Import an inventory file first.</div>}
          </div>
        )}
      </main>
    </div>
  )
}
