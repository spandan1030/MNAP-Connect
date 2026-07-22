import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { stepFunnel, type StepRow, type CarrySignal, type StepAction } from '@/lib/audiences/steps'
import type { RuleTree } from '@/lib/audiences/rules'

// Steps of an audience — the multi-step funnel.
//   GET  /api/audiences/steps?audienceId=<uuid>  -> ordered steps + per-step funnel
//   POST /api/audiences/steps  { audienceId, action, carrySignal, carryButton?,
//                                narrowRules?, templateId?, name? }  -> new draft step

async function auth() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET(req: NextRequest) {
  if (!(await auth())) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const audienceId = req.nextUrl.searchParams.get('audienceId')
  if (!audienceId) return Response.json({ error: 'Missing audienceId' }, { status: 400 })

  const { data } = await supabaseAdmin.from('audience_steps')
    .select('*').eq('audience_id', audienceId).order('seq', { ascending: true })
  const rows = (data ?? []) as StepRow[]

  const steps = []
  for (const s of rows) {
    const funnel = s.status === 'run' ? await stepFunnel(s) : { entered: 0 }
    steps.push({
      id: s.id, seq: s.seq, name: s.name, action: s.action,
      carrySignal: s.carry_signal, carryButton: s.carry_button,
      narrowRules: s.narrow_rules, templateId: s.template_id,
      status: s.status, runAt: s.run_at, funnel,
    })
  }
  return Response.json({ steps })
}

export async function POST(req: NextRequest) {
  const user = await auth()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    audienceId?: string; action?: StepAction; carrySignal?: CarrySignal
    carryButton?: string | null; narrowRules?: RuleTree | null; templateId?: string | null; name?: string | null
  }
  const { audienceId, action } = body
  if (!audienceId) return Response.json({ error: 'Missing audienceId' }, { status: 400 })
  if (action !== 'chat' && action !== 'call') return Response.json({ error: 'Pick chat or call.' }, { status: 400 })
  if (action === 'chat' && !body.templateId) return Response.json({ error: 'Pick a template for the chat step.' }, { status: 400 })

  // Next sequence number for this audience.
  const { data: last } = await supabaseAdmin.from('audience_steps')
    .select('seq').eq('audience_id', audienceId).order('seq', { ascending: false }).limit(1).maybeSingle()
  const seq = ((last?.seq as number) ?? 0) + 1

  // Step 1 has no previous step to carry from — force 'all'.
  const carry_signal: CarrySignal = seq === 1 ? 'all' : (body.carrySignal ?? 'all')

  const { data: step, error } = await supabaseAdmin.from('audience_steps').insert({
    audience_id: audienceId, seq, name: body.name?.trim() || null,
    carry_signal, carry_button: carry_signal === 'replied' ? (body.carryButton ?? null) : null,
    narrow_rules: body.narrowRules ?? null, action, template_id: body.templateId ?? null,
    status: 'draft', created_by: user.id,
  }).select('id, seq').single()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ step })
}
