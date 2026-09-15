import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { tenDigit } from '@/lib/reach/resolve'
import { countForFilter, countForTree, resolveRuleTree } from '@/lib/audiences/resolve-rules'
import { ruleToPredicate, treeToFilterString, type RuleTree } from '@/lib/audiences/rules'

// Live counts for the rule builder.
//   POST { rules, audienceId? } -> { total, groups: [{ total, rules: [n, …] }], scoped? }
//
// Each rule reports how many people it matches ON ITS OWN, alongside its
// group's running total and the audience total. That is what stops you saving a
// contradictory audience: a rule matching 0, or a group that collapses to 0,
// is visible while you build instead of after you save.
//
// When `audienceId` is given (narrowing INSIDE an audience's Insights), the
// headline `total` is scoped to that audience's members — "how many of THIS
// audience match", i.e. the pool left to send to. Without it the total counted
// the whole database, which read as a big number and then saved a tiny slice.

async function memberPhones(audienceId: string): Promise<Set<string>> {
  const out = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data } = await supabaseAdmin.from('audience_members')
      .select('phone').eq('audience_id', audienceId).range(from, from + 999)
    const rows = (data ?? []) as { phone: string }[]
    for (const r of rows) out.add(tenDigit(r.phone))
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

  const { rules, audienceId } = (await req.json().catch(() => ({}))) as { rules?: RuleTree; audienceId?: string }
  if (!rules?.groups?.length && !rules?.intervals?.length) {
    return Response.json({ total: 0, groups: [], scoped: !!audienceId })
  }

  const { filter } = treeToFilterString(rules)
  const hasIntervals = !!rules.intervals?.length

  // The headline total must be what the audience ACTUALLY is. With intervals
  // present that means resolving the whole tree — a filter-only count would
  // report a bigger number than the audience, which is the worst kind of wrong:
  // plausible, and used to decide who gets messaged.
  let total: number
  if (audienceId) {
    // Scoped: intersect the whole tree's matches with this audience's members.
    const members = await memberPhones(audienceId)
    const { phones, error } = await resolveRuleTree(rules)
    total = error ? 0 : [...phones].filter(p => members.has(p)).length
  } else {
    total = hasIntervals
      ? (await countForTree(rules)).count
      : filter ? (await countForFilter(filter)).count : 0
  }

  // Group and per-rule counts stay filter-only and so IGNORE intervals: each
  // answers "how many does this rule match on its own", which is the question
  // you need while building. Only the headline total is the real audience.
  const groups = []
  for (const g of rules.groups ?? []) {
    const preds = (g.rules ?? []).map(ruleToPredicate)
    // Per-rule: the rule alone, ignoring its neighbours.
    const perRule: (number | null)[] = []
    for (const p of preds) perRule.push(p ? (await countForFilter(p)).count : null)
    // Per-group: all its rules ANDed.
    const ok = preds.filter((p): p is string => !!p)
    const gTotal = ok.length ? (await countForFilter(ok.length === 1 ? ok[0] : `and(${ok.join(',')})`)).count : 0
    groups.push({ total: gTotal, rules: perRule })
  }

  return Response.json({ total, groups, scoped: !!audienceId })
}
