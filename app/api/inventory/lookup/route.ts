import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { mapStatus } from '@/lib/inventory-import'

// Barcode autocomplete for Add+ / attach-barcode.
// Auth: any signed-in staff user.  GET ?q=<barcode prefix>&limit=8
// Returns matching inventory pieces with the CLEAN name + CLEAN purity resolved from
// the maps (what should prefill the form), and whether a product card already exists.

const MAX = 12

type InvRow = {
  barcode: string; itm_id: number | null; item_name_raw: string | null
  party_id: number | null; purity_raw: string | null; net_weight: number | null
  bcm_status: string | null; design_raw: string | null
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 8, MAX)
  if (q.length < 2) return Response.json({ results: [] })

  // Prefix match (case-insensitive). Escape LIKE metacharacters in the user input.
  const esc = q.replace(/[\\%_]/g, m => '\\' + m)
  const { data, error } = await supabase
    .from('wa_inventory')
    .select('barcode, itm_id, item_name_raw, party_id, purity_raw, net_weight, bcm_status, design_raw')
    .ilike('barcode', `${esc}%`)
    .order('barcode')
    .limit(limit)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  const rows = (data ?? []) as InvRow[]
  if (rows.length === 0) return Response.json({ results: [] })

  // Resolve clean names (by itm_id) and clean purities (by normalized raw) from the maps,
  // plus whether each barcode is already a product card.
  const itmIds = [...new Set(rows.map(r => r.itm_id).filter((n): n is number => n != null))]
  const purityKeys = [...new Set(rows.map(r => (r.purity_raw ?? '').trim().toLowerCase()).filter(Boolean))]
  const barcodes = rows.map(r => r.barcode)

  const [nameMap, purityMap, prods] = await Promise.all([
    itmIds.length ? supabase.from('wa_item_name_map').select('itm_id, clean_name').in('itm_id', itmIds) : Promise.resolve({ data: [] }),
    purityKeys.length ? supabase.from('wa_purity_map').select('raw_key, clean').in('raw_key', purityKeys) : Promise.resolve({ data: [] }),
    supabase.from('wa_products').select('id, barcode').in('barcode', barcodes),
  ])

  const nameByItm = new Map(((nameMap.data ?? []) as Array<{ itm_id: number; clean_name: string }>).map(r => [r.itm_id, r.clean_name]))
  const cleanByPurity = new Map(((purityMap.data ?? []) as Array<{ raw_key: string; clean: string }>).map(r => [r.raw_key, r.clean]))
  const prodByBarcode = new Map(((prods.data ?? []) as Array<{ id: string; barcode: string | null }>)
    .filter(p => p.barcode).map(p => [p.barcode!.toLowerCase(), p.id]))

  const results = rows.map(r => {
    const pKey = (r.purity_raw ?? '').trim().toLowerCase()
    const existingId = prodByBarcode.get(r.barcode.toLowerCase()) ?? null
    return {
      barcode: r.barcode,
      itmId: r.itm_id,
      itemNameRaw: r.item_name_raw,
      cleanName: r.itm_id != null ? (nameByItm.get(r.itm_id) ?? null) : null,
      purityRaw: r.purity_raw,
      cleanPurity: (pKey && cleanByPurity.get(pKey)) || r.purity_raw || null,
      partyId: r.party_id,
      designRaw: r.design_raw,
      weight: r.net_weight,
      bcmStatus: r.bcm_status,
      stockStatus: mapStatus(r.bcm_status),
      existsAsProduct: existingId != null,
      productId: existingId,
    }
  })

  return Response.json({ results })
}
