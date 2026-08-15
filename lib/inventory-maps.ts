// Inventory name/purity mapping.
//
// The software's item names are messy (aliases, shortforms, embedded [DELETED]/(22CT)
// junk). We map the STABLE ITM_ID → one clean Connect item name, and only the clean
// name is ever shown/fed to the app. The map is seeded by majority vote from products
// that already have a real barcode, and learns whenever a salesman picks a name during
// Add+. Purity works the same way via a small raw→clean table.
//
// This file holds the pure string helpers (safe on client or server). DB reads/writes
// live in the API routes.

/** Strip software junk so two names can be compared / a raw name can be displayed. */
export function normalizeName(s: string): string {
  return s
    .replace(/\[[^\]]*\]/g, ' ')   // [DELETED] markers
    .replace(/\([^)]*\)/g, ' ')    // (22CT), (916) parentheticals
    .replace(/[^A-Za-z0-9 ]+/g, ' ') // quotes/punctuation → space
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

// Levenshtein distance (small strings — item names are short).
function lev(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  let cur = new Array<number>(n + 1)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[n]
}

/**
 * Similarity 0..1 between two names. The item-TYPE word ("RING", "PAYAL", "CHAIN") is
 * what matters, and software names prefix it with codes ("LC RING", "CB PAYAL"), so token
 * containment dominates: if one name's tokens are wholly inside the other, that scores
 * high. Jaccard rewards fuller overlap; a down-weighted char edit ratio only breaks in
 * for near-typos when tokens don't help at all.
 */
export function similarity(a: string, b: string): number {
  const na = normalizeName(a), nb = normalizeName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const ta = new Set(na.split(' ')), tb = new Set(nb.split(' '))
  const inter = [...ta].filter(x => tb.has(x)).length
  const jaccard = inter / (ta.size + tb.size - inter)
  const containment = inter / Math.min(ta.size, tb.size) // 1.0 when one is a subset of the other
  const editRatio = 1 - lev(na, nb) / Math.max(na.length, nb.length)
  return Math.max(jaccard, containment * 0.82, editRatio * 0.55)
}

export interface NameSuggestion { name: string; score: number }

/** Best matching clean name for a raw software name among known Connect names. */
export function suggestName(raw: string, candidates: string[], minScore = 0.34): NameSuggestion | null {
  let best: NameSuggestion | null = null
  for (const c of candidates) {
    const score = similarity(raw, c)
    if (!best || score > best.score) best = { name: c, score }
  }
  return best && best.score >= minScore ? best : null
}

// ---- Majority vote (used by the rebuild endpoint) --------------------------

export interface ProductNameSample { itmId: number; cleanName: string }

export interface ItemNameMapping { itm_id: number; clean_name: string; hits: number }

/**
 * Build itm_id → clean name by majority vote over products that already carry a real
 * barcode (joined to the inventory master to get their itm_id). For each itm_id the
 * most frequently assigned clean name wins; ties break on the longer (more specific)
 * name. Returns one mapping per itm_id, with `hits` = votes for the winner.
 */
export function majorityVoteNames(samples: ProductNameSample[]): ItemNameMapping[] {
  const byItem = new Map<number, Map<string, number>>()
  for (const s of samples) {
    const name = s.cleanName?.trim()
    if (!name) continue
    let counts = byItem.get(s.itmId)
    if (!counts) { counts = new Map(); byItem.set(s.itmId, counts) }
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const out: ItemNameMapping[] = []
  for (const [itmId, counts] of byItem) {
    let winner = ''; let hits = 0
    for (const [name, c] of counts) {
      if (c > hits || (c === hits && name.length > winner.length)) { winner = name; hits = c }
    }
    if (winner) out.push({ itm_id: itmId, clean_name: winner, hits })
  }
  return out
}
