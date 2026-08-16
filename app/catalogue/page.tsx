'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { fetchCatalogueOptions, type Options } from '@/lib/catalogue'
import Navbar from '@/components/ui/Navbar'
import PreviewModal from '@/components/catalogue/PreviewModal'
import type { WaProduct } from '@/lib/types'

type Status = 'all' | 'instock' | 'sold' | 'deleted' | 'catalogue' | 'review'

type Published = 'all' | 'yes' | 'no'
type Presence = 'any' | 'has' | 'no'          // barcode / photo presence
type Catalogue = 'any' | 'only' | 'exclude'   // catalogue-only dimension (combinable)

interface Filters {
  item_name: string[]
  design: string[]
  description: string[]
  purity: string[]
  party: string[]
  wMin: number | null
  wMax: number | null
  published: Published
  barcode: Presence
  photo: Presence
  catalogue: Catalogue
}

const EMPTY_FILTERS: Filters = { item_name: [], design: [], description: [], purity: [], party: [], wMin: null, wMax: null, published: 'all', barcode: 'any', photo: 'any', catalogue: 'any' }
const DEFAULT_FILTERS: Filters = { ...EMPTY_FILTERS, purity: ['22K'] }
const STORAGE_KEY = 'mnap_catalogue_filters'
const PAGE_SIZE = 48

// Coerce a stored filter blob into the current shape. Earlier versions saved each
// text filter as a single string; wrap those into arrays so old saves still load.
function normalizeFilters(raw: Record<string, unknown>): Filters {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string')
    : typeof v === 'string' && v ? [v] : []
  return {
    item_name: arr(raw.item_name),
    design: arr(raw.design),
    description: arr(raw.description),
    purity: arr(raw.purity),
    party: arr(raw.party),
    wMin: typeof raw.wMin === 'number' ? raw.wMin : null,
    wMax: typeof raw.wMax === 'number' ? raw.wMax : null,
    published: raw.published === 'yes' || raw.published === 'no' ? raw.published : 'all',
    barcode: raw.barcode === 'has' || raw.barcode === 'no' ? raw.barcode : 'any',
    photo: raw.photo === 'has' || raw.photo === 'no' ? raw.photo : 'any',
    catalogue: raw.catalogue === 'only' || raw.catalogue === 'exclude' ? raw.catalogue : 'any',
  }
}

function initialFilters(): Filters {
  if (typeof window !== 'undefined') {
    try { const raw = window.localStorage.getItem(STORAGE_KEY); if (raw) return normalizeFilters(JSON.parse(raw)) } catch { /* ignore */ }
  }
  return DEFAULT_FILTERS
}

export default function CataloguePage() {
  const supabase = createClient()

  const [products, setProducts] = useState<WaProduct[]>([])
  const [thumbs, setThumbs]     = useState<Record<string, string>>({})
  const [options, setOptions]   = useState<Options>({ item_name: [], design: [], description: [], purity: [], party: [] })
  const [maxWeight, setMaxWeight] = useState(50)

  const [search, setSearch]     = useState('')
  const [status, setStatus]     = useState<Status>('all')
  const [filters, setFilters]   = useState<Filters>(initialFilters)
  const [panelOpen, setPanelOpen] = useState(false)
  const [savedNote, setSavedNote] = useState(false)
  const [preview, setPreview]   = useState<WaProduct | null>(null)
  const [resyncing, setResyncing] = useState(false)
  const [resyncNote, setResyncNote] = useState<string | null>(null)

  // ── Bulk selection ────────────────────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected]     = useState<Set<string>>(new Set())
  const [sheetView, setSheetView]   = useState<null | 'menu' | 'party' | 'making' | 'publish' | 'delete'>(null)
  const [bulkBusy, setBulkBusy]     = useState(false)
  const [bulkNote, setBulkNote]     = useState<string | null>(null)
  const [partyPick, setPartyPick]   = useState('')
  const [makingInput, setMakingInput] = useState('')

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function clearSelection() { setSelected(new Set()) }
  const allLoadedSelected = products.length > 0 && products.every(p => selected.has(p.id))
  function toggleSelectAll() {
    setSelected(allLoadedSelected ? new Set() : new Set(products.map(p => p.id)))
  }
  function exitSelect() { setSelectMode(false); setSelected(new Set()); setSheetView(null) }

  // Run a bulk action against the selected ids, then refetch so the list reflects
  // the new state (a piece marked Sold while viewing "In stock" should drop out).
  async function applyBulk(action: string, extra: Record<string, unknown> = {}, verb = 'Updated') {
    const ids = [...selected]
    if (ids.length === 0) return
    setBulkBusy(true); setBulkNote(null)
    try {
      const res = await fetch('/api/catalogue/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action, ...extra }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Bulk action failed')
      const n = data.deleted ?? data.updated ?? ids.length
      setBulkNote(`${verb} ${n} item${n === 1 ? '' : 's'} ✓`)
      setSheetView(null); setSelected(new Set()); setSelectMode(false)
      setLoading(true)
      await fetchPage(0, true).finally(() => setLoading(false))
    } catch (e) {
      setBulkNote(e instanceof Error ? e.message : 'Bulk action failed')
    } finally {
      setBulkBusy(false)
      setTimeout(() => setBulkNote(null), 4000)
    }
  }

  async function resyncApp() {
    setResyncing(true); setResyncNote(null)
    try {
      const res = await fetch('/api/catalogue/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resyncAll: true }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Re-sync failed')
      setResyncNote(`Re-synced ${data.count} published item${data.count === 1 ? '' : 's'} ✓`)
    } catch (e) {
      setResyncNote(e instanceof Error ? e.message : 'Re-sync failed')
    } finally {
      setResyncing(false)
      setTimeout(() => setResyncNote(null), 4000)
    }
  }

  // Debounced query inputs so typing / dragging the slider doesn't hammer the DB
  const [applied, setApplied] = useState({ status, filters, search })
  useEffect(() => {
    const t = setTimeout(() => setApplied({ status, filters, search }), 300)
    return () => clearTimeout(t)
  }, [status, filters, search])

  const [loading, setLoading]   = useState(true)   // initial / reset load
  const [loadingMore, setMore]  = useState(false)
  const [hasMore, setHasMore]   = useState(true)
  const [page, setPageState]    = useState(0)
  const [total, setTotal]       = useState<number | null>(null)

  // Load options + true max weight once (for the slider)
  useEffect(() => {
    fetchCatalogueOptions().then(setOptions)
    supabase.from('wa_products').select('weight').order('weight', { ascending: false }).limit(1)
      .then(({ data }) => { const w = data?.[0]?.weight; if (w != null) setMaxWeight(Math.max(50, Math.ceil(w))) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Build the server-side query for the current (applied) filters
  const fetchPage = useCallback(async (pageIndex: number, reset: boolean) => {
    const { status: st, filters: f, search: s } = applied
    let qb = supabase.from('wa_products').select('*', { count: 'exact' })
    // In stock excludes pieces the software deleted (stock_status='deleted' but is_sold=false).
    if (st === 'instock') qb = qb.eq('is_sold', false).eq('is_catalogue_only', false).neq('stock_status', 'deleted')
    else if (st === 'sold') qb = qb.eq('is_sold', true)
    else if (st === 'deleted') qb = qb.eq('stock_status', 'deleted')
    else if (st === 'catalogue') qb = qb.eq('is_catalogue_only', true)
    else if (st === 'review') qb = qb.eq('needs_review', true)
    if (f.item_name.length)   qb = qb.in('item_name', f.item_name)
    if (f.design.length)      qb = qb.in('design', f.design)
    if (f.description.length) qb = qb.in('description', f.description)
    if (f.purity.length)      qb = qb.in('purity', f.purity)
    if (f.party.length)       qb = qb.in('party', f.party)
    if (f.wMin != null) qb = qb.gte('weight', f.wMin)
    if (f.wMax != null) qb = qb.lte('weight', f.wMax)
    if (f.published === 'yes') qb = qb.eq('show_in_app', true)
    else if (f.published === 'no') qb = qb.eq('show_in_app', false)
    // Note: catalogue-only pieces carry an internal XMNAP##### barcode, so they count
    // as "has barcode" here — the separate Catalogue-only filter distinguishes them.
    if (f.barcode === 'has') qb = qb.not('barcode', 'is', null)
    else if (f.barcode === 'no') qb = qb.is('barcode', null)
    if (f.photo === 'has') qb = qb.eq('has_photo', true)
    else if (f.photo === 'no') qb = qb.eq('has_photo', false)
    if (f.catalogue === 'only') qb = qb.eq('is_catalogue_only', true)
    else if (f.catalogue === 'exclude') qb = qb.eq('is_catalogue_only', false)
    const q = s.trim().replace(/[,%()]/g, ' ').trim()
    if (q) qb = qb.or(`item_name.ilike.%${q}%,barcode.ilike.%${q}%,design_code.ilike.%${q}%,party.ilike.%${q}%,purity.ilike.%${q}%,design.ilike.%${q}%,description.ilike.%${q}%`)

    const from = pageIndex * PAGE_SIZE
    const { data, count } = await qb.order('created_at', { ascending: false }).range(from, from + PAGE_SIZE - 1)
    const rows = (data ?? []) as WaProduct[]

    // Thumbnails: only the primary photo for just this page of products
    if (rows.length) {
      const ids = rows.map(r => r.id)
      const { data: imgs } = await supabase.from('wa_product_images')
        .select('product_id, image_url, thumb_url, display_url, display_thumb_url').eq('is_primary', true).in('product_id', ids)
      setThumbs(prev => {
        const m = reset ? {} : { ...prev }
        for (const i of (imgs ?? [])) m[i.product_id] = i.display_thumb_url ?? i.display_url ?? i.thumb_url ?? i.image_url
        return m
      })
    } else if (reset) {
      setThumbs({})
    }

    setProducts(prev => reset ? rows : [...prev, ...rows])
    setHasMore(rows.length === PAGE_SIZE)
    setPageState(pageIndex)
    if (count != null) setTotal(count)
  }, [applied, supabase])

  // Reset to page 0 whenever the applied filters change
  useEffect(() => {
    setLoading(true)
    fetchPage(0, true).finally(() => setLoading(false))
  }, [fetchPage])

  // Infinite scroll
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loading && !loadingMore) {
        setMore(true)
        fetchPage(page + 1, false).finally(() => setMore(false))
      }
    }, { rootMargin: '800px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [fetchPage, page, hasMore, loading, loadingMore])

  async function toggleSold(e: React.MouseEvent, p: WaProduct) {
    e.preventDefault(); e.stopPropagation()
    const v = !p.is_sold
    await supabase.from('wa_products').update({ is_sold: v, updated_at: new Date().toISOString() }).eq('id', p.id)
    setProducts(prev => prev.map(x => x.id === p.id ? { ...x, is_sold: v } : x))
  }
  async function toggleReview(e: React.MouseEvent, p: WaProduct) {
    e.preventDefault(); e.stopPropagation()
    const v = !p.needs_review
    await supabase.from('wa_products').update({ needs_review: v }).eq('id', p.id)
    setProducts(prev => prev.map(x => x.id === p.id ? { ...x, needs_review: v } : x))
  }

  function setF<K extends keyof Filters>(k: K, v: Filters[K]) { setFilters(f => ({ ...f, [k]: v })) }
  function saveFilters() {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters)) } catch { /* ignore */ }
    setSavedNote(true); setTimeout(() => setSavedNote(false), 1800)
  }
  function resetFilters() {
    setFilters(EMPTY_FILTERS)
    try { window.localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
  }

  const activeCount =
    (filters.item_name.length ? 1 : 0) + (filters.design.length ? 1 : 0) + (filters.description.length ? 1 : 0) +
    (filters.purity.length ? 1 : 0) + (filters.party.length ? 1 : 0) +
    (filters.wMin != null || filters.wMax != null ? 1 : 0) + (filters.published !== 'all' ? 1 : 0) +
    (filters.barcode !== 'any' ? 1 : 0) + (filters.photo !== 'any' ? 1 : 0) + (filters.catalogue !== 'any' ? 1 : 0)

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-3 pb-24">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Catalogue</h1>
          <div className="flex items-center gap-2">
            <Link href="/catalogue/inventory" className="text-xs font-medium text-gray-600 border border-gray-300 px-2.5 py-1.5 rounded-lg active:bg-gray-50">Inventory</Link>
            <Link href="/catalogue/stock" className="text-xs font-medium text-gray-600 border border-gray-300 px-2.5 py-1.5 rounded-lg active:bg-gray-50">Stock</Link>
            <Link href="/catalogue/values" className="text-xs font-medium text-gray-600 border border-gray-300 px-2.5 py-1.5 rounded-lg active:bg-gray-50">Values</Link>
            <Link href="/catalogue/new" className="text-xs font-semibold bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg">+ Add</Link>
          </div>
        </div>

        {/* Re-sync the customer app (safety net; per-product publish is automatic) */}
        <div className="flex items-center justify-between">
          <button onClick={resyncApp} disabled={resyncing}
            className="text-xs font-medium text-gray-600 border border-gray-300 px-2.5 py-1.5 rounded-lg active:bg-gray-50 disabled:opacity-50">
            {resyncing ? 'Re-syncing…' : '↻ Re-sync customer app'}
          </button>
          {resyncNote && <span className={`text-[11px] ${resyncNote.includes('✓') ? 'text-green-700' : 'text-amber-600'}`}>{resyncNote}</span>}
        </div>

        <div className="flex gap-2">
          <input type="search" placeholder="Search name, barcode, design code…" value={search}
            onChange={e => setSearch(e.target.value)} className="input flex-1" />
          <button onClick={() => setPanelOpen(o => !o)}
            className={`flex-shrink-0 flex items-center gap-1 px-3 rounded-xl border text-sm font-medium ${
              activeCount ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'
            }`}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L14 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 018 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
            </svg>
            {activeCount ? activeCount : 'Filter'}
          </button>
        </div>

        {panelOpen && (
          <div className="card p-4 space-y-3">
            <MultiSelect label="Item name"   value={filters.item_name}   opts={options.item_name}   onChange={v => setF('item_name', v)} />
            <MultiSelect label="Design"       value={filters.design}      opts={options.design}      onChange={v => setF('design', v)} />
            <MultiSelect label="Description"  value={filters.description} opts={options.description} onChange={v => setF('description', v)} />
            <MultiSelect label="Purity"       value={filters.purity}      opts={options.purity}      onChange={v => setF('purity', v)} />
            <MultiSelect label="Party"        value={filters.party}       opts={options.party}       onChange={v => setF('party', v)} />
            <WeightRange max={maxWeight} min={filters.wMin} maxV={filters.wMax}
              onChange={(lo, hi) => setFilters(f => ({ ...f, wMin: lo, wMax: hi }))} />
            <Segmented label="Barcode" value={filters.barcode}
              options={[['any', 'Any'], ['has', 'Has'], ['no', 'None']] as const} onChange={v => setF('barcode', v)} />
            <Segmented label="Photo" value={filters.photo}
              options={[['any', 'Any'], ['has', 'Has'], ['no', 'None']] as const} onChange={v => setF('photo', v)} />
            <Segmented label="Catalogue-only" value={filters.catalogue}
              options={[['any', 'Any'], ['only', 'Only'], ['exclude', 'Exclude']] as const} onChange={v => setF('catalogue', v)} />
            <Segmented label="Customer app" value={filters.published}
              options={[['all', 'Any'], ['yes', 'Published'], ['no', 'Not published']] as const} onChange={v => setF('published', v)} />
            <div className="flex gap-2 pt-1">
              <button onClick={resetFilters} className="btn-secondary flex-1">Reset</button>
              <button onClick={saveFilters} className="btn-primary flex-1">{savedNote ? '✓ Saved' : 'Save filter'}</button>
            </div>
            <p className="text-[11px] text-gray-400 text-center">“Save filter” keeps these settings the next time you open the catalogue.</p>
          </div>
        )}

        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {([['all', 'All'], ['instock', 'In stock'], ['sold', 'Sold'], ['deleted', 'Deleted'], ['catalogue', 'Catalogue'], ['review', 'Review']] as const).map(([f, label]) => (
            <button key={f} onClick={() => setStatus(f)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                status === f ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {!loading && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">{total ?? products.length} item{(total ?? products.length) !== 1 ? 's' : ''}</p>
            {products.length > 0 && (
              selectMode ? (
                <button onClick={exitSelect} className="text-xs font-semibold text-gray-500 active:text-gray-700">Cancel</button>
              ) : (
                <button onClick={() => setSelectMode(true)} className="text-xs font-semibold text-green-600 active:text-green-700">Select</button>
              )
            )}
          </div>
        )}
        {bulkNote && (
          <p className={`text-[11px] ${bulkNote.includes('✓') ? 'text-green-700' : 'text-amber-600'}`}>{bulkNote}</p>
        )}

        {loading ? (
          <div className="flex justify-center pt-10"><div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : products.length === 0 ? (
          <div className="card p-8 text-center text-gray-400 text-sm">No products found.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {products.map(p => {
                const sel = selected.has(p.id)
                return (
                <Link key={p.id} href={`/catalogue/${p.id}`}
                  onClick={selectMode ? (e => { e.preventDefault(); toggleSelect(p.id) }) : undefined}
                  className={`card overflow-hidden active:bg-gray-50 ${sel ? 'ring-2 ring-green-500' : ''}`}>
                  <div className="relative aspect-[4/5] bg-gray-100 flex items-center justify-center">
                    {thumbs[p.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbs[p.id]} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                    ) : (
                      <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 18h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v10.5a1.5 1.5 0 001.5 1.5z" />
                      </svg>
                    )}
                    {selectMode ? (
                      <>
                        <span className={`absolute top-1.5 left-1.5 w-6 h-6 rounded-full flex items-center justify-center border-2 ${
                          sel ? 'bg-green-600 border-green-600 text-white' : 'bg-white/80 border-gray-300 text-transparent'
                        }`}>
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </span>
                        {p.is_catalogue_only ? (
                          <span className="absolute top-1.5 right-1.5 text-[10px] font-bold text-white bg-indigo-500 px-1.5 py-0.5 rounded">CATALOGUE</span>
                        ) : p.stock_status === 'deleted' ? (
                          <span className="absolute top-1.5 right-1.5 text-[10px] font-bold text-white bg-gray-500 px-1.5 py-0.5 rounded">DELETED</span>
                        ) : p.is_sold ? (
                          <span className="absolute top-1.5 right-1.5 text-[10px] font-bold text-white bg-red-600 px-1.5 py-0.5 rounded">SOLD</span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        {p.is_catalogue_only ? (
                          <span className="absolute top-1.5 left-1.5 text-[10px] font-bold text-white bg-indigo-500 px-1.5 py-0.5 rounded">CATALOGUE</span>
                        ) : p.stock_status === 'deleted' ? (
                          <span className="absolute top-1.5 left-1.5 text-[10px] font-bold text-white bg-gray-500 px-1.5 py-0.5 rounded">DELETED</span>
                        ) : p.is_sold ? (
                          <span className="absolute top-1.5 left-1.5 text-[10px] font-bold text-white bg-red-600 px-1.5 py-0.5 rounded">SOLD</span>
                        ) : null}
                        <button onClick={e => { e.preventDefault(); e.stopPropagation(); setPreview(p) }} title="Preview"
                          className="absolute bottom-1.5 left-1.5 w-6 h-6 rounded-full bg-white/80 text-gray-600 flex items-center justify-center active:bg-white">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>
                        <button onClick={e => toggleReview(e, p)} title="Mark for review"
                          className={`absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center ${
                            p.needs_review ? 'bg-amber-500 text-white' : 'bg-white/80 text-gray-400'
                          }`}>
                          <svg className="w-3.5 h-3.5" fill={p.needs_review ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 2H21l-3 6 3 6h-8.5l-1-2H5a2 2 0 00-2 2z" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                  <div className="p-2.5">
                    <p className="font-semibold text-gray-900 text-sm truncate">{p.item_name || 'Untitled'}</p>
                    <p className="text-xs text-gray-400 truncate">
                      {p.design_code && <span className="font-mono text-gray-500">{p.design_code}</span>}
                      {p.design_code && p.barcode && <span className="text-gray-300"> · </span>}
                      {p.barcode || (p.design_code ? '' : 'No barcode')}
                    </p>
                    <div className="flex items-center justify-between gap-1 mt-1.5">
                      <div className="flex flex-wrap gap-1 min-w-0">
                        {p.purity && <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-0.5 rounded-full">{p.purity}</span>}
                        {p.weight != null && <span className="text-[10px] bg-gray-50 text-gray-600 border border-gray-200 px-1.5 py-0.5 rounded-full">{p.weight} g</span>}
                      </div>
                      {p.is_catalogue_only ? (
                        <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-indigo-50 text-indigo-600 border-indigo-200">
                          Catalogue
                        </span>
                      ) : p.stock_status === 'deleted' ? (
                        <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-gray-100 text-gray-500 border-gray-200">
                          Deleted
                        </span>
                      ) : selectMode ? (
                        <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          p.is_sold ? 'bg-red-50 text-red-600 border-red-200' : 'bg-green-50 text-green-700 border-green-200'
                        }`}>
                          {p.is_sold ? 'Sold' : 'In stock'}
                        </span>
                      ) : (
                        <button onClick={e => toggleSold(e, p)}
                          className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                            p.is_sold ? 'bg-red-50 text-red-600 border-red-200' : 'bg-green-50 text-green-700 border-green-200'
                          }`}>
                          {p.is_sold ? 'Sold' : 'In stock'}
                        </button>
                      )}
                    </div>
                  </div>
                </Link>
                )
              })}
            </div>

            {/* Infinite-scroll sentinel + footer */}
            <div ref={sentinel} className="h-10 flex items-center justify-center">
              {loadingMore && <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />}
              {!hasMore && products.length > 0 && <span className="text-[11px] text-gray-300">End of list</span>}
            </div>
          </>
        )}
      </main>

      {/* Sticky selection bar */}
      {selectMode && (
        <div className="fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur px-4 py-2.5">
          <div className="max-w-lg mx-auto flex items-center gap-3">
            <span className="text-sm font-semibold text-gray-900">{selected.size} selected</span>
            <button onClick={toggleSelectAll} className="text-xs font-medium text-green-600 active:text-green-700">
              {allLoadedSelected ? 'Deselect all' : 'Select all'}
            </button>
            {selected.size > 0 && (
              <button onClick={clearSelection} className="text-xs font-medium text-gray-400 active:text-gray-600">Clear</button>
            )}
            <button onClick={() => setSheetView('menu')} disabled={selected.size === 0}
              className="ml-auto text-sm font-semibold bg-green-600 text-white px-4 py-1.5 rounded-lg disabled:opacity-40">
              Actions
            </button>
          </div>
        </div>
      )}

      {/* Bulk action sheet */}
      {sheetView && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => !bulkBusy && setSheetView(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative w-full max-w-lg bg-white rounded-t-2xl p-4 pb-6 space-y-3 max-h-[85vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-gray-900">
                {sheetView === 'menu' ? `${selected.size} product${selected.size === 1 ? '' : 's'}`
                  : sheetView === 'party' ? 'Set party'
                  : sheetView === 'making' ? 'Set making %'
                  : sheetView === 'publish' ? 'Publish to customer app'
                  : 'Delete products'}
              </h2>
              <button onClick={() => setSheetView(sheetView === 'menu' ? null : 'menu')} disabled={bulkBusy}
                className="text-sm font-medium text-gray-400 active:text-gray-600 disabled:opacity-50">
                {sheetView === 'menu' ? 'Close' : '‹ Back'}
              </button>
            </div>

            {sheetView === 'menu' && (
              <div className="space-y-3">
                <BulkGroup label="Stock">
                  <SheetBtn onClick={() => applyBulk('sold', { sold: false }, 'Marked in stock')} disabled={bulkBusy}
                    className="bg-green-50 text-green-700 border-green-200">In stock</SheetBtn>
                  <SheetBtn onClick={() => applyBulk('sold', { sold: true }, 'Marked sold')} disabled={bulkBusy}
                    className="bg-red-50 text-red-600 border-red-200">Sold</SheetBtn>
                </BulkGroup>
                <BulkGroup label="Type">
                  <SheetBtn onClick={() => applyBulk('catalogue', { catalogue: true }, 'Marked catalogue')} disabled={bulkBusy}
                    className="bg-indigo-50 text-indigo-600 border-indigo-200">Catalogue</SheetBtn>
                  <SheetBtn onClick={() => applyBulk('catalogue', { catalogue: false }, 'Marked stock')} disabled={bulkBusy}
                    className="bg-white text-gray-600 border-gray-300">Stock piece</SheetBtn>
                </BulkGroup>
                <BulkGroup label="Review">
                  <SheetBtn onClick={() => applyBulk('review', { review: true }, 'Flagged')} disabled={bulkBusy}
                    className="bg-amber-50 text-amber-700 border-amber-200">Needs review</SheetBtn>
                  <SheetBtn onClick={() => applyBulk('review', { review: false }, 'Cleared review on')} disabled={bulkBusy}
                    className="bg-white text-gray-600 border-gray-300">Clear review</SheetBtn>
                </BulkGroup>
                <BulkGroup label="Customer app">
                  <SheetBtn onClick={() => { setMakingInput(''); setSheetView('publish') }} disabled={bulkBusy}
                    className="bg-green-50 text-green-700 border-green-200">Publish…</SheetBtn>
                  <SheetBtn onClick={() => applyBulk('publish', { publish: false }, 'Unpublished')} disabled={bulkBusy}
                    className="bg-white text-gray-600 border-gray-300">Unpublish</SheetBtn>
                </BulkGroup>
                <BulkGroup label="Edit">
                  <SheetBtn onClick={() => { setPartyPick(''); setSheetView('party') }} disabled={bulkBusy}
                    className="bg-white text-gray-700 border-gray-300">Set party…</SheetBtn>
                  <SheetBtn onClick={() => { setMakingInput(''); setSheetView('making') }} disabled={bulkBusy}
                    className="bg-white text-gray-700 border-gray-300">Set making %…</SheetBtn>
                </BulkGroup>
                <BulkGroup label="Danger zone">
                  <SheetBtn onClick={() => setSheetView('delete')} disabled={bulkBusy}
                    className="bg-red-600 text-white border-red-600">Delete…</SheetBtn>
                </BulkGroup>
              </div>
            )}

            {sheetView === 'publish' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">Publishes {selected.size} product{selected.size === 1 ? '' : 's'} to the customer app. Set a making % to apply to all of them, or leave blank to keep each product’s current value.</p>
                <input type="number" inputMode="decimal" placeholder="Making % (optional)" value={makingInput}
                  onChange={e => setMakingInput(e.target.value)} className="input w-full" />
                <button onClick={() => applyBulk('publish', { publish: true, makingPercent: makingInput.trim() === '' ? null : Number(makingInput) }, 'Published')}
                  disabled={bulkBusy} className="btn-primary w-full disabled:opacity-50">
                  {bulkBusy ? 'Publishing…' : `Publish ${selected.size} product${selected.size === 1 ? '' : 's'}`}
                </button>
              </div>
            )}

            {sheetView === 'making' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">Sets the making % on {selected.size} product{selected.size === 1 ? '' : 's'}. Published pieces re-sync so the app’s live price updates.</p>
                <input type="number" inputMode="decimal" placeholder="Making %" value={makingInput}
                  onChange={e => setMakingInput(e.target.value)} className="input w-full" autoFocus />
                <button onClick={() => applyBulk('set_making', { makingPercent: Number(makingInput) }, 'Set making % on')}
                  disabled={bulkBusy || makingInput.trim() === ''} className="btn-primary w-full disabled:opacity-50">
                  {bulkBusy ? 'Saving…' : 'Apply'}
                </button>
              </div>
            )}

            {sheetView === 'party' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">Assigns a party to {selected.size} product{selected.size === 1 ? '' : 's'}. Manage the list on the Values page.</p>
                <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-300 divide-y divide-gray-100">
                  {options.party.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-400">No parties yet — add one on the Values page.</p>
                  ) : options.party.map(o => (
                    <label key={o} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer active:bg-gray-50">
                      <input type="radio" name="bulk-party" checked={partyPick === o} onChange={() => setPartyPick(o)}
                        className="w-4 h-4 accent-green-600 flex-shrink-0" />
                      <span className={partyPick === o ? 'text-gray-900 font-medium' : 'text-gray-600'}>{o}</span>
                    </label>
                  ))}
                </div>
                <button onClick={() => applyBulk('set_party', { party: partyPick }, 'Set party on')}
                  disabled={bulkBusy || !partyPick} className="btn-primary w-full disabled:opacity-50">
                  {bulkBusy ? 'Saving…' : 'Apply'}
                </button>
              </div>
            )}

            {sheetView === 'delete' && (
              <div className="space-y-3">
                <p className="text-sm text-gray-700">Permanently delete <b>{selected.size}</b> product{selected.size === 1 ? '' : 's'}, including their photos. Published pieces are removed from the customer app. This cannot be undone.</p>
                <button onClick={() => applyBulk('delete', {}, 'Deleted')} disabled={bulkBusy}
                  className="w-full py-2.5 rounded-xl bg-red-600 text-white font-semibold text-sm disabled:opacity-50">
                  {bulkBusy ? 'Deleting…' : `Yes, delete ${selected.size}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {preview && <PreviewModal product={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

// A labelled row of bulk-action buttons in the action sheet.
function BulkGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <div className="flex gap-2">{children}</div>
    </div>
  )
}

function SheetBtn({ onClick, disabled, className, children }: {
  onClick: () => void; disabled?: boolean; className: string; children: React.ReactNode
}) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex-1 text-sm font-semibold px-3 py-2.5 rounded-xl border disabled:opacity-50 ${className}`}>
      {children}
    </button>
  )
}

// A single-choice segmented control (Any / … row of pill buttons).
function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: readonly (readonly [T, string])[]
  onChange: (v: T) => void
}) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-600">{label}</label>
      <div className="flex gap-2 mt-1">
        {options.map(([v, l]) => (
          <button key={v} onClick={() => onChange(v)}
            className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              value === v ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'
            }`}>
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}

// Multi-value picker: a scrollable CHECKBOX list — tap any number of options to
// toggle them (no native dropdown). Empty selection ⇒ no filter on this field.
function MultiSelect({ label, value, opts, onChange }: { label: string; value: string[]; opts: string[]; onChange: (v: string[]) => void }) {
  function toggle(o: string) {
    onChange(value.includes(o) ? value.filter(x => x !== o) : [...value, o])
  }
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-gray-600">
          {label}{value.length > 0 && <span className="ml-1 text-green-600">({value.length})</span>}
        </label>
        {value.length > 0 && (
          <button onClick={() => onChange([])} className="text-[11px] text-gray-400 active:text-gray-600">Clear</button>
        )}
      </div>
      <div className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-gray-300 divide-y divide-gray-100">
        {opts.length === 0 ? (
          <p className="px-3 py-2 text-xs text-gray-400">No options yet</p>
        ) : opts.map(o => {
          const on = value.includes(o)
          return (
            <label key={o} className="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer active:bg-gray-50">
              <input type="checkbox" checked={on} onChange={() => toggle(o)} className="w-4 h-4 accent-green-600 flex-shrink-0" />
              <span className={`truncate ${on ? 'text-gray-900 font-medium' : 'text-gray-600'}`}>{o}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

const FINE_SPLIT = 75 // % of the track devoted to 0–50 g
function WeightRange({ max, min, maxV, onChange }: {
  max: number; min: number | null; maxV: number | null; onChange: (lo: number | null, hi: number | null) => void
}) {
  function posToWeight(pos: number): number {
    if (max <= 50) return Math.round((pos / 100) * max)
    if (pos <= FINE_SPLIT) return Math.round((pos / FINE_SPLIT) * 50)
    return Math.round(50 + ((pos - FINE_SPLIT) / (100 - FINE_SPLIT)) * (max - 50))
  }
  function weightToPos(w: number): number {
    if (max <= 50) return (w / max) * 100
    if (w <= 50) return (w / 50) * FINE_SPLIT
    return FINE_SPLIT + ((w - 50) / (max - 50)) * (100 - FINE_SPLIT)
  }
  const loPos = min != null ? weightToPos(min) : 0
  const hiPos = maxV != null ? weightToPos(maxV) : 100
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-gray-600">Weight (g)</label>
        <span className="text-[11px] text-gray-400">{min ?? 0} – {maxV ?? max}+ g</span>
      </div>
      <div className="relative h-8 mt-1">
        <input type="range" min={0} max={100} value={loPos}
          onChange={e => { const w = posToWeight(Number(e.target.value)); onChange(w <= 0 ? null : w, maxV) }}
          className="absolute inset-x-0 top-3 w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-green-600" />
        <input type="range" min={0} max={100} value={hiPos}
          onChange={e => { const w = posToWeight(Number(e.target.value)); onChange(min, w >= max ? null : w) }}
          className="absolute inset-x-0 top-3 w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-green-600" />
        <div className="absolute inset-x-0 top-[18px] h-1 bg-gray-200 rounded-full" />
      </div>
      <div className="flex items-center gap-2 mt-1">
        <input type="number" inputMode="decimal" placeholder="Min" value={min ?? ''} step="0.001"
          onChange={e => onChange(e.target.value ? Number(e.target.value) : null, maxV)} className="input flex-1 !py-1.5 text-sm" />
        <span className="text-gray-400 text-sm">to</span>
        <input type="number" inputMode="decimal" placeholder="Max" value={maxV ?? ''} step="0.001"
          onChange={e => onChange(min, e.target.value ? Number(e.target.value) : null)} className="input flex-1 !py-1.5 text-sm" />
      </div>
    </div>
  )
}
