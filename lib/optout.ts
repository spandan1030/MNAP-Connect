import { supabaseAdmin } from '@/lib/supabase/admin'
import { tenDigit } from '@/lib/reach/resolve'

// ═══════════════════════════════════════════════════════════════════════════
//  THE opt-out check. One flag, one place (wa_049).
//
//  There used to be several columns for this idea and every screen picked a
//  different one, so a customer who told a salesman "don't contact me" could
//  still be messaged from the inbox. Nothing outside this file should read
//  `dnd` or `is_do_not_call` to decide whether we may contact someone.
//
//  POLICY: opted out = no WhatsApp, no calls. ADS ARE UNAFFECTED — an opt-out
//  is about us contacting them, not about being shown an ad. Ad/export callers
//  deliberately skip this check.
// ═══════════════════════════════════════════════════════════════════════════

/** True when we must not contact this person. Fails CLOSED: on error, treat as opted out. */
export async function isOptedOut(phone: string): Promise<boolean> {
  const p = tenDigit(phone)
  if (p.length !== 10) return true
  const { data, error } = await supabaseAdmin
    .from('contacts').select('is_opted_out').eq('phone', p).maybeSingle()
  // An unknown number is contactable (a brand-new lead has no contact row yet);
  // a FAILED lookup is not — we would rather not send than send wrongly.
  if (error) return true
  return data?.is_opted_out === true
}

/** The subset of `phones` we may contact. One query, not one per phone. */
export async function contactablePhones(phones: string[]): Promise<Set<string>> {
  const want = phones.map(tenDigit).filter(p => p.length === 10)
  const blocked = new Set<string>()
  for (let i = 0; i < want.length; i += 300) {
    const { data } = await supabaseAdmin
      .from('contacts').select('phone').eq('is_opted_out', true).in('phone', want.slice(i, i + 300))
    for (const r of (data ?? []) as { phone: string }[]) blocked.add(tenDigit(r.phone))
  }
  return new Set(want.filter(p => !blocked.has(p)))
}

export type OptOutReason = 'chat_stop' | 'call_dnc' | 'manual'

/** The one way to opt someone in or out. Keeps the legacy columns in step. */
export async function setOptOut(phone: string, value: boolean, reason: OptOutReason): Promise<void> {
  const p = tenDigit(phone)
  if (p.length !== 10) return
  await supabaseAdmin.rpc('set_opt_out', { target_phone: p, value, reason })
}

/** Standard refusal, so every blocked send reads the same to the user. */
export const OPTED_OUT_MESSAGE =
  'This number has opted out of contact (STOP or don’t-contact) and cannot be messaged.'
