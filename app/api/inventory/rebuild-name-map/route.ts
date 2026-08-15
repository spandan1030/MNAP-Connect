import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { majorityVoteNames, type ProductNameSample } from '@/lib/inventory-maps'

// Rebuild wa_item_name_map by majority vote from products that already carry a real
// barcode (joined to wa_inventory for their ITM_ID). Manually-set mappings are kept.
// Auth: any signed-in staff user.  POST (no body)

const PAGE = 1000
const CHUNK = 300

type Prod = { barcode: string | null; item_name: string | null }

export async function POST(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // 1) Products with a barcode AND a curated item name (the votes).
  const prods: Prod[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('wa_products')
      .select('barcode, item_name')
      .not('barcode', 'is', null)
      .not('item_name', 'is', null)
      .range(from, from + PAGE - 1)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    const rows = (data ?? []) as Prod[]
    prods.push(...rows)
    if (rows.length < PAGE) break
  }
  const named = prods.filter(p => p.barcode && (p.item_name ?? '').trim())
  if (named.length === 0) {
    return Response.json({ ok: true, mapped: 0, productsConsidered: 0, matched: 0, preservedManual: 0, note: 'No barcoded products with a name to learn from yet.' })
  }

  // 2) Resolve each product's ITM_ID via the inventory master (chunked barcode lookup).
  const barcodes = [...new Set(named.map(p => p.barcode!.toLowerCase()))]
  const itmByBarcode = new Map<string, number>()
  const rawByItm = new Map<number, string>()
  for (let i = 0; i < barcodes.length; i += CHUNK) {
    const slice = barcodes.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('wa_inventory')
      .select('barcode, itm_id, item_name_raw')
      .in('barcode', slice)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    for (const r of (data ?? []) as Array<{ barcode: string; itm_id: number | null; item_name_raw: string | null }>) {
      if (r.itm_id == null) continue
      itmByBarcode.set(r.barcode.toLowerCase(), r.itm_id)
      if (r.item_name_raw && !rawByItm.has(r.itm_id)) rawByItm.set(r.itm_id, r.item_name_raw)
    }
  }

  // 3) Majority vote per ITM_ID.
  const samples: ProductNameSample[] = []
  for (const p of named) {
    const itmId = itmByBarcode.get(p.barcode!.toLowerCase())
    if (itmId == null) continue
    samples.push({ itmId, cleanName: p.item_name!.trim() })
  }
  const mappings = majorityVoteNames(samples)

  // 4) Don't clobber owner-set (manual) mappings.
  const { data: manualRows } = await supabase.from('wa_item_name_map').select('itm_id').eq('source', 'manual')
  const manual = new Set(((manualRows ?? []) as Array<{ itm_id: number }>).map(r => r.itm_id))

  const now = new Date().toISOString()
  const payload = mappings
    .filter(m => !manual.has(m.itm_id))
    .map(m => ({
      itm_id: m.itm_id,
      clean_name: m.clean_name,
      source: 'seed' as const,
      sample_raw: rawByItm.get(m.itm_id) ?? null,
      hits: m.hits,
      updated_by: user.id,
      updated_at: now,
    }))

  for (let i = 0; i < payload.length; i += 500) {
    const slice = payload.slice(i, i + 500)
    const { error } = await supabase.from('wa_item_name_map').upsert(slice, { onConflict: 'itm_id' })
    if (error) return Response.json({ error: `Map write failed: ${error.message}` }, { status: 500 })
  }

  return Response.json({
    ok: true,
    mapped: payload.length,
    productsConsidered: named.length,
    matched: samples.length,
    itemsCovered: mappings.length,
    preservedManual: manual.size,
  })
}
