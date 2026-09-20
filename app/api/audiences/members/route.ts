import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveCohortPhones, tenDigit } from '@/lib/reach/resolve'
import { resolveRuleTree } from '@/lib/audiences/resolve-rules'
import { refreshAudienceMembers } from '@/lib/audiences/service'
import { isEmptyTree, type RuleTree } from '@/lib/audiences/rules'
import type { ReachFilter } from '@/lib/types'

// The people behind a cohort — name + phone + opt-out — for previewing who is
// about to be activated, viewing an audience's members, and exporting a CSV of
// any audience / narrowed slice / arbitrary subset of the total pool.
//
//   POST { audienceId, subRules?|subFilter? }  → this audience's members, optionally
//                                                narrowed (the exact send set).
//   POST { rules }                             → any cohort resolved from the pool.
//   optional { limit }  (default 1000; 0 = everyone, for export; hard cap 50000)
//        → { count, sendable, optedOut, members:[{phone,name,optedOut}], truncated }
//
// `count` is everyone in the cohort; `sendable` excludes opted-out (what a chat
// send would actually reach). When a sub-filter/rules are used the resolver has
// already dropped opted-out, so count === sendable there; a bare audience keeps
// opted-out members visible and flagged, because that is who is in it.

const HARD_CAP = 50000

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

// name (+ opt-out) for a batch of phones from the contact spine.
async function decorate(phones: string[]): Promise<Map<string, { name: string | null; optedOut: boolean }>> {
  const map = new Map<string, { name: string | null; optedOut: boolean }>()
  for (let i = 0; i < phones.length; i += 300) {
    const { data } = await supabaseAdmin.from('contacts')
      .select('phone, name, name_override, is_opted_out').in('phone', phones.slice(i, i + 300))
    for (const r of (data ?? []) as Array<{ phone: string; name: string | null; name_override: string | null; is_opted_out: boolean }>) {
      const nm = (r.name_override || r.name || '').trim()
      map.set(tenDigit(r.phone), { name: nm && nm !== 'Unknown' ? nm : null, optedOut: !!r.is_opted_out })
    }
  }
  return map
}

export async function POST(req: NextRequest) {
  const user = await auth()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    audienceId?: string; subRules?: RuleTree; subFilter?: ReachFilter; rules?: RuleTree; limit?: number
  }

  let phones: string[]

  if (body.audienceId) {
    // Fresh members for a dynamic audience, so the preview equals the send set.
    await refreshAudienceMembers(body.audienceId)
    phones = await memberPhones(body.audienceId)
    if (body.subRules && !isEmptyTree(body.subRules)) {
      const { phones: sub, error } = await resolveRuleTree(body.subRules)
      if (error) return Response.json({ error }, { status: 400 })
      phones = phones.filter(p => sub.has(p))
    } else if (body.subFilter && Object.keys(body.subFilter).length > 0) {
      const { phones: sub, error } = await resolveCohortPhones(body.subFilter)
      if (error) return Response.json({ error }, { status: 400 })
      phones = phones.filter(p => sub.has(p))
    }
  } else if (body.rules && !isEmptyTree(body.rules)) {
    const { phones: set, error } = await resolveRuleTree(body.rules)
    if (error) return Response.json({ error }, { status: 400 })
    phones = [...set]
  } else {
    return Response.json({ error: 'Give an audienceId or a rules tree.' }, { status: 400 })
  }

  phones = [...new Set(phones)]
  const count = phones.length
  const dec = await decorate(phones)
  const optedOut = phones.filter(p => dec.get(p)?.optedOut).length

  // Sort: named first (alphabetical), then unknowns by phone.
  const members = phones
    .map(p => ({ phone: p, name: dec.get(p)?.name ?? null, optedOut: dec.get(p)?.optedOut ?? false }))
    .sort((a, b) => {
      if (!!a.name !== !!b.name) return a.name ? -1 : 1
      return (a.name ?? a.phone).localeCompare(b.name ?? b.phone)
    })

  const limit = body.limit === 0 ? HARD_CAP : Math.min(body.limit ?? 1000, HARD_CAP)
  return Response.json({
    count, sendable: count - optedOut, optedOut,
    members: members.slice(0, limit),
    truncated: members.length > limit,
  })
}
