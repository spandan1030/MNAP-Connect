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

  let body: { token?: string; birthdayMonth?: unknown; anniversaryMonth?: unknown; rating?: unknown; reason?: unknown; opened?: unknown; visited?: unknown }
  try { body = await req.json() } catch { return Response.json({ error: 'Bad JSON' }, { status: 400 }) }

  const token = (body.token ?? '').toString()
  if (!token) return Response.json({ error: 'token required' }, { status: 400 })

  // The test-send preview publishes a sample bill under this fixed token but
  // intentionally has NO wa_invoices row (no ledger, fake PII) and lands on the
  // admin's own number. Accept its feedback as a successful no-op so the preview
  // UX completes instead of 404ing — there is no real customer to attribute a
  // birthday / anniversary / review to, and we must not write it to a real contact.
  if (token === 'test-preview') return Response.json({ ok: true, test: true })

  // Map token -> phone (+ name/bill for context). Unknown token = reject.
  const { data: inv } = await supabaseAdmin
    .from('wa_invoices').select('phone, bill_no, customer_name').eq('token', token).maybeSingle()
  if (!inv?.phone) return Response.json({ error: 'Unknown token' }, { status: 404 })
  const phone = tenDigit(inv.phone)

  const bMonth = month(body.birthdayMonth)
  const aMonth = month(body.anniversaryMonth)
  const rating = typeof body.rating === 'number' ? body.rating : parseInt(String(body.rating ?? ''), 10)
  const hasRating = Number.isInteger(rating) && rating >= 1 && rating <= 5

  // Birthday / anniversary -> the contact spine (the promotable customer book),
  // keyed by phone. Normally the contact already exists (created by the Call
  // Control sales import of the same file), so we just UPDATE the month fields —
  // never touching the name / opt-out / provenance columns. If no contact exists
  // yet, CREATE a minimal but NAMED, targetable one from the invoice identity
  // (billing name + from_sales), so a birthday never lands on a nameless row.
  if (bMonth || aMonth) {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (bMonth) patch.birthday_month = bMonth
    if (aMonth) patch.anniversary_month = aMonth

    const { data: updated, error: uErr } = await supabaseAdmin
      .from('contacts').update(patch).eq('phone', phone).select('id')
    if (uErr) return Response.json({ error: uErr.message }, { status: 500 })

    if (!updated || updated.length === 0) {
      const cleanName = inv.customer_name && inv.customer_name !== 'Unknown' ? inv.customer_name : null
      const insert: Record<string, unknown> = {
        phone, billing_name: inv.customer_name ?? null, name: cleanName, from_sales: true,
      }
      if (bMonth) insert.birthday_month = bMonth
      if (aMonth) insert.anniversary_month = aMonth
      const { error: iErr } = await supabaseAdmin.from('contacts').insert(insert)
      if (iErr) return Response.json({ error: iErr.message }, { status: 500 })
    }
  }

  // Review feedback -> its own log (one row per submission).
  if (hasRating) {
    const reason = body.reason ? String(body.reason).slice(0, 500) : null
    const { error } = await supabaseAdmin.from('wa_customer_feedback')
      .insert({ phone, bill_no: inv.bill_no ?? null, rating, reason })
    if (error) return Response.json({ error: error.message }, { status: 500 })
  }

  // Per-bill engagement stamps on the invoice row itself, so the invoice report can
  // show — per customer, per bill — reviewed? / birthday? / anniversary? Keyed by
  // token (already validated above). Best-effort: a stamp failure never fails the
  // feedback (the contact spine + feedback log are the source of truth).
  const nowISO = new Date().toISOString()
  const invStamp: Record<string, unknown> = {}
  if (bMonth) invStamp.birthday_submitted_at = nowISO
  if (aMonth) invStamp.anniversary_submitted_at = nowISO
  if (hasRating) { invStamp.reviewed_at = nowISO; invStamp.review_rating = rating }
  if (Object.keys(invStamp).length) {
    await supabaseAdmin.from('wa_invoices').update(invStamp).eq('token', token)
  }

  // Engagement pings from the Bill Summary page (Phase 2). WRITE-ONCE — the .is(...
  // null) guard means a re-open / re-click never overwrites the first timestamp, so
  // these can't be spammed into churning the row (ties into the security backlog's
  // "feedback tampering/flood" note — first signal wins, later ones are a no-op).
  //   · opened  — the page loaded (fired client-side post-hydration). WhatsApp gives
  //               no button-tap callback, so this is our "clicked the link" proxy.
  //   · visited — they tapped an Explore / scheme / contact link off the page.
  if (body.opened === true) {
    await supabaseAdmin.from('wa_invoices').update({ opened_at: nowISO }).eq('token', token).is('opened_at', null)
  }
  if (body.visited === true) {
    await supabaseAdmin.from('wa_invoices').update({ website_visited_at: nowISO }).eq('token', token).is('website_visited_at', null)
  }

  return Response.json({ ok: true })
}
