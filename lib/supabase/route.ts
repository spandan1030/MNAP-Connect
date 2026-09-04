import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// The auth boilerplate every admin API route repeats: resolve the logged-in user
// from the request cookies. Returns null when unauthenticated so the caller can
// 401. Data reads/writes still go through supabaseAdmin (service role).
export async function getRouteUser() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return user
}
