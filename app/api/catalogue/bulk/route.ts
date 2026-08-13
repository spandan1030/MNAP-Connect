import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { syncProductToApp, removeProductFromApp } from '@/lib/catalogue-sync'

// Bulk actions on a set of selected products (from the catalogue grid).
// Auth: any signed-in staff user (same gate as the rest of the admin app).
//   POST { ids: string[], action, ...args }
//
// Supported actions (v1):
//   sold        { sold: boolean }            → flip is_sold      (re-sync published: stock status)
//   review      { review: boolean }          → flip needs_review (no app impact)
//   publish     { publish: boolean, makingPercent?: number|null }
//                                            → flip show_in_app  (publish/unpublish + sync each)
//   set_party   { party: string }            → set party         (party is never sent to the app → no sync)
//   set_making  { makingPercent: number }    → set making_percent(re-sync published: price input)
//   delete      {}                           → remove from app + delete photos/storage + delete rows
type Action = 'sold' | 'review' | 'publish' | 'set_party' | 'set_making' | 'delete'

type ProductRow = { id: string; show_in_app: boolean | null }

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as {
    ids?: unknown; action?: unknown
    sold?: unknown; review?: unknown; publish?: unknown
    makingPercent?: unknown; party?: unknown
  }

  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String).filter(Boolean))] : []
  const action = body.action as Action
  if (ids.length === 0) return Response.json({ error: 'No products selected' }, { status: 400 })

  // We need show_in_app for every affected row to decide what to re-sync.
  const { data: rowsData, error: rErr } = await supabase
    .from('wa_products').select('id, show_in_app').in('id', ids)
  if (rErr) return Response.json({ error: rErr.message }, { status: 500 })
  const rows = (rowsData ?? []) as ProductRow[]
  const publishedIds = rows.filter(r => r.show_in_app).map(r => r.id)
  const now = new Date().toISOString()

  async function resync(targetIds: string[]) {
    for (const id of targetIds) {
      await syncProductToApp(id).catch(e => console.error('[catalogue/bulk] resync failed', id, e))
    }
  }

  try {
    switch (action) {
      case 'sold': {
        const sold = Boolean(body.sold)
        const { error } = await supabase.from('wa_products')
          .update({ is_sold: sold, updated_at: now }).in('id', ids)
        if (error) throw new Error(error.message)
        await resync(publishedIds) // stock status changes what the app shows
        return Response.json({ ok: true, updated: rows.length })
      }
      case 'review': {
        const review = Boolean(body.review)
        const { error } = await supabase.from('wa_products')
          .update({ needs_review: review }).in('id', ids)
        if (error) throw new Error(error.message)
        return Response.json({ ok: true, updated: rows.length }) // not sent to the app
      }
      case 'publish': {
        const publish = Boolean(body.publish)
        // Only override making_percent when a value was supplied; otherwise keep each row's own.
        const hasMaking = body.makingPercent !== undefined && body.makingPercent !== null && body.makingPercent !== ''
        const patch: Record<string, unknown> = { show_in_app: publish, updated_at: now }
        if (publish && hasMaking) patch.making_percent = Number(body.makingPercent)
        const { error } = await supabase.from('wa_products').update(patch).in('id', ids)
        if (error) throw new Error(error.message)
        // Publishing pushes each doc; unpublishing removes it (syncProductToApp handles both).
        await resync(ids)
        return Response.json({ ok: true, updated: rows.length })
      }
      case 'set_party': {
        const party = String(body.party ?? '').trim()
        if (!party) return Response.json({ error: 'Party is required' }, { status: 400 })
        const { error } = await supabase.from('wa_products')
          .update({ party, updated_at: now }).in('id', ids)
        if (error) throw new Error(error.message)
        return Response.json({ ok: true, updated: rows.length }) // party is never published
      }
      case 'set_making': {
        if (body.makingPercent === undefined || body.makingPercent === null || body.makingPercent === '')
          return Response.json({ error: 'Making % is required' }, { status: 400 })
        const makingPercent = Number(body.makingPercent)
        if (!Number.isFinite(makingPercent)) return Response.json({ error: 'Invalid making %' }, { status: 400 })
        const { error } = await supabase.from('wa_products')
          .update({ making_percent: makingPercent, updated_at: now }).in('id', ids)
        if (error) throw new Error(error.message)
        await resync(publishedIds) // making % feeds the app's live price
        return Response.json({ ok: true, updated: rows.length })
      }
      case 'delete': {
        // 1) pull the app docs for anything currently published (single-delete misses this)
        for (const id of publishedIds) await removeProductFromApp(id)
        // 2) clean up photos + their storage objects
        const { data: imgs } = await supabase.from('wa_product_images')
          .select('id, image_url, thumb_url, display_url, display_thumb_url').in('product_id', ids)
        const paths = ((imgs ?? []) as Array<Record<string, string | null>>)
          .flatMap(i => [i.image_url, i.thumb_url, i.display_url, i.display_thumb_url])
          .map(u => u?.split('/wa-media/')[1]).filter(Boolean) as string[]
        if (paths.length) await supabase.storage.from('wa-media').remove(paths)
        await supabase.from('wa_product_images').delete().in('product_id', ids)
        // 3) delete the product rows
        const { error } = await supabase.from('wa_products').delete().in('id', ids)
        if (error) throw new Error(error.message)
        return Response.json({ ok: true, deleted: ids.length })
      }
      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Bulk action failed'
    console.error('[catalogue/bulk]', action, msg)
    return Response.json({ error: msg }, { status: 500 })
  }
}
