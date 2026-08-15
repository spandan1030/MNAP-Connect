'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'
import type { WaProduct } from '@/lib/types'

const UNSET = '— Not set —'
const lbl = (v: string | null) => (v && v.trim()) || UNSET

interface Leaf { key: string; description: string; purity: string; products: WaProduct[]; weight: number }
interface DesignGroup { key: string; design: string; leaves: Leaf[]; count: number; weight: number }
interface ItemGroup { key: string; item: string; designs: DesignGroup[]; count: number; weight: number }

export default function InventoryPage() {
  const supabase = createClient()
  const router = useRouter()

  const [products, setProducts] = useState<WaProduct[]>([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [openItems, setOpenItems]     = useState<Set<string>>(new Set())
  const [openDesigns, setOpenDesigns] = useState<Set<string>>(new Set())
  const [openLeaves, setOpenLeaves]   = useState<Set<string>>(new Set())

  useEffect(() => {
    async function load() {
      // In-stock only: active, physically in stock (not sold/deleted), and a real
      // physical piece (not a catalogue/design-only product).
      const { data } = await supabase.from('wa_products').select('*')
        .eq('is_active', true).eq('stock_status', 'in_stock').eq('is_catalogue_only', false)
      setProducts((data ?? []) as WaProduct[])
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const q = search.trim().toLowerCase()

  const groups = useMemo<ItemGroup[]>(() => {
    const pool = q
      ? products.filter(p => [p.item_name, p.design, p.description, p.purity, p.barcode]
          .some(v => (v ?? '').toLowerCase().includes(q)))
      : products

    const items = new Map<string, ItemGroup>()
    for (const p of pool) {
      const itemKey = lbl(p.item_name)
      const designKey = lbl(p.design)
      const leafKey = `${lbl(p.description)}|||${lbl(p.purity)}`
      const w = p.weight ?? 0

      let ig = items.get(itemKey)
      if (!ig) { ig = { key: itemKey, item: itemKey, designs: [], count: 0, weight: 0 }; items.set(itemKey, ig) }
      ig.count++; ig.weight += w

      let dg = ig.designs.find(d => d.key === designKey)
      if (!dg) { dg = { key: designKey, design: designKey, leaves: [], count: 0, weight: 0 }; ig.designs.push(dg) }
      dg.count++; dg.weight += w

      let lf = dg.leaves.find(l => l.key === leafKey)
      if (!lf) { lf = { key: leafKey, description: lbl(p.description), purity: lbl(p.purity), products: [], weight: 0 }; dg.leaves.push(lf) }
      lf.products.push(p); lf.weight += w
    }

    const arr = [...items.values()].sort((a, b) => a.item.localeCompare(b.item))
    for (const ig of arr) {
      ig.designs.sort((a, b) => a.design.localeCompare(b.design))
      for (const dg of ig.designs) dg.leaves.sort((a, b) => a.description.localeCompare(b.description) || a.purity.localeCompare(b.purity))
    }
    return arr
  }, [products, q])

  const totalPieces = useMemo(() => groups.reduce((s, g) => s + g.count, 0), [groups])

  function toggle(set: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) {
    set(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }
  const fmtW = (w: number) => w > 0 ? `${(Math.round(w * 1000) / 1000)} g` : null

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-3 pb-24">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">←</button>
          <h1 className="text-lg font-bold text-gray-900">Inventory</h1>
          <Link href="/catalogue/mappings" className="ml-auto text-xs font-medium text-gray-600 bg-gray-100 px-2.5 py-1 rounded-full hover:bg-gray-200">
            Mappings
          </Link>
          <Link href="/catalogue/import" className="text-xs font-medium text-green-700 bg-green-50 px-2.5 py-1 rounded-full hover:bg-green-100">
            ⬆ Import
          </Link>
        </div>
        <p className="text-xs text-gray-400">In-stock pieces grouped by item → design → description &amp; purity. Live from the catalogue.</p>

        <input type="search" placeholder="Search item, design, purity…" value={search}
          onChange={e => setSearch(e.target.value)} className="input" />

        {!loading && (
          <div className="card px-4 py-2.5 flex items-center justify-between">
            <span className="text-sm text-gray-600">In stock</span>
            <span className="text-lg font-bold text-green-700">{totalPieces} <span className="text-xs font-medium text-gray-400">pieces</span></span>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center pt-10"><div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : groups.length === 0 ? (
          <div className="card p-8 text-center text-gray-400 text-sm">No in-stock products.</div>
        ) : (
          <div className="space-y-1.5">
            {groups.map(ig => {
              const itemOpen = openItems.has(ig.key)
              return (
                <div key={ig.key} className="card overflow-hidden">
                  {/* Item level */}
                  <button onClick={() => toggle(setOpenItems, ig.key)}
                    className="w-full flex items-center gap-2 px-3 py-3 text-left active:bg-gray-50">
                    <span className={`text-gray-400 transition-transform ${itemOpen ? 'rotate-90' : ''}`}>›</span>
                    <span className="flex-1 font-semibold text-gray-900 text-sm truncate">{ig.item}</span>
                    {fmtW(ig.weight) && <span className="text-[11px] text-gray-400">{fmtW(ig.weight)}</span>}
                    <span className="text-xs font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">{ig.count}</span>
                  </button>

                  {itemOpen && (
                    <div className="border-t border-gray-100">
                      {ig.designs.map(dg => {
                        const dKey = `${ig.key}>${dg.key}`
                        const dOpen = openDesigns.has(dKey)
                        return (
                          <div key={dKey} className="border-b border-gray-50 last:border-0">
                            {/* Design level */}
                            <button onClick={() => toggle(setOpenDesigns, dKey)}
                              className="w-full flex items-center gap-2 pl-7 pr-3 py-2.5 text-left active:bg-gray-50">
                              <span className={`text-gray-300 transition-transform ${dOpen ? 'rotate-90' : ''}`}>›</span>
                              <span className="flex-1 text-sm text-gray-700 truncate">{dg.design}</span>
                              <span className="text-[11px] font-semibold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{dg.count}</span>
                            </button>

                            {dOpen && (
                              <div className="bg-gray-50">
                                {dg.leaves.map(lf => {
                                  const lKey = `${dKey}>${lf.key}`
                                  const lOpen = openLeaves.has(lKey)
                                  return (
                                    <div key={lKey}>
                                      {/* Description + purity leaf */}
                                      <button onClick={() => toggle(setOpenLeaves, lKey)}
                                        className="w-full flex items-center gap-2 pl-12 pr-3 py-2 text-left active:bg-gray-100">
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm text-gray-700 truncate">{lf.description}</p>
                                          <p className="text-[11px] text-amber-700">{lf.purity}{fmtW(lf.weight) ? ` · ${fmtW(lf.weight)}` : ''}</p>
                                        </div>
                                        <span className="text-xs font-bold text-green-700">×{lf.products.length}</span>
                                      </button>
                                      {lOpen && (
                                        <div className="pl-12 pr-3 pb-2 space-y-1">
                                          {lf.products.map(p => (
                                            <Link key={p.id} href={`/catalogue/${p.id}`}
                                              className="flex items-center justify-between text-xs text-gray-600 py-1 active:text-green-700">
                                              <span className="truncate">{p.barcode || 'No barcode'}{p.weight != null ? ` · ${p.weight} g` : ''}</span>
                                              <span className="text-gray-300">›</span>
                                            </Link>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
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
