import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Config health for the invoice-link flow (admin-gated). Lets the UI warn when
// CUSTOMER_APP_PUBLISH_URL points somewhere other than the production customer
// app — a staging value silently publishes snapshots + issues links to the wrong
// place. Env vars are server-only, so the UI reads this instead.

export const dynamic = 'force-dynamic'

const PROD_BASE = 'https://gold.mnalankarpalace.com'

export async function GET() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const pub = process.env.CUSTOMER_APP_PUBLISH_URL || ''
  const base = pub.replace(/\/api\/.*$/, '') || PROD_BASE
  return Response.json({
    base,
    prodBase: PROD_BASE,
    isProd: base === PROD_BASE,
    configured: Boolean(pub),
    hasSecret: Boolean(process.env.CUSTOMER_APP_PUBLISH_SECRET),
  })
}
