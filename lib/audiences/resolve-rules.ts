import { supabaseAdmin } from '@/lib/supabase/admin'
import { tenDigit } from '@/lib/reach/resolve'
import { treeToFilterString, type RuleTree } from './rules'

// Resolve a rule tree to phones. The WHOLE tree compiles to one PostgREST
// filter, so a five-rule audience is one round trip rather than five set
// operations in app memory — the same reason the view exists at all.
//
// Opt-out is applied here for the same reason it is in resolveCohortPhones:
// membership counts must match what actually gets sent. Ads pass
// includeOptedOut, since opting out blocks chat and calls, not ads.

export interface ResolveRulesResult {
  phones: Set<string>
  error?: string
}

export async function resolveRuleTree(
  tree: RuleTree,
  opts: { includeOptedOut?: boolean } = {},
): Promise<ResolveRulesResult> {
  const { filter } = treeToFilterString(tree)
  if (!filter) return { phones: new Set(), error: 'Add at least one rule.' }

  const phones = new Set<string>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    let q = supabaseAdmin.from('customer_features').select('phone').or(filter)
    if (!opts.includeOptedOut) q = q.eq('is_opted_out', false)
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) return { phones: new Set(), error: `customer_features: ${error.message}` }
    const rows = (data ?? []) as { phone: string }[]
    for (const r of rows) phones.add(tenDigit(r.phone))
    if (rows.length < PAGE) break
  }
  return { phones }
}

// How many people a single filter string matches, without fetching them —
// this is what makes the live count next to each rule cheap enough to show
// while you type.
export async function countForFilter(
  filter: string,
  includeOptedOut = false,
): Promise<{ count: number; error?: string }> {
  let q = supabaseAdmin.from('customer_features').select('phone', { count: 'exact', head: true }).or(filter)
  if (!includeOptedOut) q = q.eq('is_opted_out', false)
  const { count, error } = await q
  if (error) return { count: 0, error: error.message }
  return { count: count ?? 0 }
}
