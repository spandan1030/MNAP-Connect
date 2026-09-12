// Catalogue tags & categories — SERVER-ONLY control from connect.
//
// The customer app keeps its storefront taxonomy in THREE Firestore collections,
// deliberately separate from the `catalogue/{id}` product docs so a connect
// catalogue re-sync (which overwrites those) never wipes them:
//   categories/{id}        → a "Shop by category" section, matched to products by
//                            Item-Name string (rule-based, NOT per product)
//   catalogue_tags/{id}    → a filter chip: 'curated' (assigned per product) or
//                            'computed' (a live amount/weight rule)
//   catalogue_meta/{pid}   → { tags: string[] } — the curated tag ids on product
//                            `pid` (== wa_products.id == catalogue doc id)
//
// connect already holds a Firebase Admin handle to the customer project
// (customerDb()), which bypasses Firestore rules. So we read/write these three
// collections DIRECTLY — no Supabase mirror, no sync layer, no drift. The customer
// app's admin still edits the same docs; both surfaces are just editors of one
// source of truth. Field shapes below MUST stay identical to the customer app's
// coerce/save logic (src/lib/catalogueFilters.ts) so the two never disagree.

import { customerDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  DEFAULT_TAG_TOLERANCE_PCT,
  type TagKind, type TagMetric, type AppCategory, type AppCatalogueTag,
} from '@/lib/catalogue-tag-types'

export { DEFAULT_TAG_TOLERANCE_PCT }
export type { TagKind, TagMetric, AppCategory, AppCatalogueTag }

// ── reads ───────────────────────────────────────────────────────────────────

function coerceCategory(id: string, d: FirebaseFirestore.DocumentData): AppCategory {
  return {
    id,
    label: (d.label as string) ?? '',
    thumb: (d.thumb as string) ?? '',
    matchStrings: Array.isArray(d.matchStrings) ? (d.matchStrings as string[]) : [],
    order: (d.order as number) ?? 0,
    featured: Boolean(d.featured),
    active: d.active !== false,
    createdAt: (d.createdAt as number) ?? 0,
  }
}

function coerceTag(id: string, d: FirebaseFirestore.DocumentData): AppCatalogueTag {
  return {
    id,
    label: (d.label as string) ?? '',
    kind: (d.kind as TagKind) ?? 'curated',
    order: (d.order as number) ?? 0,
    active: d.active !== false,
    scope: (d.scope as string) ?? '',
    metric: (d.metric as TagMetric) ?? undefined,
    amountMax: (d.amountMax as number) ?? undefined,
    weightMin: (d.weightMin as number) ?? undefined,
    weightMax: (d.weightMax as number) ?? undefined,
    tolerancePct: (d.tolerancePct as number) ?? DEFAULT_TAG_TOLERANCE_PCT,
    createdAt: (d.createdAt as number) ?? 0,
  }
}

const byOrder = <T extends { order: number; createdAt: number }>(a: T, b: T) =>
  a.order - b.order || a.createdAt - b.createdAt

export async function listCategories(): Promise<AppCategory[]> {
  const snap = await customerDb().collection('categories').get()
  return snap.docs.map(d => coerceCategory(d.id, d.data())).sort(byOrder)
}

export async function listTags(): Promise<AppCatalogueTag[]> {
  const snap = await customerDb().collection('catalogue_tags').get()
  return snap.docs.map(d => coerceTag(d.id, d.data())).sort(byOrder)
}

/**
 * curated tag ids per product, from catalogue_meta. With `ids` given, reads just
 * those docs (for the catalogue grid); without, scans the whole collection —
 * bounded because only TAGGED products have a doc there.
 */
export async function getProductTags(ids?: string[]): Promise<Record<string, string[]>> {
  const db = customerDb()
  const out: Record<string, string[]> = {}
  if (ids && ids.length) {
    // getAll is limited only by request size; chunk generously to stay safe.
    for (let i = 0; i < ids.length; i += 300) {
      const refs = ids.slice(i, i + 300).map(id => db.collection('catalogue_meta').doc(id))
      const docs = await db.getAll(...refs)
      for (const d of docs) {
        const t = d.get('tags')
        if (Array.isArray(t) && t.length) out[d.id] = t as string[]
      }
    }
    return out
  }
  const snap = await db.collection('catalogue_meta').get()
  for (const d of snap.docs) {
    const t = d.get('tags')
    if (Array.isArray(t) && t.length) out[d.id] = t as string[]
  }
  return out
}

// ── writes ──────────────────────────────────────────────────────────────────
// Drop undefined so Firestore accepts the doc (mirrors the customer app's clean()).

function clean<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as T
  for (const k in obj) if (obj[k] !== undefined) out[k] = obj[k]
  return out
}

export async function saveCategory(input: Partial<AppCategory> & { id?: string }): Promise<{ id: string }> {
  const db = customerDb()
  const data = clean({
    label: (input.label ?? '').trim(),
    thumb: (input.thumb ?? '').trim(),
    matchStrings: (input.matchStrings ?? []).map(s => s.trim()).filter(Boolean),
    order: input.order ?? 0,
    featured: Boolean(input.featured),
    active: input.active !== false,
  })
  if (input.id) {
    await db.collection('categories').doc(input.id).set(data, { merge: true })
    return { id: input.id }
  }
  const ref = await db.collection('categories').add({ ...data, createdAt: Date.now() })
  return { id: ref.id }
}

export async function deleteCategory(id: string): Promise<void> {
  await customerDb().collection('categories').doc(id).delete()
}

/** Mark ONE category featured (clearing the flag on every other), or pass '' to clear all. */
export async function setFeaturedCategory(featuredId: string): Promise<void> {
  const db = customerDb()
  const snap = await db.collection('categories').get()
  const batch = db.batch()
  snap.docs.forEach(d => {
    const shouldBe = d.id === featuredId
    if (Boolean(d.get('featured')) !== shouldBe) batch.update(d.ref, { featured: shouldBe })
  })
  await batch.commit()
}

export async function saveTag(input: Partial<AppCatalogueTag> & { id?: string }): Promise<{ id: string }> {
  const db = customerDb()
  const isComputed = input.kind === 'computed'
  const data = clean({
    label: (input.label ?? '').trim(),
    kind: input.kind ?? 'curated',
    order: input.order ?? 0,
    active: input.active !== false,
    scope: isComputed ? input.scope ?? '' : undefined,
    metric: isComputed ? input.metric : undefined,
    amountMax: isComputed && input.metric === 'amountMax' ? input.amountMax ?? 0 : undefined,
    weightMin: isComputed && input.metric === 'weightRange' ? input.weightMin ?? 0 : undefined,
    weightMax: isComputed && input.metric === 'weightRange' ? input.weightMax ?? 0 : undefined,
    tolerancePct: isComputed ? input.tolerancePct ?? DEFAULT_TAG_TOLERANCE_PCT : undefined,
  })
  if (input.id) {
    // Full replace (merge:false) so switching computed→curated drops stale rule fields —
    // matches the customer app's saveTag.
    await db.collection('catalogue_tags').doc(input.id).set(data, { merge: false })
    return { id: input.id }
  }
  const ref = await db.collection('catalogue_tags').add({ ...data, createdAt: Date.now() })
  return { id: ref.id }
}

export async function deleteTag(id: string): Promise<void> {
  await customerDb().collection('catalogue_tags').doc(id).delete()
}

/** Replace the full curated-tag list on one product. */
export async function setProductTags(productId: string, tagIds: string[]): Promise<void> {
  await customerDb().collection('catalogue_meta').doc(productId)
    .set({ tags: tagIds, updatedAt: Date.now() }, { merge: true })
}

/**
 * Add or remove ONE curated tag across many products at once — the headline
 * bulk-tagging path. arrayUnion/arrayRemove are idempotent and create the
 * catalogue_meta doc on first touch, so no read-modify-write is needed.
 */
export async function assignCuratedTag(
  tagId: string, productIds: string[], mode: 'add' | 'remove',
): Promise<{ changed: number }> {
  const db = customerDb()
  const ids = [...new Set(productIds.filter(Boolean))]
  const value = mode === 'add' ? FieldValue.arrayUnion(tagId) : FieldValue.arrayRemove(tagId)
  // Firestore batches cap at 500 ops.
  for (let i = 0; i < ids.length; i += 450) {
    const batch = db.batch()
    for (const pid of ids.slice(i, i + 450)) {
      batch.set(db.collection('catalogue_meta').doc(pid),
        { tags: value, updatedAt: Date.now() }, { merge: true })
    }
    await batch.commit()
  }
  return { changed: ids.length }
}
