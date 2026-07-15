// Shared constants for the cold-call module (wa_028).
// Kept in one place so the calling screen, admin control, and reporting agree.

export const CALL_TOPICS = [
  { value: 'rate',    label: 'Rate' },
  { value: 'designs', label: 'Designs' },
  { value: 'offers',  label: 'Offers' },
  { value: 'booking', label: 'Booking' },
] as const

export type CallTopic = typeof CALL_TOPICS[number]['value']

// Intent buttons (single-select). color = Tailwind classes for the chip.
export const CALL_INTENTS = [
  { value: 'will_come', label: 'Will come', color: 'bg-green-600 text-white border-green-600',   idle: 'bg-white text-green-700 border-green-300' },
  { value: 'not_sure',  label: 'Not sure',  color: 'bg-yellow-500 text-white border-yellow-500', idle: 'bg-white text-yellow-700 border-yellow-300' },
  { value: 'wont_come', label: 'No Come',    color: 'bg-orange-500 text-white border-orange-500', idle: 'bg-white text-orange-700 border-orange-300' },
  { value: 'dont_call', label: "Don't call",color: 'bg-red-600 text-white border-red-600',       idle: 'bg-white text-red-700 border-red-300 font-bold' },
] as const

export type CallIntentValue = typeof CALL_INTENTS[number]['value']

export const TOPIC_LABEL: Record<string, string> = Object.fromEntries(
  CALL_TOPICS.map(t => [t.value, t.label])
)
export const INTENT_LABEL: Record<string, string> = Object.fromEntries(
  CALL_INTENTS.map(i => [i.value, i.label])
)

// Filter option lists for the admin campaign builder (match the Python markers).
export const RECENCY_TIERS   = ['Recent', 'Active', 'Lapsed'] as const
export const VALUE_TIERS     = ['VIP', 'High', 'Mid', 'Regular'] as const
export const RFM_SEGMENTS    = ['Champion', 'Loyal', 'Promising', 'At-Risk', 'Dormant', 'Lost', 'One-Time-Big'] as const
export const FREQUENCY_TIERS = ['Frequent', 'Repeat', 'Occasional', 'One-time'] as const
export const PRIMARY_METALS  = ['gold', 'silver', 'diamond'] as const

// Chip colours for the marker badges on a call card.
export const RECENCY_COLORS: Record<string, string> = {
  Recent: 'bg-green-50 text-green-700 border-green-200',
  Active: 'bg-blue-50 text-blue-700 border-blue-200',
  Lapsed: 'bg-orange-50 text-orange-700 border-orange-200',
}
export const VALUE_COLORS: Record<string, string> = {
  VIP:     'bg-amber-50 text-amber-800 border-amber-200',
  High:    'bg-purple-50 text-purple-700 border-purple-200',
  Mid:     'bg-teal-50 text-teal-700 border-teal-200',
  Regular: 'bg-gray-50 text-gray-600 border-gray-200',
}

// Build a tel: URL from a stored 10-digit phone.
export function telUrl(phone: string) {
  const d = phone.replace(/\D/g, '')
  const ten = d.length > 10 && d.startsWith('91') ? d.slice(-10) : d
  return `tel:+91${ten}`
}
