import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveCohortPhones, tenDigit } from '@/lib/reach/resolve'
import { resolveRuleTree } from '@/lib/audiences/resolve-rules'
import { isEmptyTree, type RuleTree } from '@/lib/audiences/rules'
import { createAudienceFromCohort } from '@/lib/audiences/adhoc'
import { phonesAtStage, type EngagementStage } from '@/lib/campaigns/engagement'
import type { ReachFilter } from '@/lib/types'

// Save a SLICE of an audience as a new, reusable audience — the "carry" primitive.
// Two ways to slice:
//   narrow     — this audience's members ∩ a marker filter (e.g. call_last_intent = will_come)
//   engagement — who reached a stage on a chat campaign (e.g. who READ template T1)
// Either way we materialise the phones into a fresh fixed audience you can then
// send templates to (with the usual cap + per-template funnel). This is what
// replaces the old multi-step funnel: a slice is just another audience.
//   POST { mode:'narrow', audienceId, name, subRules? | subFilter? }
//   POST { mode:'engagement', campaignId, stage, name }
//        -> { audienceId, count }

const STAGES: EngagementStage[] = ['read', 'replied', 'delivered', 'delivered_not_read', 'not_delivered']

async function memberPhones(audienceId: string): Promise<string[]> {
  const out: string[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await supabaseAdmin.from('audience_members')
      .select('phone').eq('audience_id', audienceId).range(from, from + 999)
    const rows = (data ?? []) as { phone: string }[]
    out.push(...rows.map(r => tenDigit(r.phone)))
    if (rows.length < 1000) break
  }
  return out
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
    mode?: 'narrow' | 'engagement'
    audienceId?: string; campaignId?: string; stage?: EngagementStage
    name?: string; subRules?: RuleTree; subFilter?: ReachFilter
  }
  const name = (body.name ?? '').trim()
  if (!name) return Response.json({ error: 'Give the new audience a name.' }, { status: 400 })

  let phones: string[]

  if (body.mode === 'narrow') {
    if (!body.audienceId) return Response.json({ error: 'Missing audienceId' }, { status: 400 })
    phones = await memberPhones(body.audienceId)
    if (body.subRules && !isEmptyTree(body.subRules)) {
      const { phones: subSet, error } = await resolveRuleTree(body.subRules)
      if (error) return Response.json({ error }, { status: 400 })
      phones = phones.filter(p => subSet.has(p))
    } else if (body.subFilter && Object.keys(body.subFilter).length > 0) {
      const { phones: subSet, error } = await resolveCohortPhones(body.subFilter)
      if (error) return Response.json({ error }, { status: 400 })
      phones = phones.filter(p => subSet.has(p))
    } else {
      return Response.json({ error: 'Add at least one narrowing rule.' }, { status: 400 })
    }
  } else if (body.mode === 'engagement') {
    if (!body.campaignId) return Response.json({ error: 'Missing campaignId' }, { status: 400 })
    if (!body.stage || !STAGES.includes(body.stage)) {
      return Response.json({ error: 'Pick a valid engagement stage.' }, { status: 400 })
    }
    phones = await phonesAtStage(body.campaignId, body.stage)
  } else {
    return Response.json({ error: "mode must be 'narrow' or 'engagement'." }, { status: 400 })
  }

  if (phones.length === 0) return Response.json({ error: 'No one is in that slice.' }, { status: 400 })

  const made = await createAudienceFromCohort({ name, phones, userId: user.id })
  if ('error' in made) return Response.json({ error: made.error }, { status: 500 })

  return Response.json({ audienceId: made.audienceId, count: phones.length })
}
