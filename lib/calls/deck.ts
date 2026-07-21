import { supabaseAdmin } from '@/lib/supabase/admin'
import { tenDigit } from '@/lib/reach/resolve'
import { isCallUnreachable, isCallSnoozed, MAX_FAILED_CALL_ATTEMPTS } from '@/lib/calls'

// ═══════════════════════════════════════════════════════════════════════════
//  THE CALLING DECK — one implementation, used by both audience activation and
//  Call Control.
//
//  "Callable" is not the same as "in the cohort". Three gates apply here and
//  nowhere else, so every route that fills the deck agrees:
//    · do-not-call        — opted out of calls
//    · unreachable        — burned the disconnect budget (retired for good)
//    · snoozed            — still inside their post-call wait (not yet, not never)
//
//  There is exactly ONE live calling list. Filling a new one deactivates the
//  rest; task upsert ignores existing cards, so re-pushing never re-calls
//  anyone already on the deck.
// ═══════════════════════════════════════════════════════════════════════════

export interface CallableResult {
  ids: string[]        // wa_b_customers.id, callable, de-duped
  unreachable: number  // retired: >= MAX_FAILED_CALL_ATTEMPTS disconnects
  snoozed: number      // still waiting after a recent call
}

/** Given a set of phones, the Type-B customer ids we may actually call. */
export async function callableTypeB(phones: Set<string>): Promise<CallableResult> {
  const want = new Set([...phones].map(tenDigit))
  const ids = new Map<string, string>()   // phone -> id, de-dupes
  let unreachable = 0
  let snoozed = 0
  for (let from = 0; ; from += 1000) {
    const { data } = await supabaseAdmin.from('wa_b_customers')
      .select('id, phone, is_do_not_call, failed_call_attempts, call_snooze_until')
      .range(from, from + 999)
    const rows = (data ?? []) as Array<{
      id: string; phone: string; is_do_not_call: boolean
      failed_call_attempts: number | null; call_snooze_until: string | null
    }>
    for (const r of rows) {
      const p = tenDigit(r.phone)
      if (!want.has(p) || ids.has(p) || r.is_do_not_call) continue
      if (isCallUnreachable(r.failed_call_attempts)) { unreachable++; continue }
      if (isCallSnoozed(r.call_snooze_until)) { snoozed++; continue }
      ids.set(p, r.id)
    }
    if (rows.length < 1000) break
  }
  return { ids: [...ids.values()], unreachable, snoozed }
}

/** Why a would-be deck came out empty — wait vs never are different answers. */
export function notCallableMessage(snoozed: number, unreachable: number): string {
  const why: string[] = []
  if (snoozed > 0) why.push(`${snoozed} were called recently and are still in their wait`)
  if (unreachable > 0) why.push(`${unreachable} are call-unreachable (${MAX_FAILED_CALL_ATTEMPTS}+ disconnects)`)
  if (!why.length) return 'No callable customers (no Type-B record, or all do-not-call).'
  const tail = snoozed > 0 && unreachable === 0
    ? 'Try again once the wait is up, or reach them on chat.'
    : 'Reach them on chat instead.'
  return `None are callable right now — ${why.join(', ')}. ${tail}`
}

export interface MintDeckArgs {
  name: string
  customerIds: string[]
  createdBy: string
  audienceId?: string | null
  filterJson?: unknown
  // Reuse this audience's existing campaign so already-called cards survive.
  reuseForAudienceId?: string | null
}

/** Make (or reuse) the single live calling deck and add the cards. */
export async function mintCallDeck(
  args: MintDeckArgs,
): Promise<{ campaignId: string; taskCount: number } | { error: string }> {
  let campId: string | undefined

  if (args.reuseForAudienceId) {
    const { data: existing } = await supabaseAdmin.from('wa_b_call_campaigns')
      .select('id').eq('audience_id', args.reuseForAudienceId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    campId = existing?.id as string | undefined
  }

  // Only one live list at a time.
  await supabaseAdmin.from('wa_b_call_campaigns').update({ is_active: false }).eq('is_active', true)

  if (campId) {
    await supabaseAdmin.from('wa_b_call_campaigns').update({ is_active: true }).eq('id', campId)
  } else {
    const { data: camp, error } = await supabaseAdmin.from('wa_b_call_campaigns')
      .insert({
        name: args.name.trim(), filter_json: args.filterJson ?? null,
        audience_id: args.audienceId ?? null, created_by: args.createdBy, is_active: true,
      })
      .select('id').single()
    if (error || !camp) return { error: error?.message ?? 'Could not create the calling deck.' }
    campId = camp.id as string
  }

  let taskCount = 0
  for (let i = 0; i < args.customerIds.length; i += 500) {
    const chunk = args.customerIds.slice(i, i + 500).map(cid => ({ campaign_id: campId, customer_id: cid }))
    const { error } = await supabaseAdmin.from('wa_b_call_tasks')
      .upsert(chunk, { onConflict: 'campaign_id,customer_id', ignoreDuplicates: true })
    if (error) return { error: error.message }
    taskCount += chunk.length
  }
  return { campaignId: campId!, taskCount }
}
