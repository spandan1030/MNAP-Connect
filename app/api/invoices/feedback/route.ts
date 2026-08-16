import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Ingest birthday/anniversary + review feedback captured on the customer app's
// Bill Summary page. Shared-secret gated (same secret as the publish direction:
// customer's INVOICE_PUBLISH_SECRET === connect's CUSTOMER_APP_PUBLISH_SECRET).
//
// The customer app posts the invoice TOKEN, never the phone. We map token -> phone
// via wa_invoices, so identity stays server-side on both apps.
//   POST { token, birthdayMonth?, anniversaryMonth?, rating?, reason? }
//   header: x-publish-secret

function tenDigit(raw: string): string {
  const d = (raw ?? '').replace(/\D/g, '')
  return d.length > 10 && d.startsWith('91') ? d.slice(-10) : d
}
function month(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-publish-secret')
  if (!secret || secret !== process.env.CUSTOMER_APP_PUBLISH_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { token?: string; birthdayMonth?: unknown; anniversaryMonth?: unknown; rating?: unknown; reason?: unknown }
  try { body = await req.json() } catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }) }

  const token = (body.token ?? '').toString()
  if (!token) return Response.json({ error: 'token required' }, { status: 400 })

  // Map token -> phone (+ bill for review context). Unknown token = reject.
  const { data: inv } = await supabaseAdmin
    .from('wa_invoices').select('phone, bill_no').eq('token', token).maybeSingle()
  if (!inv?.phone) return Response.json({ error: 'Unknown token' }, { status: 404 })
  const phone = tenDigit(inv.phone)

  const bMonth = month(body.birthdayMonth)
  const aMonth = month(body.anniversaryMonth)
  const rating = typeof body.rating === 'number' ? body.rating : parseInt(String(body.rating ?? ''), 10)
  const hasRating = Number.isInteger(rating) && rating >= 1 && rating <= 5

  // Birthday / anniversary -> the contact spine (only overwrite provided fields).
  if (bMonth || aMonth) {
    const patch: Record<string, unknown> = { phone }
    if (bMonth) patch.birthday_month = bMonth
    if (aMonth) patch.anniversary_month = aMonth
    const { error } = await supabaseAdmin.from('contacts').upsert(patch, { onConflict: 'phone' })
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  // Review feedback -> its own log (one row per submission).
  if (hasRating) {
    const reason = body.reason ? String(body.reason).slice(0, 500) : null
    const { error } = await supabaseAdmin.from('wa_customer_feedback')
      .insert({ phone, bill_no: inv.bill_no ?? null, rating, reason })
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
