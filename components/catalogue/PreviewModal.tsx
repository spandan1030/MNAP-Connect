'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { WaProduct, WaProductImage } from '@/lib/types'

export default function PreviewModal({ product, onClose }: { product: WaProduct; onClose: () => void }) {
  const supabase = createClient()
  const [images, setImages] = useState<WaProductImage[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('wa_product_images').select('*')
        .eq('product_id', product.id)
        .order('is_primary', { ascending: false }).order('sort_order')
      setImages((data ?? []) as WaProductImage[])
      setLoading(false)
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id])

  const details = [
    product.barcode && ['Barcode', product.barcode],
    product.purity && ['Purity', product.purity],
    product.weight != null && ['Weight', `${product.weight} g`],
    product.design && ['Design', product.design],
    product.description && ['Description', product.description],
    product.party && ['Party', product.party],
  ].filter(Boolean) as [string, string][]

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-sm truncate">{product.item_name || 'Product'}</h2>
          <button onClick={onClose} className="text-gray-400 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : images.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-sm">No photos for this product.</div>
          ) : (
            <div className="flex overflow-x-auto snap-x snap-mandatory">
              {images.map(img => (
                <a key={img.id} href={img.image_url} target="_blank" rel="noopener noreferrer"
                  className="snap-center flex-shrink-0 w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.display_url ?? img.image_url} alt="" className="w-full max-h-[55vh] object-contain bg-gray-900" />
                </a>
              ))}
            </div>
          )}

          <div className="p-4 space-y-2">
            {product.is_sold && <span className="inline-block text-[10px] font-bold text-white bg-red-600 px-2 py-0.5 rounded">SOLD</span>}
            {details.length > 0 && (
              <dl className="divide-y divide-gray-100">
                {details.map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1.5 text-sm">
                    <dt className="text-gray-400">{k}</dt>
                    <dd className="text-gray-800 font-medium text-right truncate ml-3">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {images.length > 1 && <p className="text-[11px] text-gray-400 text-center">Swipe to see all {images.length} photos · tap to open full size</p>}
          </div>
        </div>

        <div className="p-3 border-t border-gray-100">
          <Link href={`/catalogue/${product.id}`} className="btn-primary w-full text-center block">Open details</Link>
        </div>
      </div>
    </div>
  )
}
