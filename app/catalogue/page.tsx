'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'
import type { WaProduct } from '@/lib/types'

type Filter = 'all' | 'instock' | 'sold' | 'review'

export default function CataloguePage() {
  const supabase = createClient()
  const [products, setProducts] = useState<WaProduct[]>([])
  const [thumbs, setThumbs]     = useState<Record<string, string>>({})
  const [search, setSearch]     = useState('')
  const [filter, setFilter]     = useState<Filter>('all')
  const [loading, setLoading]   = useState(true)

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const q = search.trim().toLowerCase()
  const base = filter === 'instock' ? products.filter(p => !p.is_sold)
    : filter === 'sold' ? products.filter(p => p.is_sold)
    : filter === 'review' ? products.filter(p => p.needs_review)
    : products
  const filtered = q
    ? base.filter(p => [p.item_name, p.barcode, p.party, p.purity, p.design].some(v => (v ?? '').toLowerCase().includes(q)))
    : base

  const reviewCount = products.filter(p => p.needs_review).length

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Catalogue</h1>
          <Link href="/catalogue/new" className="text-xs font-semibold bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg">
            + Add product
          </Link>
        </div>

        <input type="search" placeholder="Search name, barcode, party, purity…" value={search}
          onChange={e => setSearch(e.target.value)} className="input" />

        {/* Status filters */}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {([['all', 'All'], ['instock', 'In stock'], ['sold', 'Sold'], ['review', reviewCount ? `Review (${reviewCount})` : 'Review']] as const).map(([f, label]) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                filter === f ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'
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
                  {/* QC review flag — tap to toggle */}
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
