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
  designCode: string | null  // app-facing per-piece code (MN000001…). The raw barcode is NEVER sent.
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
  status: 'in_stock' | 'sold' | 'deleted' | 'catalogue' // richer per-piece status the app renders
  inStock: boolean        // convenience: status === 'in_stock' (kept for the app's current branching)
  catalogueOnly: boolean  // design-only product (not physical stock) — app can give it its own treatment
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
  // Physical stock status from the inventory import. Fall back to the legacy is_sold
  // flag for rows imported before wa_058. A catalogue/design-only piece reports its
  // own 'catalogue' status regardless of stock.
  const stock = p.stock_status ?? (p.is_sold ? 'sold' : 'in_stock')
  const status: CatalogueDoc['status'] = p.is_catalogue_only ? 'catalogue' : stock
  return {
    title: (p.app_title?.trim() || p.item_name || 'Jewellery').toString(),
    description: (p.app_description?.trim() || p.description || '').toString(),
    category: (p.item_name || '').toString(),
    // App-facing code only. The raw barcode is intentionally never sent (sensitive).
    designCode: p.design_code ?? null,
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
    // Stays in the customer catalogue while published + active. Sold/deleted pieces are
    // NOT hidden — they remain visible carrying their status so the app can show a
    // "Sold"/updated treatment instead of dropping the piece. Publishing is toggle-only.
    active: Boolean(p.show_in_app) && p.is_active,
    // Richer status the app renders; branching order: catalogueOnly → status → normal.
    status,
    // "In stock" = physically available. Catalogue-only pieces still publish with a live
    // price; they carry catalogueOnly:true so the app can give them a dedicated treatment.
    inStock: stock === 'in_stock' && !p.is_catalogue_only,
    catalogueOnly: Boolean(p.is_catalogue_only),
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
