import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Import the customer-app user list (exported from the app-admin side) onto the
// contact spine. Each row raises contacts.app_user / has_scheme (wa_053), which
// the feature view exposes so every rule/chip audience can target them.
//
// This writes ONLY to `contacts` — an app user need not be a billing customer,
// so we do NOT create wa_b_customers rows (that would pollute the sales universe).
// A brand-new phone becomes a targetable spine contact; an existing one is
// flagged in place. Opt-out and names from other sources are preserved (upsert
// touches only the app columns + name when the row is new).
//
// Client parses the CSV and POSTs rows (optionally in chunks). Expected columns:
//   phone (required) · is_app_user (default true) · has_scheme (default false)
//
// We intentionally do NOT import names here: names on the spine come from chat /
// sales / billing (contact_pick_name), and clobbering them from an app export
// would be a regression. An app-only contact simply shows its phone until one of
// those sources names it.

interface RawRow {
  phone?: string
  is_app_user?: string | boolean
  has_scheme?: string | boolean
}

function normPhone(raw: string | undefined): string | null {
  const d = (raw ?? '').replace(/\D/g, '')
  const ten = d.length > 10 && d.startsWith('91') ? d.slice(-10) : d
  return ten.length === 10 && '6789'.includes(ten[0]) ? ten : null
}
// Tolerant boolean with an explicit default: an app-users export lists users, so
// is_app_user defaults TRUE unless a row explicitly says otherwise.
function bool(v: string | boolean | undefined, def: boolean): boolean {
  if (v == null || v === '') return def
  if (typeof v === 'boolean') return v
  const t = String(v).trim().toLowerCase()
  if (['true', '1', 'yes', 'y'].includes(t)) return true
  if (['false', '0', 'no', 'n'].includes(t)) return false
  return def
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

  const { rows } = (await req.json()) as { rows: RawRow[] }
  if (!Array.isArray(rows) || rows.length === 0) {
    return Response.json({ error: 'No rows' }, { status: 400 })
  }

  // De-dupe within the batch, keep only valid phones.
  const byPhone = new Map<string, RawRow>()
  for (const r of rows) {
    const p = normPhone(r.phone)
    if (p) byPhone.set(p, r)
  }
  const phones = [...byPhone.keys()]
  if (phones.length === 0) return Response.json({ imported: 0, skipped: rows.length })

  // Uniform column set (phone + the two app flags), so the upsert never nulls or
  // clobbers anything else on an existing spine row.
  const upsertRows = phones.map(p => {
    const r = byPhone.get(p)!
    return {
      phone: p,
      app_user: bool(r.is_app_user, true),
      has_scheme: bool(r.has_scheme, false),
    }
  })

  // Upsert in chunks. onConflict: phone — app_user/has_scheme are the app's
  // authoritative truth, so overwriting just those on an existing row is correct.
  let imported = 0
  for (let i = 0; i < upsertRows.length; i += 500) {
    const chunk = upsertRows.slice(i, i + 500)
    const { error } = await supabaseAdmin
      .from('contacts')
      .upsert(chunk, { onConflict: 'phone' })
    if (error) return Response.json({ error: error.message, imported }, { status: 500 })
    imported += chunk.length
  }

  return Response.json({ imported, skipped: rows.length - imported })
}
