import type { ReachFilter } from '@/lib/types'
import type { Rule, RuleTree } from './rules'
import type { Interval } from './intervals'

// ═══════════════════════════════════════════════════════════════════════════
//  CHIPS → RULE TREE.
//
//  The chips UI and the rule builder are two faces of ONE engine. The chips
//  produce a ReachFilter; this turns that into the rule tree the resolver
//  actually runs, so "who is in this cohort" has a single definition regardless
//  of which screen built it.
//
//  Chip semantics are "everything AND'd" — all selected chips must hold — so the
//  whole thing is ONE group (no OR). Date-range chips become INTERVALS, because
//  they ask whether an event happened in a window, which a person-row rule
//  cannot answer.
//
//  This mirrors resolveCohortPhones() decision-for-decision. It is proven to
//  return the identical cohort by scripts/chips-check.mjs against the live DB;
//  if you change one side, change the other and re-run that check.
//
//  KNOWN GAP: `subscribedTopics`. The chips store topic UUIDs while the feature
//  view stores canonical keys (several topics share a key), so a faithful
//  mapping needs a lookup and would risk widening the cohort. No preset uses it;
//  `chipsConvertible()` reports false when it is present so the caller keeps the
//  legacy path. The "subscription" concept is being retired anyway — a daily-
//  rate pool is "rate interest, from chat", which converts cleanly.
// ═══════════════════════════════════════════════════════════════════════════

// The date-window questions that must go to the event logs, matching the
// resolver's callNeedsEventQuery / signalNeedsEventQuery.
function callNeedsEventQuery(f: ReachFilter): boolean {
  return !!(f.calledFrom || f.calledTo || (f.intents?.length && f.callTopics?.length))
}
function signalNeedsEventQuery(f: ReachFilter): boolean {
  return !!(f.interestFrom || f.interestTo)
}

/** Manual paste and subscribedTopics have no faithful tree form. */
export function chipsConvertible(f: ReachFilter): boolean {
  if (f.phones?.length) return false          // paste mode is its own thing
  if (f.subscribedTopics?.length) return false // UUID-vs-key, see header
  return true
}

export function chipsToTree(f: ReachFilter): RuleTree {
  const rules: Rule[] = []
  const intervals: Interval[] = []

  // ── Sales (all person-row rules) ──
  if (f.recency_tier?.length)   rules.push({ field: 'sales_recency_tier', op: 'any_of', values: f.recency_tier })
  if (f.value_tier?.length)     rules.push({ field: 'sales_value_tier', op: 'any_of', values: f.value_tier })
  if (f.rfm_segment?.length)    rules.push({ field: 'sales_rfm_segment', op: 'any_of', values: f.rfm_segment })
  if (f.frequency_tier?.length) rules.push({ field: 'sales_frequency_tier', op: 'any_of', values: f.frequency_tier })
  if (f.primary_metal?.length)  rules.push({ field: 'sales_primary_metal', op: 'any_of', values: f.primary_metal })
  if (f.is_high_value)     rules.push({ field: 'sales_is_high_value', op: 'is_true' })
  if (f.is_likely_wedding) rules.push({ field: 'sales_is_likely_wedding', op: 'is_true' })
  if (f.is_lookalike_seed) rules.push({ field: 'sales_is_lookalike_seed', op: 'is_true' })
  if (f.min_lifetime_value != null) rules.push({ field: 'sales_lifetime_value', op: 'gte', min: f.min_lifetime_value })
  if (f.min_total_bills != null)    rules.push({ field: 'sales_total_bills', op: 'gte', min: f.min_total_bills })
  if (f.max_days_since_last_purchase != null)
    rules.push({ field: 'sales_days_since_purchase', op: 'lte', max: f.max_days_since_last_purchase })
  if (f.purchaseFrom && f.purchaseTo) rules.push({ field: 'sales_last_purchase_date', op: 'between', from: f.purchaseFrom, to: f.purchaseTo })
  else if (f.purchaseFrom)            rules.push({ field: 'sales_last_purchase_date', op: 'after', from: f.purchaseFrom })
  else if (f.purchaseTo)              rules.push({ field: 'sales_last_purchase_date', op: 'before', to: f.purchaseTo })

  // ── Call ──
  if (f.campaignIds?.length) rules.push({ field: 'call_campaign_ids', op: 'any_of', values: f.campaignIds })
  if (f.hotLead)             rules.push({ field: 'call_is_hot', op: 'is_true' })
  if (f.callUnresponsive) {
    rules.push({ field: 'call_attempts', op: 'gte', min: 3 })
    rules.push({ field: 'call_connected', op: 'lte', max: 0 })
  }
  if (callNeedsEventQuery(f)) {
    intervals.push({
      dataset: 'calls',
      ...(f.calledFrom ? { from: f.calledFrom } : {}),
      ...(f.calledTo ? { to: f.calledTo } : {}),
      ...(f.intents?.length ? { intents: f.intents } : {}),
      ...(f.callTopics?.length ? { topics: f.callTopics } : {}),
      // no date but both intent+topic → still an event query, whole-history window
      ...(!f.calledFrom && !f.calledTo ? { from: '2000-01-01' } : {}),
    })
  } else {
    if (f.intents?.length)    rules.push({ field: 'call_intents', op: 'any_of', values: f.intents })
    if (f.callTopics?.length) rules.push({ field: 'call_topics', op: 'any_of', values: f.callTopics })
  }

  // ── Walk-in ──
  if (f.walkedIn)             rules.push({ field: 'walkin_last_at', op: 'exists' })
  if (f.walkinNoPurchase)     rules.push({ field: 'walkin_no_purchase', op: 'is_true' })
  if (f.walkinTiming?.length) rules.push({ field: 'walkin_timing', op: 'any_of', values: f.walkinTiming })

  // ── Behaviour ──
  if (f.multiSource)  rules.push({ field: 'signal_source_count', op: 'gte', min: 2 })
  if (f.chatNonBuyer) {
    rules.push({ field: 'signal_sources', op: 'any_of', values: ['whatsapp'] })
    rules.push({ field: 'is_buyer', op: 'is_true', not: true })
  }
  if (f.adLead)             rules.push({ field: 'ad_is_lead', op: 'is_true' })
  if (f.adCampaign?.length) rules.push({ field: 'ad_campaigns', op: 'any_of', values: f.adCampaign })

  // ── Customer app ──
  if (f.appUser)            rules.push({ field: 'app_is_user', op: 'is_true' })
  if (f.hasScheme)          rules.push({ field: 'app_has_scheme', op: 'is_true' })
  if (f.appProductInterest) rules.push({ field: 'app_product_interest', op: 'is_true' })

  // ── Chat activity ──
  if (f.messagedFrom || f.messagedTo) {
    intervals.push({
      dataset: 'messages',
      ...(f.messagedFrom ? { from: f.messagedFrom } : {}),
      ...(f.messagedTo ? { to: f.messagedTo } : {}),
    })
  }

  // ── Interests + source facet ──
  if (signalNeedsEventQuery(f)) {
    intervals.push({
      dataset: 'signals',
      ...(f.interestFrom ? { from: f.interestFrom } : {}),
      ...(f.interestTo ? { to: f.interestTo } : {}),
      ...(f.interests?.length ? { interests: f.interests } : {}),
      ...(f.interestSources?.length ? { sources: f.interestSources } : {}),
    })
  } else if (f.interests?.length) {
    rules.push({
      field: 'interest', op: 'any_of', values: f.interests,
      ...(f.interestSources?.length ? { sources: f.interestSources } : {}),
    })
  } else if (f.interestSources?.length) {
    // sources chosen with no interest → "an interest came from these channels"
    rules.push({ field: 'signal_sources', op: 'any_of', values: f.interestSources })
  }

  return { groups: [{ rules }], intervals }
}
