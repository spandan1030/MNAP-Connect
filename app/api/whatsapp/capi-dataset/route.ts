import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// One-time helper — retrieve (or create) the WhatsApp Business Account's OWN
// Conversions-API dataset. CTWA/business_messaging events must go to a dataset
// that has the WABA linked; the website *pixel* dataset does not (Meta rejects
// with subcode 2804132 "No WhatsApp Business account linked to this dataset").
// Meta's own instruction is: POST /{WABA_ID}/dataset → use the id it returns.
//
// Visit https://mnapconnect.vercel.app/api/whatsapp/capi-dataset while logged in,
// copy `data.id` from the response into META_CAPI_DATASET_ID (Vercel), redeploy.
// Idempotent: returns the existing dataset if one already exists.
export async function GET(_req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const waba  = process.env.META_WABA_ID
  // Prefer the WhatsApp token here — creating the WABA dataset needs WABA access,
  // which the messaging token has (the pixel-scoped CAPI token may not).
  const token = process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_CAPI_ACCESS_TOKEN
  const ver   = process.env.WHATSAPP_API_VERSION || 'v22.0'
  if (!waba || !token) {
    return Response.json({ error: 'META_WABA_ID or WhatsApp token not set' }, { status: 400 })
  }

  const res = await fetch(`https://graph.facebook.com/${ver}/${waba}/dataset`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json().catch(() => ({}))
  // Return the raw Graph response so the dataset id — or any permission error — is
  // visible directly in the browser.
  return Response.json({ ok: res.ok, status: res.status, data })
}
