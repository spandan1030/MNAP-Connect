'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { fetchCatalogueOptions, type Options } from '@/lib/catalogue'
import Navbar from '@/components/ui/Navbar'
import type { WaProduct } from '@/lib/types'

type Status = 'all' | 'instock' | 'sold' | 'review'

interface Filters {
  item_name: string
  design: string
  description: string
  purity: string
  party: string
  wMin: number | null
  wMax: number | null
}

const EMPTY_FILTERS: Filters = { item_name: '', design: '', description: '', purity: '', party: '', wMin: null, wMax: null }
const DEFAULT_FILTERS: Filters = { ...EMPTY_FILTERS, purity: '22K' }
const STORAGE_KEY = 'mnap_catalogue_filters'

export default function CataloguePage() {
  const supabase = createClient()
  const [products, setProducts] = useState<WaProduct[]>([])
  const [thumbs, setThumbs]     = useState<Record<string, string>>({})
  const [options, setOptions]   = useState<Options>({ item_name: [], design: [], description: [], purity: [], party: [] })
  const [search, setSearch]     = useState('')
  const [status, setStatus]     = useState<Status>('all')
  const [loading, setLoading]   = useState(true)

  const [filters, setFilters]   = useState<Filters>(DEFAULT_FILTERS)
  const [panelOpen, setPanelOpen] = useState(false)
  const [savedNote, setSavedNote] = useState(false)

  useEffect(() => {
    async function load() {
      const [prodRes, imgRes] = await Promise.all([
        supabase.from('wa_products').select('*').order('created_at', { ascending: false }),
        supabase.from('wa_product_images').select('product_id, image_url').order('sort_order'),
      ])
      setProducts((prodRes.data ?? []) as WaProduct[])
      const map: Record<string, string> = {}
      for (const img of (imgRes.data ?? [])) if (!map[img.product_id]) map[img.product_id] = img.image_url
      setThumbs(map)
      setLoading(false)
    }
    load()
    fetchCatalogueOptions().then(setOptions)
    // Restore a previously-saved (fixed) filter
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null
      if (raw) setFilters({ ...EMPTY_FILTERS, ...JSON.parse(raw) })
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const maxWeight = useMemo(() => {
    const max = products.reduce((m, p) => Math.max(m, p.weight ?? 0), 0)
    return Math.max(Math.ceil(max), 50)
  }, [products])

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
    (filters.item_name ? 1 : 0) + (filters.design ? 1 : 0) + (filters.description ? 1 : 0) +
    (filters.purity ? 1 : 0) + (filters.party ? 1 : 0) + (filters.wMin != null || filters.wMax != null ? 1 : 0)

  const q = search.trim().toLowerCase()
  const filtered = useMemo(() => {
    return products.filter(p => {
      if (status === 'instock' && p.is_sold) return false
      if (status === 'sold' && !p.is_sold) return false
      if (status === 'review' && !p.needs_review) return false
      if (filters.item_name && p.item_name !== filters.item_name) return false
      if (filters.design && p.design !== filters.design) return false
      if (filters.description && p.description !== filters.description) return false
      if (filters.purity && p.purity !== filters.purity) return false
      if (filters.party && p.party !== filters.party) return false
      if (filters.wMin != null && (p.weight ?? -1) < filters.wMin) return false
      if (filters.wMax != null && (p.weight ?? Infinity) > filters.wMax) return false
      if (q && ![p.item_name, p.barcode, p.party, p.purity, p.design, p.description].some(v => (v ?? '').toLowerCase().includes(q))) return false
      return true
    })
  }, [products, status, filters, q])

  const reviewCount = products.filter(p => p.needs_review).length

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-3 pb-24">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Catalogue</h1>
          <div className="flex items-center gap-2">
            <Link href="/catalogue/inventory" className="text-xs font-medium text-gray-600 border border-gray-300 px-2.5 py-1.5 rounded-lg active:bg-gray-50">
              Inventory
            </Link>
            <Link href="/catalogue/values" className="text-xs font-medium text-gray-600 border border-gray-300 px-2.5 py-1.5 rounded-lg active:bg-gray-50">
              Values
            </Link>
            <Link href="/catalogue/new" className="text-xs font-semibold bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg">
              + Add
            </Link>
          </div>
        </div>

        <div className="flex gap-2">
          <input type="search" placeholder="Search name, barcode, party…" value={search}
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

        {/* Filter panel */}
        {panelOpen && (
          <div className="card p-4 space-y-3">
            <Select label="Item name"   value={filters.item_name}   opts={options.item_name}   onChange={v => setF('item_name', v)} />
            <Select label="Design"       value={filters.design}      opts={options.design}      onChange={v => setF('design', v)} />
            <Select label="Description"  value={filters.description} opts={options.description} onChange={v => setF('description', v)} />
            <div className="flex gap-3">
              <div className="flex-1"><Select label="Purity" value={filters.purity} opts={options.purity} onChange={v => setF('purity', v)} /></div>
              <div className="flex-1"><Select label="Party"  value={filters.party}  opts={options.party}  onChange={v => setF('party', v)} /></div>
            </div>

            <WeightRange max={maxWeight} min={filters.wMin} maxV={filters.wMax}
              onChange={(lo, hi) => setFilters(f => ({ ...f, wMin: lo, wMax: hi }))} />

            <div className="flex gap-2 pt-1">
              <button onClick={resetFilters} className="btn-secondary flex-1">Reset</button>
              <button onClick={saveFilters} className="btn-primary flex-1">{savedNote ? '✓ Saved' : 'Save filter'}</button>
            </div>
            <p className="text-[11px] text-gray-400 text-center">“Save filter” keeps these settings the next time you open the catalogue.</p>
          </div>
        )}

        {/* Status filters */}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {([['all', 'All'], ['instock', 'In stock'], ['sold', 'Sold'], ['review', reviewCount ? `Review (${reviewCount})` : 'Review']] as const).map(([f, label]) => (
            <button key={f} onClick={() => setStatus(f)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                status === f ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {!loading && <p className="text-xs text-gray-400">{filtered.length} item{filtered.length !== 1 ? 's' : ''}</p>}

        {loading ? (
          <div className="flex justify-center pt-10"><div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="card p-8 text-center text-gray-400 text-sm">No products found.</div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map(p => (
              <Link key={p.id} href={`/catalogue/${p.id}`} className="card overflow-hidden active:bg-gray-50">
                <div className="relative aspect-square bg-gray-100 flex items-center justify-center">
                  {thumbs[p.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbs[p.id]} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 18h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v10.5a1.5 1.5 0 001.5 1.5z" />
                    </svg>
                  )}
                  {p.is_sold && (
                    <span className="absolute top-1.5 left-1.5 text-[10px] font-bold text-white bg-red-600 px-1.5 py-0.5 rounded">SOLD</span>
                  )}
                  <button onClick={e => toggleReview(e, p)} title="Mark for review"
                    className={`absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center ${
                      p.needs_review ? 'bg-amber-500 text-white' : 'bg-white/80 text-gray-400'
                    }`}>
                    <svg className="w-3.5 h-3.5" fill={p.needs_review ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 2H21l-3 6 3 6h-8.5l-1-2H5a2 2 0 00-2 2z" />
                    </svg>
                  </button>
                </div>
                <div className="p-2.5">
                  <p className="font-semibold text-gray-900 text-sm truncate">{p.item_name || 'Untitled'}</p>
                  <p className="text-xs text-gray-400 truncate">{p.barcode || 'No barcode'}</p>
                  <div className="flex items-center justify-between gap-1 mt-1.5">
                    <div className="flex flex-wrap gap-1 min-w-0">
                      {p.purity && <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-0.5 rounded-full">{p.purity}</span>}
                      {p.weight != null && <span className="text-[10px] bg-gray-50 text-gray-600 border border-gray-200 px-1.5 py-0.5 rounded-full">{p.weight} g</span>}
                    </div>
                    <button onClick={e => toggleSold(e, p)}
                      className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        p.is_sold ? 'bg-red-50 text-red-600 border-red-200' : 'bg-green-50 text-green-700 border-green-200'
                      }`}>
                      {p.is_sold ? 'Sold' : 'In stock'}
                    </button>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function Select({ label, value, opts, onChange }: { label: string; value: string; opts: string[]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-600">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} className="input mt-1">
        <option value="">Any</option>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

// Weight range with finer resolution over 0–50 g (where most jewellery sits),
// then coarser up to the catalogue's heaviest piece. Number inputs allow exact entry.
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
