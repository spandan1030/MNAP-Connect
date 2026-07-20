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

// ── Call suppression rules (wa_044, revised wa_048) ────────────────────────
// The single source of truth for who may be served a call card. Every deck —
// Call Control, audience activation, the live winback campaign — reads these,
// so changing a number here changes the rule everywhere.
//
// R1 — HOW LONG TO WAIT depends on what happened on the last call:
//        didn't connect / outcome not saved  -> CALL_COOLDOWN_DAYS
//        connected, said "will come"         -> CALL_COOLDOWN_DAYS (hot, stays reachable)
//        connected, anything else            -> CONNECTED_COOLDOWN_DAYS
//      The date itself is computed by the database (wa_048) and stored on the
//      customer as `call_snooze_until`, so no query re-derives the branching.
//      These constants MUST match wa_b_call_snooze_days() in that migration.
//
// R2 — MAX_FAILED_CALL_ATTEMPTS disconnects retires them from calling for good.
//      Separate and harder than R1: R1 is "not yet", R2 is "never again".

// Short wait: we didn't get through, or we did and they're coming in.
export const CALL_COOLDOWN_DAYS = 4

// Long wait: we actually spoke and they did not commit to visiting.
// Calling again inside a month reads as pestering.
export const CONNECTED_COOLDOWN_DAYS = 30

// The intent that keeps a connected call on the SHORT wait.
export const HOT_INTENT = 'will_come'

// R2: this many DISCONNECTED calls (success = false) retires them from calling.
// Pending logs (success = null: Call tapped, outcome not submitted) never count.
export const MAX_FAILED_CALL_ATTEMPTS = 4

// How long to wait after a call with this outcome — the TypeScript twin of
// wa_b_call_snooze_days(). Kept so the app can explain a wait without a round trip.
export function callSnoozeDays(succeeded: boolean | null | undefined, intent?: string | null): number {
  return succeeded === true && intent !== HOT_INTENT ? CONNECTED_COOLDOWN_DAYS : CALL_COOLDOWN_DAYS
}

// Today, as the deck stamps dates (local YYYY-MM-DD).
export function today(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA')
}

// The legacy task-level boundary: a task is eligible when last_attempt_date < this.
// Kept as a safety net alongside call_snooze_until; the two agree by construction.
export function callCooldownCutoff(now: Date = new Date()): string {
  const d = new Date(now)
  d.setDate(d.getDate() - (CALL_COOLDOWN_DAYS - 1))
  return d.toLocaleDateString('en-CA')
}

// True while a customer is still inside their post-call wait.
export function isCallSnoozed(snoozeUntil: string | null | undefined, now: Date = new Date()): boolean {
  return !!snoozeUntil && snoozeUntil > today(now)
}

// True when this customer has burned through the disconnect budget.
export function isCallUnreachable(failedCallAttempts: number | null | undefined): boolean {
  return (failedCallAttempts ?? 0) >= MAX_FAILED_CALL_ATTEMPTS
}
