import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { INTEREST_KEYS } from '@/lib/signals'
import { dispatchTemplate } from '@/lib/reach/dispatch'

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
// Map the form's timing value → the canonical walkin_timing field (targetable).
// 'browsing' isn't a buying-window, so it stores null.
const TIMING_CANONICAL: Record<string, string> = {
  within_7_days: 'within_7d', within_1_month: 'within_1m', '1_3_months': '1_3m',
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
    name?: string; phone?: string; interests?: string[]; timing?: string; notes?: string; isVip?: boolean; salesmanId?: string; sendWelcome?: boolean
  }
  const name = (body.name ?? '').trim()
  const phone = tenDigit(body.phone ?? '')
  if (!name) return Response.json({ error: 'Name is required.' }, { status: 400 })
  if (phone.length !== 10) return Response.json({ error: 'Enter a valid 10-digit phone number.' }, { status: 400 })

  // Only accept known canonical interest keys (no free text into the signal spine).
  const interests = [...new Set((body.interests ?? []).filter(k => INTEREST_KEYS.includes(k)))]

  const now = new Date().toISOString()
  const timingLabel = body.timing ? (TIMING_LABEL[body.timing] ?? body.timing) : null
  const walkinTiming = body.timing ? (TIMING_CANONICAL[body.timing] ?? null) : null
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
      walkin_salesman_id: salesmanId, walkin_at: now, walkin_timing: walkinTiming,
    }
    if (body.isVip && !existing.is_hot_lead) { patch.is_hot_lead = true; patch.hot_lead_at = now }
    await supabaseAdmin.from('wa_b_customers').update(patch).eq('id', customerId)
  } else {
    const { data: cust, error } = await supabaseAdmin.from('wa_b_customers').insert({
      name, phone, enrolled_by: user.id, source: 'walkin', notes: visitNote,
      walkin_salesman_id: salesmanId, walkin_at: now, walkin_timing: walkinTiming,
      is_hot_lead: !!body.isVip, hot_lead_at: body.isVip ? now : null,
    }).select('id').single()
    if (error || !cust) return Response.json({ error: error?.message ?? 'Could not save walk-in.' }, { status: 500 })
    customerId = cust.id as string
    created = true
  }

  // ── Log the VISIT itself (wa_050) ──────────────────────────────────────────
  // One row per visit. The columns set on the customer above are only a
  // "latest visit" cache — this is the history, and a trigger keeps the cache
  // in step. Without this row, a repeat visit would erase the previous one.
  const { error: visitErr } = await supabaseAdmin.from('wa_walkin_visits').insert({
    phone, customer_id: customerId, visited_at: now,
    salesman_id: salesmanId, timing: walkinTiming,
    note: (body.notes ?? '').trim() || null,
    interests: interests.length ? interests : null,
  })
  // A failed visit log must not lose the walk-in: the customer row is already
  // saved and correct. Report it, but keep what we have.
  if (visitErr) console.error('[walkin] visit log failed:', visitErr.message)

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

  // ── Touch 0: immediate welcome WhatsApp (today's rate + fresh designs) ───────
  // Fire ONE approved template (category='walkin') the moment a walk-in is logged,
  // so the counter conversation continues on WhatsApp. All the money-safety lives
  // in dispatchTemplate: opt-out is honoured, and a repeat visitor within the
  // template's suppression window is NOT re-blasted. We add one guard of our own —
  // if the template leads with today's rate but no rate is set yet, we hold the
  // send rather than deliver a "rate is —" message. `welcome` reports the outcome
  // so the salesman sees exactly what happened (and can act if it was skipped).
  let welcome: { status: string } = { status: 'disabled' }
  if (body.sendWelcome !== false) {
    welcome = { status: 'no_template' }
    const { data: tpl } = await supabaseAdmin.from('wa_message_templates')
      .select('id, meta_variables')
      .eq('is_active', true).eq('category', 'walkin')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()

    if (tpl?.id) {
      try {
        // If the copy uses a rate placeholder, make sure today's rate exists first.
        const vars = (tpl.meta_variables as string[] | null) ?? []
        const needsRate = vars.some(v => v.toLowerCase().startsWith('rate_'))
        let rateReady = true
        if (needsRate) {
          const todayStr = new Date().toLocaleDateString('en-CA')
          const { data: rate } = await supabaseAdmin.from('daily_rates')
            .select('rate_24kt, rate_22kt, rate_18kt').eq('date', todayStr).maybeSingle()
          rateReady = !!rate && vars.every(v => {
            const k = v.toLowerCase()
            if (k === 'rate_24kt') return rate.rate_24kt != null
            if (k === 'rate_22kt') return rate.rate_22kt != null
            if (k === 'rate_18kt') return rate.rate_18kt != null
            return true
          })
        }

        if (!rateReady) {
          welcome = { status: 'skipped_no_rate' }
        } else {
          const r = await dispatchTemplate({
            templateId: tpl.id, recipients: [{ phone, name }], userId: user.id,
            cohortLabel: 'walkin_touch0', campaignRef: 'walkin', limit: 1,
          })
          welcome = { status:
            r.error ? 'error'
            : r.sent > 0 ? 'sent'
            : r.skippedDnc > 0 ? 'skipped_dnc'
            : r.skippedSuppressed > 0 ? 'skipped_suppressed'
            : r.failed > 0 ? 'failed'
            : 'error' }
        }
      } catch (e) {
        // A failed welcome must never lose the walk-in — it is already saved.
        console.error('[walkin] welcome send failed:', (e as Error).message)
        welcome = { status: 'error' }
      }
    }
  }

  return Response.json({ customerId, phone, created, signals: interests.length, welcome })
}
