import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  listCategories, listTags, getProductTags,
  saveCategory, deleteCategory, setFeaturedCategory,
  saveTag, deleteTag, setProductTags, assignCuratedTag,
  type AppCategory, type AppCatalogueTag,
} from '@/lib/catalogue-tags'

// Catalogue taxonomy control from connect — categories + filter tags + per-product
// curated assignments, all written straight into the customer app's Firestore via
// the Admin SDK (see lib/catalogue-tags.ts). Auth: any signed-in staff user, the
// same gate as the rest of the admin app.
//
//   GET                            → { categories, tags, productTags }
//   GET ?ids=a,b,c                 → productTags limited to those product ids
//   POST { action, ...payload }    → one mutation (see the switch)

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const idsParam = req.nextUrl.searchParams.get('ids')
    const ids = idsParam ? idsParam.split(',').map(s => s.trim()).filter(Boolean) : undefined
    const [categories, tags, productTags] = await Promise.all([
      listCategories(), listTags(), getProductTags(ids),
    ])
    return Response.json({ categories, tags, productTags })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to load tags'
    console.error('[catalogue/tags] GET', msg)
    return Response.json({ error: msg }, { status: 500 })
  }
}

type Body = {
  action?: string
  category?: Partial<AppCategory> & { id?: string }
  tag?: Partial<AppCatalogueTag> & { id?: string }
  id?: string
  featuredId?: string
  productId?: string
  productIds?: string[]
  tagIds?: string[]
  tagId?: string
  mode?: 'add' | 'remove'
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Body
  const action = body.action

  try {
    switch (action) {
      case 'saveCategory': {
        if (!body.category?.label?.trim()) return Response.json({ error: 'Category name is required.' }, { status: 400 })
        const r = await saveCategory(body.category)
        return Response.json({ ok: true, ...r })
      }
      case 'deleteCategory': {
        if (!body.id) return Response.json({ error: 'id is required' }, { status: 400 })
        await deleteCategory(body.id)
        return Response.json({ ok: true })
      }
      case 'featureCategory': {
        // '' clears the featured flag everywhere.
        await setFeaturedCategory(body.featuredId ?? '')
        return Response.json({ ok: true })
      }
      case 'saveTag': {
        if (!body.tag?.label?.trim()) return Response.json({ error: 'Tag label is required.' }, { status: 400 })
        const r = await saveTag(body.tag)
        return Response.json({ ok: true, ...r })
      }
      case 'deleteTag': {
        if (!body.id) return Response.json({ error: 'id is required' }, { status: 400 })
        await deleteTag(body.id)
        return Response.json({ ok: true })
      }
      case 'setProductTags': {
        if (!body.productId) return Response.json({ error: 'productId is required' }, { status: 400 })
        await setProductTags(body.productId, Array.isArray(body.tagIds) ? body.tagIds : [])
        return Response.json({ ok: true })
      }
      case 'assign': {
        if (!body.tagId) return Response.json({ error: 'tagId is required' }, { status: 400 })
        if (!Array.isArray(body.productIds) || body.productIds.length === 0)
          return Response.json({ error: 'No products selected' }, { status: 400 })
        if (body.mode !== 'add' && body.mode !== 'remove')
          return Response.json({ error: 'mode must be add or remove' }, { status: 400 })
        const r = await assignCuratedTag(body.tagId, body.productIds, body.mode)
        return Response.json({ ok: true, ...r })
      }
      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Tag action failed'
    console.error('[catalogue/tags] POST', action, msg)
    return Response.json({ error: msg }, { status: 500 })
  }
}
