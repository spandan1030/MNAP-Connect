import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncProductToApp } from '@/lib/catalogue-sync'

// Bulk stock update: paste barcodes, mark them all Sold or In stock at once.
// Auth: any signed-in staff user (same gate as the rest of the admin app).
//   POST { barcodes: string[] | string, sold: boolean }
// Matches case-insensitively (the barcode unique index is on lower(barcode)),
// flips wa_products.is_sold, and re-syncs any matched pieces that are published.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = (await req.json()) as { barcodes?: unknown; sold?: unknown }
  const sold = Boolean(raw.sold)

  // Accept a ready array or a raw pasted blob; split on commas / whitespace / newlines.
  const input = Array.isArray(raw.barcodes)
    ? raw.barcodes.map(String)
    : String(raw.barcodes ?? '').split(/[\s,]+/)
  const codes = [...new Set(input.map(s => s.trim()).filter(Boolean))]
  if (codes.length === 0) return Response.json({ error: 'No barcodes provided' }, { status: 400 })

  const wanted = new Set(codes.map(c => c.toLowerCase()))

  const { data: rows, error } = await supabase
    .from('wa_products')
    .select('id, barcode, is_sold, show_in_app')
    .not('barcode', 'is', null)
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const byCode = new Map<string, { id: string; barcode: string; is_sold: boolean; show_in_app: boolean }>()
  for (const r of (rows ?? []) as Array<{ id: string; barcode: string; is_sold: boolean; show_in_app: boolean }>) {
    const key = String(r.barcode).trim().toLowerCase()
    if (wanted.has(key)) byCode.set(key, r)
  }

  const notFound  = codes.filter(c => !byCode.has(c.toLowerCase()))
  const matched   = [...byCode.values()]
  const toChange  = matched.filter(r => r.is_sold !== sold)
  const unchanged = matched.length - toChange.length

  if (toChange.length) {
    const { error: uErr } = await supabase
      .from('wa_products')
      .update({ is_sold: sold, updated_at: new Date().toISOString() })
      .in('id', toChange.map(r => r.id))
    if (uErr) return Response.json({ error: uErr.message }, { status: 500 })

    // Re-push any published pieces so the customer app reflects the new stock status.
    for (const r of toChange) {
      if (r.show_in_app) {
        await syncProductToApp(r.id).catch(e => console.error('[catalogue/stock] resync failed', r.id, e))
      }
    }
  }

  return Response.json({
    ok: true,
    sold,
    updated: toChange.length,
    unchanged,
    matched: matched.length,
    notFound,
  })
}
