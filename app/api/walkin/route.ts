import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { INTEREST_KEYS } from '@/lib/signals'

// Walk-in registration — a salesman logs an in-store visitor and the signals
// they showed. Treated exactly like chat/call: the visitor becomes a Type B
// contact (so they're searchable + reachable + peekable via the contact spine),
// and every interest they showed is written to wa_signals with source='walkin'.
// No purchase markers are invented — a walk-in earns those only if they buy.
//   POST { name, phone, interests:[canonical keys], timing?, notes?, isVip? }

function tenDigit(raw: string): string {
  const d = (raw ?? '').replace(/\D/g, '')
  return d.length > 10 && d.startsWith('91') ? d.slice(-10) : d
}

const TIMING_LABEL: Record<string, string> = {
  within_7_days: 'within 7 days', within_1_month: 'within 1 month',
  '1_3_months': '1–3 months', browsing: 'just browsing',
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

  const body = (await req.json().catch(() => ({}))) as {
    name?: string; phone?: string; interests?: string[]; timing?: string; notes?: string; isVip?: boolean; salesmanId?: string
  }
  const name = (body.name ?? '').trim()
  const phone = tenDigit(body.phone ?? '')
  if (!name) return Response.json({ error: 'Name is required.' }, { status: 400 })
  if (phone.length !== 10) return Response.json({ error: 'Enter a valid 10-digit phone number.' }, { status: 400 })

  // Only accept known canonical interest keys (no free text into the signal spine).
  const interests = [...new Set((body.interests ?? []).filter(k => INTEREST_KEYS.includes(k)))]

  const now = new Date().toISOString()
  const timingLabel = body.timing ? (TIMING_LABEL[body.timing] ?? body.timing) : null
  const visitNote = [
    `Walk-in ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`,
    timingLabel ? `buying ${timingLabel}` : null,
    (body.notes ?? '').trim() || null,
  ].filter(Boolean).join(' · ')

  // ── Upsert the Type B contact (contact spine trigger picks it up) ───────────
  const { data: existing } = await supabaseAdmin.from('wa_b_customers')
    .select('id, notes, is_hot_lead').eq('phone', phone).maybeSingle()

  const salesmanId = body.salesmanId || null

  let customerId: string
  let created = false
  if (existing) {
    customerId = existing.id as string
    const patch: Record<string, unknown> = {
      notes: existing.notes ? `${existing.notes}\n${visitNote}` : visitNote,
      walkin_salesman_id: salesmanId, walkin_at: now,
    }
    if (body.isVip && !existing.is_hot_lead) { patch.is_hot_lead = true; patch.hot_lead_at = now }
    await supabaseAdmin.from('wa_b_customers').update(patch).eq('id', customerId)
  } else {
    const { data: cust, error } = await supabaseAdmin.from('wa_b_customers').insert({
      name, phone, enrolled_by: user.id, source: 'walkin', notes: visitNote,
      walkin_salesman_id: salesmanId, walkin_at: now,
      is_hot_lead: !!body.isVip, hot_lead_at: body.isVip ? now : null,
    }).select('id').single()
    if (error || !cust) return Response.json({ error: error?.message ?? 'Could not save walk-in.' }, { status: 500 })
    customerId = cust.id as string
    created = true
  }

  // ── Write the signals (source='walkin'), idempotent on (phone,interest,source) ─
  if (interests.length) {
    const rows = interests.map(interest => ({
      phone, interest, source: 'walkin' as const, weight: 1,
      evidence: timingLabel ? `walk-in (${timingLabel})` : 'walk-in', last_seen: now,
    }))
    const { error } = await supabaseAdmin.from('wa_signals')
      .upsert(rows, { onConflict: 'phone,interest,source' })
    if (error) return Response.json({ error: error.message, customerId }, { status: 500 })
  }

  return Response.json({ customerId, phone, created, signals: interests.length })
}
