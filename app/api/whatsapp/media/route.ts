import { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Auth-gated proxy for INBOUND customer media, which lives in the PRIVATE `wa-inbound`
// bucket (customer-sent photos are not public like the catalogue). The messages view
// renders <img src="/api/whatsapp/media?path=inbound/..."> — same-origin, so the
// staff session cookie rides along. We verify the session, then 302 to a short-lived
// signed URL. No login ⇒ no image. (Outbound media stays in the public wa-media bucket
// because Meta must fetch it by URL to deliver it.)
//   GET /api/whatsapp/media?path=inbound/<file>

export const dynamic = 'force-dynamic'

// Exactly one path segment under inbound/, safe filename chars only — no traversal,
// no reaching other folders/buckets.
const SAFE_PATH = /^inbound\/[A-Za-z0-9._-]+$/

export async function GET(req: NextRequest) {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const path = req.nextUrl.searchParams.get('path') ?? ''
  if (!SAFE_PATH.test(path)) return new Response('Bad path', { status: 400 })

  const { data, error } = await supabaseAdmin.storage
    .from('wa-inbound').createSignedUrl(path, 300) // 5 min
  if (error || !data?.signedUrl) return new Response('Not found', { status: 404 })

  return Response.redirect(data.signedUrl, 302)
}
