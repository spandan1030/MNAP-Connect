import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { INTEREST_KEYS } from '@/lib/signals'

// Scheduled follow-ups (wa_070). A salesman schedules a contact for a customer in
// X days, with what they wanted (canonical interest keys) + a note. Created from
// the chat or the walk-in form; listed in the Follow-ups module.
//   POST  { phone, customerId?, salesmanId?, dueInDays, interests?, note? }
//   GET   ?scope=pending  -> rows (due first) + display name + salesman alias
//   PATCH { id, action: 'done'|'cancel'|'reschedule', dueInDays? }

function tenDigit(raw: string): string {
  const d = (raw ?? '').replace(/\D/g, '')
  return d.length > 10 && d.startsWith('91') ? d.slice(-10) : d
}
// today (server) + n days, as a YYYY-MM-DD date string
function dueOn(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + Math.max(0, Math.round(days || 0)))
  return d.toLocaleDateString('en-CA')
}

async function authed() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function POST(req: NextRequest) {
  const user = await authed()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    phone?: string; customerId?: string; salesmanId?: string
    dueInDays?: number; interests?: string[]; note?: string
  }
  const phone = tenDigit(body.phone ?? '')
  if (phone.length !== 10) return Response.json({ error: 'Invalid phone' }, { status: 400 })
  const days = Number(body.dueInDays)
  if (!Number.isFinite(days) || days < 0) return Response.json({ error: 'Invalid follow-up date' }, { status: 400 })

  const interests = [...new Set((body.interests ?? []).filter(k => INTEREST_KEYS.includes(k)))]

  const { data, error } = await supabaseAdmin.from('wa_followups').insert({
    phone,
    customer_id: body.customerId || null,
    salesman_id: body.salesmanId || null,
    created_by: user.id,
    due_on: dueOn(days),
    interests: interests.length ? interests : null,
    note: (body.note ?? '').trim() || null,
  }).select('id, due_on').single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true, id: data.id, dueOn: data.due_on })
}

export async function GET(req: NextRequest) {
  const user = await authed()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const scope = req.nextUrl.searchParams.get('scope') ?? 'pending'
  let query = supabaseAdmin.from('wa_followups')
    .select('id, phone, customer_id, salesman_id, due_on, interests, note, status, created_at, salesman:salesmen(alias)')
    .order('due_on', { ascending: true }).limit(300)
  if (scope === 'pending') query = query.eq('status', 'pending')

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as unknown as Array<{
    id: string; phone: string; customer_id: string | null; salesman_id: string | null
    due_on: string; interests: string[] | null; note: string | null; status: string; created_at: string
    salesman: { alias: string } | { alias: string }[] | null
  }>

  // Display name: pull from the contact spine in one query.
  const phones = [...new Set(rows.map(r => r.phone))]
  const nameByPhone = new Map<string, string>()
  if (phones.length) {
    const { data: cs } = await supabaseAdmin.from('contacts').select('phone, name').in('phone', phones)
    for (const c of (cs ?? []) as Array<{ phone: string; name: string | null }>) {
      if (c.name) nameByPhone.set(c.phone, c.name)
    }
  }

  const followups = rows.map(r => ({
    id: r.id,
    phone: r.phone,
    name: nameByPhone.get(r.phone) ?? null,
    customerId: r.customer_id,
    dueOn: r.due_on,
    interests: r.interests ?? [],
    note: r.note,
    status: r.status,
    salesman: (Array.isArray(r.salesman) ? r.salesman[0]?.alias : r.salesman?.alias) ?? null,
  }))

  return Response.json({ followups })
}

export async function PATCH(req: NextRequest) {
  const user = await authed()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { id?: string; action?: string; dueInDays?: number }
  if (!body.id) return Response.json({ error: 'Missing id' }, { status: 400 })

  let patch: Record<string, unknown>
  if (body.action === 'done') {
    patch = { status: 'done', done_at: new Date().toISOString(), done_by: user.id }
  } else if (body.action === 'cancel') {
    patch = { status: 'cancelled' }
  } else if (body.action === 'reschedule') {
    const days = Number(body.dueInDays)
    if (!Number.isFinite(days) || days < 0) return Response.json({ error: 'Invalid date' }, { status: 400 })
    patch = { due_on: dueOn(days), status: 'pending' }
  } else {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  }

  const { error } = await supabaseAdmin.from('wa_followups').update(patch).eq('id', body.id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
