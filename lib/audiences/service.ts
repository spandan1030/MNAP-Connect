import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveCohortPhones, tenDigit } from '@/lib/reach/resolve'
import type { ReachFilter } from '@/lib/types'

// Audience service — resolve a saved audience's filter and MATERIALISE its members
// (audience_members). Reuses the one cohort resolver so "who's in this audience" is
// defined in exactly one place. Fixed audiences freeze at first materialisation;
// dynamic audiences full-sync (add new matches, drop those that no longer match).
// Suppression is NOT applied here — membership = who's in the audience; the send/
// call step applies opt-out + ledger suppression.

// Resolve display names for a batch of phones from the contact spine.
async function nameFor(phones: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  for (let i = 0; i < phones.length; i += 300) {
    const { data } = await supabaseAdmin.from('contacts')
      .select('phone, name, name_override').in('phone', phones.slice(i, i + 300))
    for (const r of (data ?? []) as Array<{ phone: string; name: string | null; name_override: string | null }>) {
      const nm = (r.name_override || r.name || '').trim()
      if (nm && nm !== 'Unknown') names.set(tenDigit(r.phone), nm)
    }
  }
  return names
}

async function existingMemberPhones(audienceId: string): Promise<Set<string>> {
  const set = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data } = await supabaseAdmin.from('audience_members')
      .select('phone').eq('audience_id', audienceId).range(from, from + 999)
    const rows = (data ?? []) as { phone: string }[]
    for (const r of rows) set.add(r.phone)
    if (rows.length < 1000) break
  }
  return set
}

export interface RefreshResult { members: number; added: number; removed: number; error?: string }

// Materialise an audience's members. `force` re-snapshots even a fixed audience
// (used after its filter is edited).
export async function refreshAudienceMembers(audienceId: string, force = false): Promise<RefreshResult> {
  const { data: aud } = await supabaseAdmin
    .from('wa_audiences').select('id, filter, is_dynamic').eq('id', audienceId).maybeSingle()
  if (!aud) return { members: 0, added: 0, removed: 0, error: 'Audience not found' }

  const filter = (aud.filter ?? {}) as ReachFilter
  const isDynamic = !!aud.is_dynamic
  const existing = await existingMemberPhones(audienceId)

  // Fixed + already materialised → frozen (unless forced by a filter edit).
  if (!isDynamic && existing.size > 0 && !force) {
    return { members: existing.size, added: 0, removed: 0 }
  }

  const { phones: set, error } = await resolveCohortPhones(filter)
  if (error) return { members: existing.size, added: 0, removed: 0, error }

  const now = [...set]
  const toAdd = now.filter(p => !existing.has(p))
  // Dynamic (or a forced re-snapshot) drops members that no longer match; a plain
  // fixed materialisation only adds.
  const toRemove = (isDynamic || force) ? [...existing].filter(p => !set.has(p)) : []

  const names = await nameFor(toAdd)
  for (let i = 0; i < toAdd.length; i += 500) {
    const rows = toAdd.slice(i, i + 500).map(p => ({ audience_id: audienceId, phone: p, name: names.get(p) ?? null }))
    await supabaseAdmin.from('audience_members').upsert(rows, { onConflict: 'audience_id,phone' })
  }
  for (let i = 0; i < toRemove.length; i += 300) {
    await supabaseAdmin.from('audience_members')
      .delete().eq('audience_id', audienceId).in('phone', toRemove.slice(i, i + 300))
  }

  const members = existing.size + toAdd.length - toRemove.length
  await supabaseAdmin.from('wa_audiences')
    .update({ member_count: members, last_refreshed_at: new Date().toISOString() })
    .eq('id', audienceId)
  return { members, added: toAdd.length, removed: toRemove.length }
}
