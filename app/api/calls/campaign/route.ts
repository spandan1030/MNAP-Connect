import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { CallFilter, ReachFilter } from '@/lib/types'
import { resolveRuleTree } from '@/lib/audiences/resolve-rules'
import { chipsToTree } from '@/lib/audiences/chips-to-tree'
import { type RuleTree, isEmptyTree } from '@/lib/audiences/rules'
import { callableTypeB, notCallableMessage, mintCallDeck } from '@/lib/calls/deck'

// Admin Call Control — build the calling deck through the ONE shared engine.
//   POST { preview: true, filter | rules }   -> { count }
//   POST { name, filter | rules }            -> { campaignId, taskCount }
//
// A CallFilter is a subset of ReachFilter (same field names), so it converts to
// a rule tree exactly like the chips do — Call Control is no longer a parallel
// grammar over the markers table. Resolution runs against customer_features;
// the call gates (do-not-call, unreachable, snooze) are applied by callableTypeB
// so the preview count equals the deck the salesman is served.

type Body = { preview?: boolean; name?: string; filter?: CallFilter; rules?: RuleTree }

function toTree(body: Body): RuleTree {
  if (body.rules && !isEmptyTree(body.rules)) return body.rules
  // CallFilter -> ReachFilter is a straight widening (identical keys), then the
  // proven chips converter turns it into the same tree the audience engine runs.
  return chipsToTree((body.filter ?? {}) as ReachFilter)
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

  const body = (await req.json()) as Body
  const tree = toTree(body)
  if (isEmptyTree(tree)) return Response.json({ error: 'Add at least one filter.' }, { status: 400 })

  // Resolve the cohort once, then apply the call gates.
  const { phones, error } = await resolveRuleTree(tree)
  if (error) return Response.json({ error }, { status: 500 })
  const { ids, unreachable, snoozed } = await callableTypeB(phones)

  // ── Preview: just the callable count ──
  if (body.preview) return Response.json({ count: ids.length })

  // ── Create ──
  if (!body.name || !body.name.trim()) {
    return Response.json({ error: 'Campaign name required' }, { status: 400 })
  }
  if (ids.length === 0) {
    return Response.json({ error: notCallableMessage(snoozed, unreachable) }, { status: 400 })
  }

  const res = await mintCallDeck({
    name: body.name, customerIds: ids, createdBy: user.id, filterJson: body.filter ?? tree,
  })
  if ('error' in res) return Response.json({ error: res.error }, { status: 500 })
  return Response.json({ campaignId: res.campaignId, taskCount: res.taskCount, unreachable, snoozed })
}
