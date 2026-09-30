// Chat colour-coding palette (wa_072). A salesman long-presses a chat in the
// Messages list to tag it with one of these triage colours. NULL = untagged.
//
// Keys are persisted in wa_threads.color and gated by a CHECK constraint, so this
// list and the migration's CHECK must stay in lockstep.

export type ThreadColor = 'hot' | 'unreachable' | 'followup' | 'vip' | 'negotiating' | 'cold'

export interface ThreadColorMeta {
  key:   ThreadColor
  label: string          // short chip label
  desc:  string          // what it means (shown in the picker)
  emoji: string
  dot:   string          // Tailwind bg-* for the avatar dot / swatch
  bar:   string          // Tailwind bg-* for the row's left accent bar
  tint:  string          // Tailwind bg-* faint row tint
  ring:  string          // Tailwind ring-* for the selected swatch in the picker
}

// Order here is the order shown in the long-press picker.
export const THREAD_COLORS: ThreadColorMeta[] = [
  { key: 'hot',         label: 'Hot lead',    desc: 'Coming in soon / ready to buy', emoji: '🔴', dot: 'bg-red-500',    bar: 'bg-red-500',    tint: 'bg-red-50',    ring: 'ring-red-500' },
  { key: 'negotiating', label: 'Negotiating', desc: 'Quote given — awaiting decision', emoji: '🟠', dot: 'bg-orange-500', bar: 'bg-orange-500', tint: 'bg-orange-50', ring: 'ring-orange-500' },
  { key: 'unreachable', label: 'Can’t reach', desc: 'Interested, but not reachable',  emoji: '🟡', dot: 'bg-amber-400',  bar: 'bg-amber-400',  tint: 'bg-amber-50',  ring: 'ring-amber-400' },
  { key: 'followup',    label: 'Follow-up',   desc: 'Nurturing — follow-up in progress', emoji: '🔵', dot: 'bg-blue-500',  bar: 'bg-blue-500',   tint: 'bg-blue-50',   ring: 'ring-blue-500' },
  { key: 'vip',         label: 'VIP',         desc: 'High-value — handle personally', emoji: '🟣', dot: 'bg-purple-500', bar: 'bg-purple-500', tint: 'bg-purple-50', ring: 'ring-purple-500' },
  { key: 'cold',        label: 'Cold',        desc: 'Uninterested / ignore',          emoji: '⚪', dot: 'bg-gray-400',   bar: 'bg-gray-400',   tint: 'bg-gray-50',   ring: 'ring-gray-400' },
]

const BY_KEY: Record<string, ThreadColorMeta> =
  Object.fromEntries(THREAD_COLORS.map(c => [c.key, c]))

export function threadColorMeta(key: string | null | undefined): ThreadColorMeta | null {
  if (!key) return null
  return BY_KEY[key] ?? null
}
