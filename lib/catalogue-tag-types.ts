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
  scope?: string          // computed only: category id, or '' = all products
  metric?: TagMetric      // computed only
  amountMax?: number      // computed + metric==='amountMax'
  weightMin?: number      // computed + metric==='weightRange'
  weightMax?: number      // computed + metric==='weightRange'
  tolerancePct?: number   // computed only
  createdAt: number
}
