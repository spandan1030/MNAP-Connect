// Catalogue → customer-app sync (SERVER-ONLY).
//
// Mirrors ONE published product into the customer app's Firestore `catalogue`
// collection. Only a sanitized subset is sent — never party, barcode, cost or
// notes. Called from the publish API route whenever a published product changes.
//
// The customer app computes the live price itself from its own daily rate:
//   metal = weightG × ratePerGram(karat);  making = metal × makingPercent/100;
//   + GST. So we only send weight, karat and makingPercent — never a price.

import { supabaseAdmin } from '@/lib/supabase/admin'
import { customerDb } from '@/lib/firebase/admin'
import type { WaProduct, WaProductImage } from '@/lib/types'

/** Map a free-text purity to a karat number, or null if unrecognised. */
export function resolveKarat(purity: string | null): number | null {
  if (!purity) return null
  const p = purity.toLowerCase()
  if (/(^|\D)(24|995|999)(\D|$)/.test(p) || p.includes('24k')) return 24
  if (/(^|\D)(22|916)(\D|$)/.test(p) || p.includes('22k')) return 22
  if (/(^|\D)(18|750)(\D|$)/.test(p) || p.includes('18k')) return 18
  if (/(^|\D)(14|585)(\D|$)/.test(p) || p.includes('14k')) return 14
  if (/(^|\D)(9|375)(\D|$)/.test(p) || p.includes('9k')) return 9
  return null
}

interface CatalogueDoc {
  title: string
  description: string
  category: string
  barcode: string | null
  design: string | null
  weightG: number | null
  purity: string | null
  karat: number | null
  priceHidden: boolean
  makingPercent: number | null
  image: string | null
  thumb: string | null
  images: string[]        // full gallery (primary first) shown in the customer app viewer
  active: boolean
  inStock: boolean        // true only for an unsold, barcoded piece; else the app shows a "Sold" treatment
  source: 'connect'
  updatedAt: number
}

// The published gallery: photos marked in_app (primary always included), primary
// first then sort_order, mapped to the 4:5 crop (falling back to the original).
function publishedImages(imgs: WaProductImage[]): WaProductImage[] {
  return imgs
    .filter(i => i.in_app || i.is_primary)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order)
}

function buildDoc(p: WaProduct & { app_title?: string | null; app_description?: string | null; making_percent?: number | null; show_in_app?: boolean }, imgs: WaProductImage[]): CatalogueDoc {
  const karat = resolveKarat(p.purity)
  const gallery = publishedImages(imgs)
  const cover = gallery[0] ?? null
  return {
    title: (p.app_title?.trim() || p.item_name || 'Jewellery').toString(),
    description: (p.app_description?.trim() || p.description || '').toString(),
    category: (p.item_name || '').toString(),
    barcode: p.barcode ?? null,
    design: p.design ?? null,
    weightG: p.weight ?? null,
    purity: p.purity ?? null,
    karat,
    // Unmapped purity → we still publish, but the app shows "Enquire" instead of a price.
    priceHidden: karat === null,
    makingPercent: p.making_percent ?? null,
    // Feed the 4:5 crop; fall back to the original for photos taken before cropping existed.
    image: cover?.display_url ?? cover?.image_url ?? null,
    thumb: cover?.display_thumb_url ?? cover?.thumb_url ?? cover?.image_url ?? null,
    images: gallery.map(i => i.display_url ?? i.image_url).filter(Boolean) as string[],
    // Stays in the customer catalogue while published + active. Sold pieces are NOT
    // hidden anymore — they remain visible and carry `inStock:false` so the app can
    // show a "Sold" treatment (different info) instead of dropping the piece.
    active: Boolean(p.show_in_app) && p.is_active,
    // "In stock" means an unsold, BARCODED piece. A product with no barcode is
    // treated as sold/out-of-stock (same tag the app already branches on). Self-
    // healing: add a barcode later and it flips back to in-stock on the next sync.
    inStock: !p.is_sold && Boolean(p.barcode && p.barcode.trim()),
    source: 'connect',
    updatedAt: Date.now(),
  }
}

/**
 * Push a single product's current state to the customer app.
 *  - show_in_app OFF  → remove it from the customer catalogue.
 *  - show_in_app ON   → upsert the sanitized doc (active reflects in-stock).
 * Returns what happened so the caller can surface it.
 */
export async function syncProductToApp(productId: string): Promise<{ action: 'upserted' | 'removed'; priceHidden?: boolean }> {
  const [{ data: product, error: pErr }, { data: imgs }] = await Promise.all([
    supabaseAdmin.from('wa_products').select('*').eq('id', productId).single(),
    supabaseAdmin
      .from('wa_product_images')
      .select('*')
      .eq('product_id', productId),
  ])
  if (pErr || !product) throw new Error(pErr?.message || 'Product not found')

  const p = product as WaProduct & { show_in_app?: boolean }
  const ref = customerDb().collection('catalogue').doc(productId)

  if (!p.show_in_app) {
    await ref.delete().catch(() => {}) // idempotent — fine if it was never published
    return { action: 'removed' }
  }

  const doc = buildDoc(p, (imgs as WaProductImage[] | null) ?? [])
  await ref.set(doc, { merge: true })
  // Stamp the sync time on the source row (best-effort).
  await supabaseAdmin
    .from('wa_products')
    .update({ app_synced_at: new Date().toISOString() })
    .eq('id', productId)
  return { action: 'upserted', priceHidden: doc.priceHidden }
}

/** Remove a product from the customer catalogue (used when the source row is deleted). */
export async function removeProductFromApp(productId: string): Promise<void> {
  await customerDb().collection('catalogue').doc(productId).delete().catch(() => {})
}

/** Re-push every currently-published product (safety net / bulk re-sync). */
export async function resyncAllPublished(): Promise<{ count: number }> {
  const { data } = await supabaseAdmin.from('wa_products').select('id').eq('show_in_app', true)
  const ids = (data ?? []).map((r) => (r as { id: string }).id)
  for (const id of ids) {
    await syncProductToApp(id).catch((e) => console.error('[catalogue-sync] failed', id, e))
  }
  return { count: ids.length }
}
