import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncProductToApp } from '@/lib/catalogue-sync'
import { parseInventoryWorkbook, mapStatus, type InventoryRow } from '@/lib/inventory-import'
import type { StockStatus } from '@/lib/types'

// Inventory master import (from the store software's item-status xlsx).
// Auth: any signed-in staff user.
//   POST multipart/form-data { file, mode: 'preview' | 'apply' }
//
// This ONLY populates the wa_inventory master (reference data for Add+ prefill) and
// refreshes stock_status on product cards that ALREADY exist (matched by barcode).
// It never creates product cards and never changes app publishing (show_in_app).
//
//   preview → parse + report what an apply would change (no writes)
//   apply   → upsert wa_inventory + update matched product stock_status + re-sync
//             the published ones (their app doc carries the new status)

const CHUNK = 500

type ProductRow = {
  id: string
  barcode: string | null
  design_code: string | null
  item_name: string | null
  stock_status: StockStatus | null
  show_in_app: boolean | null
}

// wa_products is the curated subset (small), but may exceed the 1000-row page cap.
async function fetchBarcodedProducts(supabase: Awaited<ReturnType<typeof createClient>>): Promise<ProductRow[]> {
  const out: ProductRow[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from('wa_products')
      .select('id, barcode, design_code, item_name, stock_status, show_in_app')
      .not('barcode', 'is', null)
      .range(from, from + page - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as ProductRow[]
    out.push(...rows)
    if (rows.length < page) break
  }
  return out
}

// A product card whose barcode is in the file and whose mapped status differs.
interface StatusChange {
  id: string
  barcode: string
  design_code: string | null
  item_name: string | null
  from: StockStatus | null
  to: StockStatus
  published: boolean
}

function computeChanges(products: ProductRow[], fileByBarcode: Map<string, InventoryRow>): StatusChange[] {
  const changes: StatusChange[] = []
  for (const p of products) {
    if (!p.barcode) continue
    const row = fileByBarcode.get(p.barcode.toLowerCase())
    if (!row) continue
    const to = mapStatus(row.bcm_status)
    if (!to || to === (p.stock_status ?? 'in_stock')) continue
    changes.push({
      id: p.id, barcode: p.barcode, design_code: p.design_code, item_name: p.item_name,
      from: p.stock_status ?? null, to, published: Boolean(p.show_in_app),
    })
  }
  return changes
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let form: FormData
  try { form = await req.formData() } catch { return Response.json({ error: 'Expected a file upload' }, { status: 400 }) }
  const file = form.get('file')
  const mode = String(form.get('mode') ?? 'preview')
  if (!(file instanceof File)) return Response.json({ error: 'No file provided' }, { status: 400 })

  let parsed
  try {
    const buf = Buffer.from(await file.arrayBuffer())
    parsed = parseInventoryWorkbook(buf)
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Could not read the file' }, { status: 400 })
  }
  if (parsed.rows.length === 0) return Response.json({ error: 'No rows with a barcode were found.' }, { status: 400 })

  const fileByBarcode = new Map(parsed.rows.map(r => [r.barcode.toLowerCase(), r]))

  // Mapped-status tally (what the three known statuses resolve to) + unmapped count.
  const mapped = { in_stock: 0, sold: 0, deleted: 0, unmapped: 0 }
  for (const r of parsed.rows) {
    const s = mapStatus(r.bcm_status)
    if (s) mapped[s]++
    else mapped.unmapped++
  }

  let products: ProductRow[]
  try { products = await fetchBarcodedProducts(supabase) } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Failed to read products' }, { status: 500 })
  }
  const changes = computeChanges(products, fileByBarcode)
  const matched = products.filter(p => p.barcode && fileByBarcode.has(p.barcode.toLowerCase())).length

  const summary = {
    fileName: file.name,
    totalRows: parsed.totalRows,
    valid: parsed.rows.length,
    skipped: parsed.skipped,
    duplicates: parsed.duplicates,
    statusCounts: parsed.statusCounts,
    mapped,
    productImpact: {
      matched,
      statusChanges: changes.length,
      publishedAffected: changes.filter(c => c.published).length,
      sample: changes.slice(0, 25).map(c => ({
        designCode: c.design_code, barcode: c.barcode, itemName: c.item_name,
        from: c.from ?? 'in_stock', to: c.to, published: c.published,
      })),
    },
  }

  if (mode === 'preview') {
    return Response.json({ ok: true, mode: 'preview', summary })
  }

  if (mode !== 'apply') return Response.json({ error: 'Unknown mode' }, { status: 400 })

  // ── APPLY ────────────────────────────────────────────────────────────────
  const now = new Date().toISOString()

  // 1) Upsert the inventory master in chunks (last-wins on barcode).
  let upserted = 0
  const rows = parsed.rows.map(r => ({ ...r, source_file: file.name, updated_at: now }))
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const { error } = await supabase.from('wa_inventory').upsert(slice, { onConflict: 'barcode' })
    if (error) return Response.json({ error: `Inventory write failed: ${error.message}` }, { status: 500 })
    upserted += slice.length
  }

  // 2) Update matched product cards' stock_status, is_sold in lockstep. Publishing
  //    (show_in_app) is never touched. Group by target status for bulk updates.
  const byTarget: Record<StockStatus, string[]> = { in_stock: [], sold: [], deleted: [] }
  for (const c of changes) byTarget[c.to].push(c.id)
  let productsUpdated = 0
  for (const status of ['in_stock', 'sold', 'deleted'] as StockStatus[]) {
    const ids = byTarget[status]
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK)
      const { error } = await supabase.from('wa_products')
        .update({ stock_status: status, is_sold: status === 'sold', updated_at: now })
        .in('id', slice)
      if (error) return Response.json({ error: `Product update failed: ${error.message}` }, { status: 500 })
      productsUpdated += slice.length
    }
  }

  // 3) Re-sync the published ones so their app doc carries the new status.
  let resynced = 0
  for (const c of changes) {
    if (!c.published) continue
    try { await syncProductToApp(c.id); resynced++ } catch (e) {
      console.error('[inventory/import] resync failed', c.id, e)
    }
  }

  return Response.json({
    ok: true, mode: 'apply',
    applied: { inventoryUpserted: upserted, productsUpdated, resynced },
    summary,
  })
}
