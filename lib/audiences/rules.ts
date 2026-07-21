// ═══════════════════════════════════════════════════════════════════════════
//  THE RULE ENGINE — an audience is a set of rules over customer_features.
//
//  Shape (deliberately ONE level of nesting, so it stays readable on a phone):
//
//      tree = groups joined by OR
//      group = rules joined by AND
//      rule  = field · operator · value, optionally negated
//
//  Every rule is a question about a PERSON, and the whole tree compiles to a
//  SINGLE PostgREST query against the view — not one query per rule. So a
//  five-rule audience is one round trip, not five.
//
//  SAFETY: field names come from the registry below and never from user input,
//  and every value is validated against that field's declared options before it
//  reaches a filter string. Nothing is interpolated unchecked.
//
//  WHY A REGISTRY: adding a feature used to mean a type change + a resolver
//  branch + a UI band. Now it is one entry here — the field appears in the
//  dropdown, gets the right operators for its type, and becomes filterable, all
//  at once.
// ═══════════════════════════════════════════════════════════════════════════

import { INTERESTS, INTEREST_KEYS } from '@/lib/signals'
import { describeInterval, isUsableInterval, type Interval } from './intervals'
import {
  RECENCY_TIERS, VALUE_TIERS, RFM_SEGMENTS, FREQUENCY_TIERS, PRIMARY_METALS,
  CALL_TOPICS,
} from '@/lib/calls'

// ── Types ──────────────────────────────────────────────────────────────────

export type FieldType = 'choice' | 'array' | 'number' | 'date' | 'boolean' | 'interest'

export type RuleOp =
  | 'any_of'        // choice: value in list · array: array overlaps list
  | 'exists'        // not null / non-empty
  | 'gte' | 'lte' | 'between'
  | 'before' | 'after' | 'in_last_days'
  | 'is_true'

export interface Rule {
  field: string           // FieldDef.key — never a raw column name from the client
  op: RuleOp
  values?: string[]       // any_of · interest keys for the `interest` field
  sources?: string[]      // `interest` only — which channels it came from
  min?: number
  max?: number
  from?: string           // YYYY-MM-DD
  to?: string
  days?: number           // in_last_days
  not?: boolean           // negate this rule
}

export interface RuleGroup { rules: Rule[] }

// A tree is: (groups OR'd together) AND (every interval).
//
// Rules ask about a PERSON and compile to one query on the feature view.
// Intervals ask whether an EVENT happened in a window, which the feature view
// cannot answer — it remembers only the most recent of each thing. They stay
// separate mechanisms on purpose; see lib/audiences/intervals.ts.
export interface RuleTree {
  groups: RuleGroup[]
  intervals?: Interval[]
}

export interface FieldDef {
  key: string
  column: string
  label: string
  group: string
  type: FieldType
  dateColumn?: string                 // `interest`: where its last-seen lives
  options?: { value: string; label: string }[]
  optionsFrom?: 'call_campaigns' | 'topics' | 'ad_campaigns' | 'salesmen'
  hint?: string
}

const opt = (vals: readonly string[]) => vals.map(v => ({ value: v, label: v }))

const SOURCE_OPTIONS = [
  { value: 'whatsapp', label: 'Chat' },
  { value: 'call', label: 'Call' },
  { value: 'walkin', label: 'Walk-in' },
  { value: 'sales', label: 'Sales' },
  { value: 'ad', label: 'Ad' },
  { value: 'billing', label: 'Billing' },
]

// ── The registry ───────────────────────────────────────────────────────────
export const FIELDS: FieldDef[] = [
  // Sales — who they are as a buyer
  { key: 'sales_recency_tier', column: 'sales_recency_tier', label: 'Recency', group: 'Sales', type: 'choice', options: opt(RECENCY_TIERS), hint: 'Recent <1yr · Active 1–3yr · Lapsed >3yr' },
  { key: 'sales_value_tier', column: 'sales_value_tier', label: 'Value tier', group: 'Sales', type: 'choice', options: opt(VALUE_TIERS) },
  { key: 'sales_rfm_segment', column: 'sales_rfm_segment', label: 'RFM segment', group: 'Sales', type: 'choice', options: opt(RFM_SEGMENTS) },
  { key: 'sales_frequency_tier', column: 'sales_frequency_tier', label: 'Frequency', group: 'Sales', type: 'choice', options: opt(FREQUENCY_TIERS) },
  { key: 'sales_primary_metal', column: 'sales_primary_metal', label: 'Primary metal', group: 'Sales', type: 'choice', options: opt(PRIMARY_METALS) },
  { key: 'sales_is_high_value', column: 'sales_is_high_value', label: 'High value', group: 'Sales', type: 'boolean', hint: '≥15g gold OR diamond OR cheque ≥₹50k' },
  { key: 'sales_is_likely_wedding', column: 'sales_is_likely_wedding', label: 'Likely wedding buyer', group: 'Sales', type: 'boolean' },
  { key: 'sales_lifetime_value', column: 'sales_lifetime_value', label: 'Lifetime value (₹)', group: 'Sales', type: 'number' },
  { key: 'sales_total_bills', column: 'sales_total_bills', label: 'Number of bills', group: 'Sales', type: 'number' },
  { key: 'sales_last_purchase_date', column: 'sales_last_purchase_date', label: 'Last purchase', group: 'Sales', type: 'date' },
  { key: 'sales_days_since_purchase', column: 'sales_days_since_purchase', label: 'Days since purchase', group: 'Sales', type: 'number' },
  { key: 'sales_outreach_bucket', column: 'sales_outreach_bucket', label: 'Outreach wave', group: 'Sales', type: 'choice', options: opt(['00-03m', '03-06m', '06-12m', '12-24m', '24-36m', '36m+ (lapsed)']) },
  { key: 'is_buyer', column: 'is_buyer', label: 'Has ever bought', group: 'Sales', type: 'boolean' },

  // Call
  { key: 'call_attempts', column: 'call_attempts', label: 'Call attempts', group: 'Call', type: 'number' },
  { key: 'call_connected', column: 'call_connected', label: 'Calls connected', group: 'Call', type: 'number' },
  { key: 'call_disconnects', column: 'call_disconnects', label: 'Disconnects', group: 'Call', type: 'number', hint: '≥4 retires them from calling' },
  { key: 'call_last_at', column: 'call_last_at', label: 'Last called', group: 'Call', type: 'date' },
  { key: 'call_last_intent', column: 'call_last_intent', label: 'Last call outcome', group: 'Call', type: 'choice', options: [
    { value: 'will_come', label: 'Will come' }, { value: 'not_sure', label: 'Not sure' },
    { value: 'wont_come', label: 'Won’t come' }, { value: 'dont_call', label: 'Don’t call' }] },
  { key: 'call_intents', column: 'call_intents', label: 'Ever said (any call)', group: 'Call', type: 'array', options: [
    { value: 'will_come', label: 'Will come' }, { value: 'not_sure', label: 'Not sure' },
    { value: 'wont_come', label: 'Won’t come' }, { value: 'dont_call', label: 'Don’t call' }] },
  { key: 'call_topics', column: 'call_topics', label: 'Call topics', group: 'Call', type: 'array', options: CALL_TOPICS.map(t => ({ value: t.value, label: t.label })) },
  { key: 'call_is_hot', column: 'call_is_hot', label: 'Starred hot ★', group: 'Call', type: 'boolean' },
  { key: 'call_campaign_ids', column: 'call_campaign_ids', label: 'Was in call cohort', group: 'Call', type: 'array', optionsFrom: 'call_campaigns' },

  // Chat
  { key: 'chat_last_inbound_at', column: 'chat_last_inbound_at', label: 'Last messaged us', group: 'Chat', type: 'date' },
  { key: 'chat_inbound_count', column: 'chat_inbound_count', label: 'Messages from them', group: 'Chat', type: 'number' },
  { key: 'chat_subscribed_topics', column: 'chat_subscribed_topics', label: 'Subscribed to', group: 'Chat', type: 'array', optionsFrom: 'topics', hint: 'Explicit subscription pool (e.g. Daily Rate)' },
  { key: 'chat_subscribed_at', column: 'chat_subscribed_at', label: 'Subscribed on', group: 'Chat', type: 'date' },

  // Walk-in
  { key: 'walkin_last_at', column: 'walkin_last_at', label: 'Last store visit', group: 'Walk-in', type: 'date' },
  { key: 'walkin_timing', column: 'walkin_timing', label: 'Said they’ll buy', group: 'Walk-in', type: 'choice', options: [
    { value: 'within_7d', label: 'Within 7 days' }, { value: 'within_1m', label: 'Within 1 month' }, { value: '1_3m', label: '1–3 months' }] },
  { key: 'walkin_no_purchase', column: 'walkin_no_purchase', label: 'Visited, not bought since', group: 'Walk-in', type: 'boolean', hint: 'Compares last purchase against the visit date' },
  // wa_050/051: real visit history. Counts start at 1 for anyone who visited
  // before the log existed — their earlier visits were overwritten and are gone.
  { key: 'walkin_count', column: 'walkin_count', label: 'Number of visits', group: 'Walk-in', type: 'number', hint: 'History starts 19 Jul 2026; earlier repeat visits were not kept' },
  { key: 'walkin_is_repeat', column: 'walkin_is_repeat', label: 'Has visited more than once', group: 'Walk-in', type: 'boolean' },
  { key: 'walkin_first_at', column: 'walkin_first_at', label: 'First store visit', group: 'Walk-in', type: 'date' },
  { key: 'walkin_salesman', column: 'walkin_salesman', label: 'Enrolled by (salesman)', group: 'Walk-in', type: 'choice', optionsFrom: 'salesmen', hint: 'Who signed them in on their latest visit' },

  // Customer app — who they are on the app (export) + product interest tapped in chat
  { key: 'app_is_user', column: 'app_is_user', label: 'App user', group: 'App', type: 'boolean', hint: 'Has an account on the customer app (from the app-admin export)' },
  { key: 'app_has_scheme', column: 'app_has_scheme', label: 'Has gold scheme', group: 'App', type: 'boolean', hint: 'Holds a gold-savings scheme in the app' },
  { key: 'app_product_interest', column: 'app_product_interest', label: 'App product interest', group: 'App', type: 'boolean', hint: 'Tapped “interested” / shared a product link into WhatsApp' },
  { key: 'app_product_interest_at', column: 'app_product_interest_at', label: 'App interest noted', group: 'App', type: 'date' },

  // Ads
  { key: 'ad_is_lead', column: 'ad_is_lead', label: 'Came from an ad', group: 'Ads', type: 'boolean' },
  { key: 'ad_campaigns', column: 'ad_campaigns', label: 'Ad campaign', group: 'Ads', type: 'array', optionsFrom: 'ad_campaigns' },
  { key: 'ad_first_at', column: 'ad_first_at', label: 'Ad lead arrived', group: 'Ads', type: 'date' },

  // Interests + cross-source
  { key: 'interest', column: '', label: 'Interest', group: 'Interests', type: 'interest',
    options: INTERESTS.map(i => ({ value: i.key, label: i.label })),
    hint: 'Pick interests, and optionally which channel they came from' },
  { key: 'sources', column: 'sources', label: 'Channels touched', group: 'Interests', type: 'array', options: SOURCE_OPTIONS },
  { key: 'source_count', column: 'source_count', label: 'Number of channels', group: 'Interests', type: 'number', hint: 'Any touch — a visit or ad lead counts, even with no tagged interest' },
  { key: 'signal_sources', column: 'signal_sources', label: 'Interest came from', group: 'Interests', type: 'array', options: SOURCE_OPTIONS },
  // The narrow twin of source_count: channels that produced a tagged INTEREST,
  // not counting a bare visit or ad lead. This is what the chips "Multi-source
  // intent" means (≥2), which is a different question from Number of channels.
  { key: 'signal_source_count', column: 'signal_source_count', label: 'Interest channels (count)', group: 'Interests', type: 'number', hint: '≥2 = the chips “Multi-source intent”. Counts only channels that tagged an interest' },
  { key: 'is_opted_out', column: 'is_opted_out', label: 'Opted out of contact', group: 'Identity', type: 'boolean', hint: 'Blocks chat + call; ads unaffected' },
]

export const FIELD_BY_KEY: Record<string, FieldDef> = Object.fromEntries(FIELDS.map(f => [f.key, f]))
export const INTEREST_SOURCE_OPTIONS = SOURCE_OPTIONS

// Which operators a field type offers — this is what makes the builder
// self-describing: pick a field, get the operators that make sense for it.
export function opsFor(type: FieldType): { op: RuleOp; label: string }[] {
  switch (type) {
    case 'choice': return [{ op: 'any_of', label: 'is any of' }, { op: 'exists', label: 'has any value' }]
    case 'array': return [{ op: 'any_of', label: 'includes any of' }, { op: 'exists', label: 'has any' }]
    case 'number': return [{ op: 'gte', label: 'at least' }, { op: 'lte', label: 'at most' }, { op: 'between', label: 'between' }, { op: 'exists', label: 'is known' }]
    case 'date': return [{ op: 'in_last_days', label: 'in the last (days)' }, { op: 'after', label: 'on or after' }, { op: 'before', label: 'on or before' }, { op: 'between', label: 'between' }, { op: 'exists', label: 'ever' }]
    case 'boolean': return [{ op: 'is_true', label: 'is yes' }]
    case 'interest': return [{ op: 'any_of', label: 'is any of' }, { op: 'in_last_days', label: 'seen in the last (days)' }]
  }
}

// ── Compiling a rule to a PostgREST predicate ──────────────────────────────

const isIsoDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

function daysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - Math.max(0, Math.floor(days)))
  return d.toLocaleDateString('en-CA')
}

// Only values the field itself declares are allowed through. Anything else is
// dropped, so a filter string can never carry unchecked input.
function allowed(f: FieldDef, values: string[] | undefined): string[] {
  if (!values?.length) return []
  if (!f.options) return values.filter(v => /^[A-Za-z0-9_\-:. ]{1,64}$/.test(v))  // dynamic (campaigns/topics): ids & slugs
  const ok = new Set(f.options.map(o => o.value))
  return values.filter(v => ok.has(v))
}

// A rule → one PostgREST predicate, or null when it can't be satisfied.
// `not` wraps it: PostgREST spells negation as `col.not.<op>.<value>`.
export function ruleToPredicate(rule: Rule): string | null {
  const f = FIELD_BY_KEY[rule.field]
  if (!f) return null
  const n = rule.not ? 'not.' : ''

  // The interest field is special: it spans per-interest columns, so it emits
  // its own or(...) across them. `int_wedding_src ov {walkin}` IS "a wedding
  // signal that came from a walk-in" — row-accurate without touching wa_signals.
  if (f.type === 'interest') {
    const keys = (rule.values ?? []).filter(k => (INTEREST_KEYS as string[]).includes(k))
    if (!keys.length) return null
    const srcs = (rule.sources ?? []).filter(s => SOURCE_OPTIONS.some(o => o.value === s))
    let parts: string[]
    if (rule.op === 'in_last_days') {
      if (!isNum(rule.days)) return null
      const cut = daysAgo(rule.days)
      parts = keys.map(k => `int_${k}_at.gte.${cut}`)
    } else if (srcs.length) {
      parts = keys.map(k => `int_${k}_src.ov.{${srcs.join(',')}}`)
    } else {
      parts = keys.map(k => `int_${k}_src.not.is.null`)
    }
    // Negation must wrap the WHOLE set, so it always becomes not.or(...) — you
    // cannot prefix `not.` onto an already-negated single predicate.
    if (rule.not) return `not.or(${parts.join(',')})`
    return parts.length === 1 ? parts[0] : `or(${parts.join(',')})`
  }

  const col = f.column

  switch (rule.op) {
    case 'any_of': {
      const vals = allowed(f, rule.values)
      if (!vals.length) return null
      return f.type === 'array'
        ? `${col}.${n}ov.{${vals.join(',')}}`
        : `${col}.${n}in.(${vals.map(v => `"${v.replace(/"/g, '')}"`).join(',')})`
    }
    // "exists" is not-null; negating it is plain is-null. Never `not.not.`.
    case 'exists':
      return rule.not ? `${col}.is.null` : `${col}.not.is.null`
    // Booleans in the view are COALESCEd, so there are no NULLs to worry about
    // and the negation is simply is.false.
    case 'is_true':
      return rule.not ? `${col}.is.false` : `${col}.is.true`
    case 'gte':
      return isNum(rule.min) ? `${col}.${n}gte.${rule.min}` : null
    case 'lte':
      return isNum(rule.max) ? `${col}.${n}lte.${rule.max}` : null
    case 'between': {
      let inner: string
      if (f.type === 'number') {
        if (!isNum(rule.min) || !isNum(rule.max)) return null
        inner = `and(${col}.gte.${rule.min},${col}.lte.${rule.max})`
      } else {
        if (!isIsoDate(rule.from) || !isIsoDate(rule.to)) return null
        inner = `and(${col}.gte.${rule.from},${col}.lte.${rule.to})`
      }
      return rule.not ? `not.${inner}` : inner
    }
    case 'after':
      return isIsoDate(rule.from) ? `${col}.${n}gte.${rule.from}` : null
    case 'before':
      return isIsoDate(rule.to) ? `${col}.${n}lte.${rule.to}` : null
    case 'in_last_days':
      return isNum(rule.days) ? `${col}.${n}gte.${daysAgo(rule.days)}` : null
    default:
      return null
  }
}

// The whole tree → one PostgREST `or=` string:
//   or( and(rule,rule), and(rule) )
// Groups are OR'd, rules inside a group AND'd — exactly what the UI shows.
export function treeToFilterString(tree: RuleTree): { filter: string | null; ruleCount: number } {
  const groups: string[] = []
  let ruleCount = 0
  for (const g of tree.groups ?? []) {
    const preds = (g.rules ?? []).map(ruleToPredicate).filter((p): p is string => !!p)
    if (!preds.length) continue
    ruleCount += preds.length
    groups.push(preds.length === 1 ? preds[0] : `and(${preds.join(',')})`)
  }
  if (!groups.length) return { filter: null, ruleCount: 0 }
  return { filter: groups.length === 1 ? groups[0] : groups.join(','), ruleCount }
}

// Empty means "asks nothing". An interval alone is a perfectly good audience
// ("everyone who walked in last week"), so it counts.
export function isEmptyTree(tree: RuleTree | null | undefined): boolean {
  if (!tree) return true
  const hasRules = (tree.groups ?? []).some(g => g.rules?.length)
  const hasIntervals = (tree.intervals ?? []).some(isUsableInterval)
  return !hasRules && !hasIntervals
}

export function emptyTree(): RuleTree {
  return { groups: [{ rules: [] }], intervals: [] }
}

/** The intervals that are complete enough to apply. */
export function usableIntervals(tree: RuleTree): Interval[] {
  return (tree.intervals ?? []).filter(isUsableInterval)
}

// Plain-English rendering, for the audience list and the reference docs.
export function describeRule(rule: Rule): string {
  const f = FIELD_BY_KEY[rule.field]
  if (!f) return 'unknown rule'
  const not = rule.not ? 'NOT ' : ''
  const labelOf = (v: string) => f.options?.find(o => o.value === v)?.label ?? v
  if (f.type === 'interest') {
    const names = (rule.values ?? []).map(labelOf).join(' or ')
    if (rule.op === 'in_last_days') return `${not}${names} seen in last ${rule.days}d`
    const src = rule.sources?.length ? ` from ${rule.sources.join('/')}` : ''
    return `${not}interested in ${names}${src}`
  }
  switch (rule.op) {
    case 'any_of': return `${not}${f.label} is ${(rule.values ?? []).map(labelOf).join(' or ')}`
    case 'exists': return `${not}${f.label} exists`
    case 'is_true': return `${not}${f.label}`
    case 'gte': return `${not}${f.label} ≥ ${rule.min}`
    case 'lte': return `${not}${f.label} ≤ ${rule.max}`
    case 'between': return f.type === 'number' ? `${not}${f.label} ${rule.min}–${rule.max}` : `${not}${f.label} ${rule.from} → ${rule.to}`
    case 'after': return `${not}${f.label} on/after ${rule.from}`
    case 'before': return `${not}${f.label} on/before ${rule.to}`
    case 'in_last_days': return `${not}${f.label} in last ${rule.days}d`
    default: return f.label
  }
}

export function describeTree(tree: RuleTree): string {
  const groups = (tree.groups ?? [])
    .filter(g => g.rules?.length)
    .map(g => g.rules.map(describeRule).join(' AND '))
  const rulePart = groups.length === 0 ? ''
    : groups.length === 1 ? groups[0]
    : groups.map(g => `(${g})`).join(' OR ')

  const ivs = usableIntervals(tree).map(describeInterval)
  if (!rulePart && !ivs.length) return 'no rules'
  // Parenthesise the OR side so the AND with intervals reads unambiguously.
  const left = rulePart && groups.length > 1 ? `(${rulePart})` : rulePart
  return [left, ...ivs].filter(Boolean).join(' AND ')
}
