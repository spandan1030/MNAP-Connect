import { supabaseAdmin } from '@/lib/supabase/admin'

// Customer-app features on the contact spine (wa_053). Server-only — imports the
// service-role client, so never pull this into a client component.

function tenDigit(raw: string | null | undefined): string {
  const d = (raw ?? '').replace(/\D/g, '')
  return d.length > 10 && d.startsWith('91') ? d.slice(-10) : d
}

// Flag that this phone showed product interest from the app (tapped "interested"
// or shared a gold.mnalankarpalace.com link into chat). Stamps the FIRST time we
// saw it and leaves that stamp alone on repeats, so "app interest in the last N
// days" means the first tap, not the latest message. Best-effort and idempotent;
// the caller must never let a flag write break the chat reply.
export async function markAppProductInterest(phone: string): Promise<void> {
  const p = tenDigit(phone)
  if (p.length !== 10) return
  try {
    const { data } = await supabaseAdmin
      .from('contacts')
      .select('app_product_interest_at')
      .eq('phone', p)
      .maybeSingle()
    const at = data?.app_product_interest_at ?? new Date().toISOString()
    // The contacts row exists by now (inbound chat auto-enrols → trigger), but
    // upsert keeps this correct even if it somehow doesn't. from_chat is true
    // because they messaged us.
    await supabaseAdmin
      .from('contacts')
      .upsert(
        { phone: p, from_chat: true, app_product_interest: true, app_product_interest_at: at },
        { onConflict: 'phone' },
      )
  } catch (err) {
    console.error('markAppProductInterest failed (non-fatal):', err)
  }
}
