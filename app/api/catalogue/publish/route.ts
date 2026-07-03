import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncProductToApp, resyncAllPublished } from '@/lib/catalogue-sync'

// Publishes (or un-publishes) catalogue products to the customer app's Firestore.
// Auth: any signed-in staff user (same gate as the rest of the admin app).
//   POST { id }          → sync that one product's current state
//   POST { resyncAll:true } → re-push every currently-published product
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, resyncAll } = (await req.json()) as { id?: string; resyncAll?: boolean }

  try {
    if (resyncAll) {
      const r = await resyncAllPublished()
      return Response.json({ ok: true, ...r })
    }
    if (!id) return Response.json({ error: 'id is required' }, { status: 400 })
    const r = await syncProductToApp(id)
    return Response.json({ ok: true, ...r })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Sync failed'
    console.error('[catalogue/publish]', msg)
    return Response.json({ error: msg }, { status: 500 })
  }
}
