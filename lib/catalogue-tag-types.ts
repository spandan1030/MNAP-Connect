// Pure types + constants for catalogue tags/categories — safe to import from
// BOTH client and server (no firebase-admin here). The server helpers that touch
// the customer Firestore live in ./catalogue-tags (server-only).

export const DEFAULT_TAG_TOLERANCE_PCT = 12.5

export type TagKind = 'curated' | 'computed'
export type TagMetric = 'amountMax' | 'weightRange'

export interface AppCategory {
  id: string
  label: string
  thumb: string
  matchStrings: string[]
  order: number
  featured: boolean
  active: boolean
  createdAt: number
}

export interface AppCatalogueTag {
  id: string
  label: string
  kind: TagKind
  order: number
  active: boolean
  categories?: string[]   // categories this tag belongs to (both kinds); []/absent = all
  scope?: string          // legacy computed single scope — read as fallback only
  metric?: TagMetric      // computed only
  amountMax?: number      // computed + metric==='amountMax'
  weightMin?: number      // computed + metric==='weightRange'
  weightMax?: number      // computed + metric==='weightRange'
  tolerancePct?: number   // computed only
  createdAt: number
}

/** Categories a tag belongs to. [] ⇒ global. New `categories` wins; old docs fall
 *  back to the legacy single `scope`. Mirrors the customer app's helper. */
export function effectiveTagCategories(tag: { categories?: string[]; scope?: string }): string[] {
  if (Array.isArray(tag.categories)) return tag.categories.filter(Boolean)
  const s = (tag.scope ?? '').trim()
  return s && s !== 'all' ? [s] : []
}
