import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { randomBytes } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Import per-invoice records from the raw billing-ERP export (JSP_RTL_INVC + _ORN).
// The export is Bill×Barcode grained — one row per item, many rows per bill — so
// this route GROUPS rows by bill number (RI_VRNO) into one wa_invoices row with a
// line_items array. Insert-new-only by bill_no: re-importing a bill is a no-op, so
// tokens and send state are never disturbed.
//
// Client parses the CSV and POSTs rows (in chunks). One caveat with chunking: all
// rows of a given bill MUST arrive in the same chunk, or the bill would be split.
// The client groups by bill first and chunks on whole bills (see the import page),
// so a chunk never cuts a bill in half.
//
// Expected columns (raw ERP names, only the ones we render):
//   RI_VRNO RI_DATE RI_CST_NAME RI_PHN_NO RI_AMT RI_TAX_AMT RI_NET_AMT OA_AMT AR_AMT
//   ITM_NAME PURT_NAME RIO_NET_WT BCM_BRCD RIO_TOTAL_AMT RIO_SALE_TYPE
//
// RIO_SALE_TYPE ('Sale' | 'Return') tells sale items apart from a NEW item the
// customer handed back (a sales return). The bill total foots as Σ Sale − Σ Return,
// so a Return line is stored with a NEGATIVE amount. (This is unrelated to old-gold
// exchange, OA_AMT, which is a payment method, not an item.)

interface RawRow {
  RI_VRNO?: string
  RI_DATE?: string
  RI_CST_NAME?: string
  RI_PHN_NO?: string
  RI_AMT?: string
  RI_TAX_AMT?: string
  RI_NET_AMT?: string
  OA_AMT?: string
  AR_AMT?: string
  ITM_NAME?: string
  PURT_NAME?: string
  RIO_NET_WT?: string
  BCM_BRCD?: string
  RIO_TOTAL_AMT?: string
  RIO_SALE_TYPE?: string
}

function normPhone(raw: string | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '')
  const ten = d.length > 10 && d.startsWith('91') ? d.slice(-10) : d
  return ten.length === 10 && '6789'.includes(ten[0]) ? ten : null
}
function num(v: string | undefined): number | null {
  if (v == null || String(v).trim() === '') return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}
// The client sends ISO (YYYY-MM-DD) after the cellDates fix, but be liberal so a
// format quirk never silently nulls a whole import: also accept DD-MM-YYYY /
// DD.MM.YYYY, DD-Mon-YYYY, and Excel date serials. Returns YYYY-MM-DD or null.
function dateISO(v: unknown): string | null {
  if (v == null) return null
  // Excel date serial (a bare number or numeric string in a sane range, ~1954–2119).
  if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v).trim())) {
    const n = Number(v)
    if (n > 20000 && n < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000)
      return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
    }
  }
  const s = String(v).trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)                     // ISO (optionally with time)
  let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)                     // DD-MM-YYYY / DD.MM.YYYY
  if (m) { const [, d, mo, y] = m; return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}` }
  m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{2,4})$/)                 // DD-Mon-YYYY
  if (m) {
    const mo = MONTHS[m[2].toLowerCase().slice(0, 3)]
    if (mo) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${mo}-${m[1].padStart(2, '0')}` }
  }
  return null
}
// 128-bit URL-safe capability token.
function newToken(): string {
  return randomBytes(16).toString('base64url')
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { rows, batch, update } = (await req.json()) as { rows: RawRow[]; batch?: string; update?: boolean }
  if (!Array.isArray(rows) || rows.length === 0) {
    return Response.json({ error: 'No rows' }, { status: 400 })
  }

  // Group item rows by bill number. Header fields come from the first row of the
  // bill (they repeat identically across a bill's rows); items accumulate.
  interface Grouped {
    bill_no: string
    phone: string | null
    header: RawRow
    items: Array<{ item: string | null; purity: string | null; net_wt: number | null; barcode: string | null; amount: number | null; sale_type: 'sale' | 'return' }>
  }
  const byBill = new Map<string, Grouped>()
  let noPhone = 0
  for (const r of rows) {
    const bill = (r.RI_VRNO ?? '').trim()
    if (!bill) continue
    let g = byBill.get(bill)
    if (!g) {
      g = { bill_no: bill, phone: normPhone(r.RI_PHN_NO), header: r, items: [] }
      byBill.set(bill, g)
    }
    const name = (r.ITM_NAME ?? '').trim()
    const barcode = (r.BCM_BRCD ?? '').trim() || null
    const netWt = num(r.RIO_NET_WT)
    const rawAmt = num(r.RIO_TOTAL_AMT)
    // A NEW item the customer handed back — subtracts from the bill.
    const isReturn = (r.RIO_SALE_TYPE ?? '').trim().toLowerCase().includes('return')
    // A real item line carries at least one item-level field. A row with only
    // bill-level totals (blank item detail) is header-only → contributes no line.
    if (name || barcode || rawAmt != null || netWt != null) {
      g.items.push({
        item: name || null,                       // page renders "Item" when null (placeholder)
        purity: (r.PURT_NAME ?? '').trim() || null,
        net_wt: netWt,
        barcode,
        // Store returns negative so the line items foot to RI_NET_AMT (Σ Sale − Σ Return).
        amount: rawAmt == null ? null : (isReturn ? -Math.abs(rawAmt) : rawAmt),
        sale_type: isReturn ? 'return' : 'sale',
      })
    }
  }

  // Drop bills we can't message (no valid phone) — parked as skipped.
  const bills = [...byBill.values()].filter(g => {
    if (!g.phone) { noPhone++; return false }
    return true
  })
  if (bills.length === 0) {
    return Response.json({ imported: 0, bills: 0, skippedNoPhone: noPhone })
  }

  // Fetch existing bills (by bill_no). In default mode they're skipped (insert-new
  // only, so tokens + send state are untouched); in update mode their content is
  // refreshed while the token + send lifecycle are preserved.
  const billNos = bills.map(g => g.bill_no)
  interface ExistingRow {
    bill_no: string; token: string
    sent_at: string | null; published_at: string | null; expires_at: string | null; created_at: string
    line_items: unknown
  }
  const existing = new Map<string, ExistingRow>()
  for (let i = 0; i < billNos.length; i += 500) {
    const { data, error } = await supabaseAdmin
      .from('wa_invoices')
      .select('bill_no, token, sent_at, published_at, expires_at, created_at, line_items')
      .in('bill_no', billNos.slice(i, i + 500))
    if (error) return Response.json({ error: error.message }, { status: 500 })
    for (const r of (data ?? []) as ExistingRow[]) existing.set(r.bill_no, r)
  }

  // The parsed content of a bill (everything except identity + send lifecycle).
  function contentOf(g: Grouped) {
    const h = g.header
    const net = num(h.RI_NET_AMT)
    const oldMetal = num(h.OA_AMT)
    const advance = num(h.AR_AMT)
    const payable = net == null ? null : net - (oldMetal ?? 0) - (advance ?? 0)
    return {
      phone: g.phone!,
      customer_name: (h.RI_CST_NAME ?? '').trim() || null,
      invoice_date: dateISO(h.RI_DATE),
      amount_before_tax: num(h.RI_AMT),
      tax_amount: num(h.RI_TAX_AMT),
      net_amount: net,
      old_metal_amount: oldMetal,
      advance_amount: advance,
      payable,
      line_items: g.items,
      import_batch: batch ?? null,
    }
  }

  const fresh = bills.filter(g => !existing.has(g.bill_no))
  const insertRows = fresh.map(g => ({
    bill_no: g.bill_no,
    token: newToken(),
    ...contentOf(g),
    imported_by: user.id,
  }))

  // Diagnostic: how many freshly-imported bills got a real date vs null. A high
  // datesNull count means the date column didn't parse (surfaced in the UI).
  const datesParsed = insertRows.filter(r => r.invoice_date != null).length
  const datesNull = insertRows.length - datesParsed

  let imported = 0
  for (let i = 0; i < insertRows.length; i += 500) {
    const chunk = insertRows.slice(i, i + 500)
    // onConflict do-nothing guards the rare race where the same bill lands twice.
    const { error } = await supabaseAdmin
      .from('wa_invoices').upsert(chunk, { onConflict: 'bill_no', ignoreDuplicates: true })
    if (error) return Response.json({ error: error.message, imported }, { status: 500 })
    imported += chunk.length
  }

  // ── Update mode: refresh content on bills that already exist ─────────────────
  // A corrected re-export can backfill items / fix returns on bills imported
  // earlier. We rewrite ONLY the parsed content and carry the existing token +
  // send lifecycle back unchanged (so nothing re-sends), and never replace real
  // items with an empty list — so re-uploading an older, item-less export can't
  // wipe good data.
  let updated = 0
  if (update) {
    const stale = bills.filter(g => existing.has(g.bill_no))
    const updateRows = stale.map(g => {
      const ex = existing.get(g.bill_no)!
      const content = contentOf(g)
      const oldItems = Array.isArray(ex.line_items) ? ex.line_items : []
      const line_items = content.line_items.length === 0 && oldItems.length > 0 ? oldItems : content.line_items
      return {
        bill_no: g.bill_no,
        token: ex.token,               // preserve capability token
        ...content,
        line_items,
        sent_at: ex.sent_at,           // preserve send lifecycle — never re-send
        published_at: ex.published_at,
        expires_at: ex.expires_at,
        created_at: ex.created_at,
      }
    })
    for (let i = 0; i < updateRows.length; i += 500) {
      const chunk = updateRows.slice(i, i + 500)
      const { error } = await supabaseAdmin
        .from('wa_invoices').upsert(chunk, { onConflict: 'bill_no' })
      if (error) return Response.json({ error: error.message, imported, updated }, { status: 500 })
      updated += chunk.length
    }
  }

  return Response.json({
    imported,
    updated,
    bills: bills.length,
    alreadyPresent: bills.length - fresh.length,
    skippedNoPhone: noPhone,
    datesParsed,
    datesNull,
  })
}
