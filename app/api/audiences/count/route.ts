import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { countForFilter, countForTree } from '@/lib/audiences/resolve-rules'
import { ruleToPredicate, treeToFilterString, type RuleTree } from '@/lib/audiences/rules'

// Live counts for the rule builder.
//   POST { rules } -> { total, groups: [{ total, rules: [n, …] }] }
//
// Each rule reports how many people it matches ON ITS OWN, alongside its
// group's running total and the audience total. That is what stops you saving a
// contradictory audience: a rule matching 0, or a group that collapses to 0,
// is visible while you build instead of after you save.

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { rules } = (await req.json().catch(() => ({}))) as { rules?: RuleTree }
  if (!rules?.groups?.length && !rules?.intervals?.length) {
    return Response.json({ total: 0, groups: [] })
  }

  const { filter } = treeToFilterString(rules)
  const hasIntervals = !!rules.intervals?.length

  // The headline total must be what the audience ACTUALLY is. With intervals
  // present that means resolving the whole tree — a filter-only count would
  // report a bigger number than the audience, which is the worst kind of wrong:
  // plausible, and used to decide who gets messaged.
  const total = hasIntervals
    ? (await countForTree(rules)).count
    : filter ? (await countForFilter(filter)).count : 0

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

  return Response.json({ total, groups })
}
