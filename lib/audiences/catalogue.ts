import type { ReachFilter } from '@/lib/types'

// The pre-made audience catalogue (LEADGEN_PHASE1_PLAN.md §5). Seeded as data via
// POST /api/audiences/seed — each becomes a `wa_audiences` row (is_seeded=true),
// so the library ships ready. `channel` is guidance (activation lets you pick any).
// All dynamic (re-resolve on refresh) unless noted.

export interface PresetAudience {
  key: string          // stable identity used to avoid duplicate seeding
  name: string
  description: string
  channel: string      // suggested activation
  filter: ReachFilter
  dynamic?: boolean
}

export const AUDIENCE_CATALOGUE: PresetAudience[] = [
  // ── Reactivation ──
  { key: 'A1', name: 'Lapsed high-value winback', channel: '📞 call',
    description: 'Old VIP/High buyers gone quiet (3yr+). Personal call.',
    filter: { recency_tier: ['Lapsed'], value_tier: ['VIP', 'High'] }, dynamic: true },
  { key: 'A2', name: 'Will-come follow-up', channel: '💬 chat (+ad)',
    description: 'Said on a call they will visit — nudge, do not re-call.',
    filter: { intents: ['will_come'] }, dynamic: true },
  { key: 'A3', name: 'Newly-lapsed rescue', channel: '💬 chat',
    description: 'Crossed into lapsed — cheap chat re-engage. (Approximate until the newly_lapsed change flag lands.)',
    filter: { recency_tier: ['Lapsed'] }, dynamic: true },
  { key: 'A4', name: 'At-risk', channel: '📞/💬',
    description: 'Were good, going quiet (RFM At-Risk). Priority win-back.',
    filter: { rfm_segment: ['At-Risk'] }, dynamic: true },
  { key: 'A5', name: 'Unresponsive reactivation', channel: '📣 ad / 💬',
    description: 'Never answer the phone (3+ tries) — stop calling, switch channel.',
    filter: { callUnresponsive: true }, dynamic: true },

  // ── Hot / intent ──
  { key: 'B1', name: 'Walk-in, no purchase', channel: '📞 then 💬',
    description: 'Visited the store, has not bought since — the hottest follow-up.',
    filter: { walkinNoPurchase: true }, dynamic: true },
  { key: 'B2', name: 'Hot-starred leads', channel: '💬 chat',
    description: 'Staff ★-starred as strong leads.',
    filter: { hotLead: true }, dynamic: true },
  { key: 'B3', name: 'Multi-source intent', channel: '📞 call',
    description: 'Showing interest on 2+ channels (chat/call/walk-in). Priority.',
    filter: { multiSource: true }, dynamic: true },
  { key: 'B4', name: 'Buying-soon walk-in', channel: '📞 + 💬',
    description: 'Walk-ins who said they will buy within a month.',
    filter: { walkinTiming: ['within_7d', 'within_1m'] }, dynamic: true },

  // ── Interest / occasion ──
  { key: 'C1', name: 'Daily-rate subscribers', channel: '💬 chat',
    description: 'Rate interest from chat (true daily-update intent).',
    filter: { interests: ['rate'], interestSources: ['whatsapp'] }, dynamic: true },
  { key: 'C2', name: 'Wedding / bridal', channel: '📣 ad + 💬',
    description: 'Wedding signals from any source (chat/call/walk-in).',
    filter: { interests: ['wedding'] }, dynamic: true },
  { key: 'C3', name: 'Festival pre-target', channel: '📣 ad + 💬',
    description: 'Festival intent — fire 2–3 weeks before the festival.',
    filter: { interests: ['festival'] }, dynamic: true },
  { key: 'C4', name: 'Design / offer retargeting', channel: '📣 ad',
    description: 'Interested in designs or offers.',
    filter: { interests: ['designs', 'offers'] }, dynamic: true },
  { key: 'C5', name: 'Scheme / investment', channel: '💬 / 📞',
    description: 'Scheme or coin/bar investment interest.',
    filter: { interests: ['scheme', 'investment'] }, dynamic: true },

  // ── Acquisition seeds (ads) ──
  { key: 'D1', name: 'High-value lookalike seed', channel: '📣 ad',
    description: 'Best spenders — seed to find similar new people.',
    filter: { is_high_value: true }, dynamic: true },
  { key: 'D2', name: 'Bridal lookalike seed', channel: '📣 ad',
    description: 'Likely-wedding buyers — bridal lookalike seed.',
    filter: { is_likely_wedding: true }, dynamic: true },
  { key: 'D3', name: 'Hot-intent lookalike seed', channel: '📣 ad',
    description: 'Multi-source high-intent people — strong lookalike seed.',
    filter: { multiSource: true }, dynamic: true },

  // ── Nurture ──
  { key: 'E1', name: 'Champions / Loyal', channel: '💬 chat',
    description: 'Best repeat buyers — loyalty + referral.',
    filter: { rfm_segment: ['Champion', 'Loyal'] }, dynamic: true },
  { key: 'E2', name: 'Promising', channel: '💬 chat',
    description: 'Recent, not yet frequent — drive the 2nd/3rd purchase.',
    filter: { rfm_segment: ['Promising'] }, dynamic: true },
  { key: 'E3', name: 'Chat non-buyers', channel: '💬 chat',
    description: 'Chatting + interested, no purchase on this number — convert to footfall.',
    filter: { chatNonBuyer: true }, dynamic: true },

  // ── Customer app ──
  { key: 'APP1', name: 'App — product interest', channel: '💬 then 📞',
    description: 'Tapped “interested” / shared a product link from the app. Hottest online intent.',
    filter: { appProductInterest: true }, dynamic: true },
  { key: 'APP2', name: 'App users', channel: '💬 chat',
    description: 'Registered on the customer app (from the app-admin export).',
    filter: { appUser: true }, dynamic: true },
  { key: 'APP3', name: 'Scheme holders', channel: '💬 / 📞',
    description: 'Hold an active gold-savings scheme in the app.',
    filter: { hasScheme: true }, dynamic: true },

  // ── Ad-lead loop (inert until ads are wired) ──
  { key: 'AD1', name: 'Ad-lead follow-up', channel: '💬 then 📞',
    description: 'People who messaged us from an ad. Empty until ads are running.',
    filter: { adLead: true }, dynamic: true },
]
