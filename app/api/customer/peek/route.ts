import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Customer peek — everything we know about ONE phone, across universes.
//   GET /api/customer/peek?phone=9876543210
// Joins Type B (calls/markers), Type A (chat), unified signals, and the send
// ledger by phone so any number in the app can reveal: who they are, whether
// they're new, their markers + first/last purchase, interests, call history,
// and message history.

function tenDigit(raw: string): string {
  const d = (raw ?? '').replace(/\D/g, '')
  return d.length > 10 && d.startsWith('91') ? d.slice(-10) : d
}

export async function GET(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const phone = tenDigit(req.nextUrl.searchParams.get('phone') ?? '')
  if (phone.length !== 10) return Response.json({ error: 'Invalid phone' }, { status: 400 })

  // Type B customer (the sales-import / call universe) — anchor for markers + calls.
  const { data: bCust } = await supabaseAdmin
    .from('wa_b_customers')
    .select('id, name, source, is_hot_lead, hot_lead_at, is_do_not_call')
    .eq('phone', phone).maybeSingle()

  // Everything else in parallel.
  const [markerRes, aCustRes, signalsRes, ledgerRes, callsRes, contactRes] = await Promise.all([
    bCust
      ? supabaseAdmin.from('wa_b_markers')
          .select('recency_tier,value_tier,rfm_segment,frequency_tier,primary_metal,lifetime_value,total_bills,days_since_last_purchase,first_purchase_date,last_purchase_date,audience_labels,is_high_value,is_likely_wedding,outreach_bucket')
          .eq('customer_id', bCust.id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from('wa_customers').select('id, name, dnd, is_opted_out').eq('phone', phone).maybeSingle(),
    supabaseAdmin.from('wa_signals').select('interest, source, last_seen').eq('phone', phone),
    supabaseAdmin.from('wa_send_ledger')
      .select('meta_template_name, category, status, cohort_label, sent_at, template:wa_message_templates(name)')
      .eq('phone', phone).order('sent_at', { ascending: false }).limit(20),
    bCust
      ? supabaseAdmin.from('wa_b_call_logs')
          .select('success, topics, intent, called_at')
          .eq('customer_id', bCust.id).order('called_at', { ascending: false }).limit(10)
      : Promise.resolve({ data: null }),
    supabaseAdmin.from('contacts').select('is_opted_out').eq('phone', phone).maybeSingle(),
  ])

  const aCust = aCustRes.data as { id: string; name: string | null; dnd: boolean; is_opted_out: boolean } | null
  // Unified opt-out from the contact spine (chat STOP ∪ call DNC ∪ manual).
  const contact = contactRes.data as { is_opted_out: boolean } | null

  // Group interests by source.
  const interests: Record<string, string[]> = {}
  for (const s of (signalsRes.data ?? []) as { interest: string; source: string }[]) {
    (interests[s.source] ??= []).push(s.interest)
  }

  const sends = ((ledgerRes.data ?? []) as unknown as Array<{ meta_template_name: string | null; category: string | null; status: string; cohort_label: string | null; sent_at: string; template: { name: string } | { name: string }[] | null }>)
    .map(r => ({
      label: (Array.isArray(r.template) ? r.template[0]?.name : r.template?.name) ?? r.meta_template_name ?? r.category ?? 'message',
      category: r.category, status: r.status, cohort: r.cohort_label, sentAt: r.sent_at,
    }))

  const known = !!bCust || !!aCust
  return Response.json({
    phone,
    known,
    isNew: !known,
    name: bCust?.name ?? aCust?.name ?? null,
    source: bCust?.source ?? (aCust ? 'whatsapp' : null),
    flags: {
      is_hot_lead: bCust?.is_hot_lead ?? false,
      is_do_not_call: bCust?.is_do_not_call ?? false,
      dnd: aCust?.dnd ?? false,
      is_opted_out: contact?.is_opted_out ?? aCust?.is_opted_out ?? false,
    },
    markers: markerRes.data ?? null,
    interests,
    calls: (callsRes.data ?? []) as Array<{ success: boolean | null; topics: string[] | null; intent: string | null; called_at: string }>,
    sends,
  })
}
