import { supabaseAdmin } from '@/lib/supabase/admin'
import { tenDigit } from '@/lib/reach/resolve'
import { treeToFilterString, usableIntervals, type RuleTree } from './rules'
import { intervalPhones } from './intervals-query'

// Resolve a rule tree to phones.
//
//     cohort = (rule groups, OR'd)  AND  (every interval)
//
// The rule half is ONE PostgREST filter against the feature view, so a
// five-rule audience is one round trip rather than five set operations in app
// memory — the same reason the view exists at all.
//
// The interval half cannot ride along: it asks whether an EVENT happened inside
// a window, and the feature view keeps only the most recent of each thing. So
// each interval is its own query against the log it belongs to, and the results
// are combined here. A NOT interval SUBTRACTS instead of intersecting, which is
// what makes "in this audience and NOT contacted recently" expressible.
//
// Opt-out is applied for the same reason it is in resolveCohortPhones:
// membership counts must match what actually gets sent. Ads pass
// includeOptedOut, since opting out blocks chat and calls, not ads.

export interface ResolveRulesResult {
  phones: Set<string>
  error?: string
}

async function featurePhones(
  filter: string | null,
  includeOptedOut: boolean,
): Promise<Set<string>> {
  const phones = new Set<string>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    let q = supabaseAdmin.from('customer_features').select('phone')
    if (filter) q = q.or(filter)
    if (!includeOptedOut) q = q.eq('is_opted_out', false)
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) throw new Error(`customer_features: ${error.message}`)
    const rows = (data ?? []) as { phone: string }[]
    for (const r of rows) phones.add(tenDigit(r.phone))
    if (rows.length < PAGE) break
  }
  return phones
}

export async function resolveRuleTree(
  tree: RuleTree,
  opts: { includeOptedOut?: boolean } = {},
): Promise<ResolveRulesResult> {
  const { filter } = treeToFilterString(tree)
  const intervals = usableIntervals(tree)

  if (!filter && !intervals.length) {
    return { phones: new Set(), error: 'Add at least one rule or interval.' }
  }

  try {
    // With no rules, an interval alone is still a valid audience ("everyone who
    // walked in last week") — start from everyone contactable and narrow.
    let phones = await featurePhones(filter, !!opts.includeOptedOut)

    for (const iv of intervals) {
      const hit = await intervalPhones(iv)
      const next = new Set<string>()
      if (iv.not) {
        // "no such event in this window" — subtract.
        for (const p of phones) if (!hit.has(p)) next.add(p)
      } else {
        for (const p of phones) if (hit.has(p)) next.add(p)
      }
      phones = next
      if (!phones.size) break   // nothing left; further work cannot add anyone
    }

    return { phones }
  } catch (e) {
    return { phones: new Set(), error: (e as Error).message }
  }
}

// How many people a single filter string matches, without fetching them —
// this is what makes the live count next to each rule cheap enough to show
// while you type. Intervals are NOT included here; they are counted separately
// so the UI can show each one's own number.
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

/** Whole-tree count, rules AND intervals — what the audience will actually be. */
export async function countForTree(
  tree: RuleTree,
  includeOptedOut = false,
): Promise<{ count: number; error?: string }> {
  const { phones, error } = await resolveRuleTree(tree, { includeOptedOut })
  return error ? { count: 0, error } : { count: phones.size }
}
