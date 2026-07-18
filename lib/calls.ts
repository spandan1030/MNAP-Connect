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

// ── Call suppression rules (wa_044) ────────────────────────────────────────
// The single source of truth for who may be served a call card. Every deck —
// Call Control, audience activation, the live winback campaign — reads these,
// so changing a number here changes the rule everywhere.

// R1: a customer attempted today is not re-served for this many days.
// 2 = attempted Monday -> earliest Wednesday.
export const CALL_COOLDOWN_DAYS = 2

// R2: this many DISCONNECTED calls (success = false) retires them from calling.
// Pending logs (success = null: Call tapped, outcome not submitted) never count.
export const MAX_FAILED_CALL_ATTEMPTS = 4

// The cooldown boundary: a task is eligible when last_attempt_date < this date.
// Returns YYYY-MM-DD in local time, matching how last_attempt_date is stamped.
export function callCooldownCutoff(now: Date = new Date()): string {
  const d = new Date(now)
  d.setDate(d.getDate() - (CALL_COOLDOWN_DAYS - 1))
  return d.toLocaleDateString('en-CA')
}

// True when this customer has burned through the disconnect budget.
export function isCallUnreachable(failedCallAttempts: number | null | undefined): boolean {
  return (failedCallAttempts ?? 0) >= MAX_FAILED_CALL_ATTEMPTS
}
