// Unified customer interest signals (wa_030).
// One canonical taxonomy that every source maps into: sales-DB markers,
// WhatsApp chat tags, cold-call topics, and (future) billing-time tags.
// Stored phone-keyed in `wa_signals` so all four sources converge without
// touching the Type A / Type B customer split.

export type SignalSource = 'sales' | 'whatsapp' | 'call' | 'billing'

export const SIGNAL_SOURCE_LABEL: Record<SignalSource, string> = {
  sales: 'Sales', whatsapp: 'WhatsApp', call: 'Call', billing: 'Billing',
}

export type InterestGroup = 'engagement' | 'product' | 'metal'

export interface InterestDef { key: string; label: string; group: InterestGroup }

// Canonical interest vocabulary. `key` is the stable value stored in wa_signals.
export const INTERESTS: InterestDef[] = [
  // engagement
  { key: 'rate',        label: 'Daily Rate', group: 'engagement' },
  { key: 'designs',     label: 'Designs',    group: 'engagement' },
  { key: 'offers',      label: 'Offers',     group: 'engagement' },
  { key: 'scheme',      label: 'Scheme',     group: 'engagement' },
  { key: 'exchange',    label: 'Exchange',   group: 'engagement' },
  { key: 'cash',        label: 'Cash',       group: 'engagement' },
  { key: 'repair',      label: 'Repair',     group: 'engagement' },
  // product
  { key: 'necklace',    label: 'Necklace',    group: 'product' },
  { key: 'ring',        label: 'Ring',        group: 'product' },
  { key: 'bangles',     label: 'Bangles',     group: 'product' },
  { key: 'earrings',    label: 'Earrings',    group: 'product' },
  { key: 'chain',       label: 'Chain',       group: 'product' },
  { key: 'mangalsutra', label: 'Mangalsutra', group: 'product' },
  { key: 'pendant',     label: 'Pendant',     group: 'product' },
  { key: 'bracelet',    label: 'Bracelet',    group: 'product' },
  { key: 'anklet',      label: 'Anklet',      group: 'product' },
  { key: 'investment',  label: 'Coins/Bars',  group: 'product' },
  // metal
  { key: 'gold',        label: 'Gold',    group: 'metal' },
  { key: 'silver',      label: 'Silver',  group: 'metal' },
  { key: 'diamond',     label: 'Diamond', group: 'metal' },
]

export const INTEREST_KEYS = INTERESTS.map(i => i.key)
export const INTEREST_LABEL: Record<string, string> =
  Object.fromEntries(INTERESTS.map(i => [i.key, i.label]))
export const INTEREST_GROUP: Record<string, InterestGroup> =
  Object.fromEntries(INTERESTS.map(i => [i.key, i.group]))

// ── Source mappers ──────────────────────────────────────────────────────────

// Cold-call topics (lib/calls CALL_TOPICS) -> canonical interest.
export const CALL_TOPIC_TO_INTEREST: Record<string, string> = {
  rate: 'rate', designs: 'designs', offers: 'offers', booking: 'scheme',
}

// WhatsApp interest-topic NAME -> canonical interest, by keyword.
// Order matters: more specific engagement terms before generic metal names
// ("Gold Exchange" -> exchange, "Gold Savings Scheme" -> scheme).
const TOPIC_RULES: Array<[RegExp, string]> = [
  [/exchange/i, 'exchange'],
  [/cash|loan/i, 'cash'],
  [/scheme|saving|sip|booking|deposit/i, 'scheme'],
  [/repair|service/i, 'repair'],
  [/discount|sale|festive|offer/i, 'offers'],
  [/rate/i, 'rate'],
  [/design/i, 'designs'],
  [/necklace|haar|\bhar\b|rani/i, 'necklace'],
  [/mangalsutra|mangal/i, 'mangalsutra'],
  [/bangle|kada|kangan|churi|\bbala\b|valaya/i, 'bangles'],
  [/earring|jhumk|\bbali\b|stud|\btop/i, 'earrings'],
  [/pendant|locket/i, 'pendant'],
  [/bracelet/i, 'bracelet'],
  [/anklet|payal/i, 'anklet'],
  [/\bring\b|anguthi/i, 'ring'],
  [/chain/i, 'chain'],
  [/coin|\bbar\b|biscuit|kasu|ingot|guinea|sikka|invest/i, 'investment'],
  [/diamond/i, 'diamond'],
  [/silver/i, 'silver'],
  [/gold/i, 'gold'],
]

export function topicNameToInterest(name: string | null | undefined): string | null {
  const n = (name ?? '').trim()
  if (!n) return null
  for (const [re, key] of TOPIC_RULES) if (re.test(n)) return key
  return null
}

// Sales pipeline column -> canonical interest.
// Product flags in wa_b_markers.markers are `bought_<cat>`; metal flags `buys_<metal>`.
export const SALES_CATEGORY_TO_INTEREST: Record<string, string> = {
  necklace: 'necklace', bangles: 'bangles', mangalsutra: 'mangalsutra',
  earrings: 'earrings', ring: 'ring', chain: 'chain', investment: 'investment',
}
export const METALS = ['gold', 'silver', 'diamond'] as const
