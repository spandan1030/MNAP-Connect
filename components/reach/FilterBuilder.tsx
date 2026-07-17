'use client'

import { CALL_TOPICS, RECENCY_TIERS, VALUE_TIERS } from '@/lib/calls'
import { INTERESTS } from '@/lib/signals'
import type { InterestTopic, ReachFilter, WaBCallCampaign } from '@/lib/types'

// Shared cohort filter builder — the feature bands (Call / WhatsApp chat /
// Subscribed / Walk-in / Sales history / Signal source & date). Used by Reach
// (one-off sends) AND the Audience Library (saved audiences), so "how you pick a
// cohort" is defined in exactly one place. Controlled: pass `filter` + `onChange`.

const REACH_INTENTS = [
  { value: 'will_come', label: 'Will come' },
  { value: 'not_sure', label: 'Not sure' },
  { value: 'wont_come', label: 'No come' },
]
const ENGAGEMENT_INTERESTS = INTERESTS.filter(i => i.group === 'engagement')
const OCCASION_INTERESTS = INTERESTS.filter(i => i.group === 'occasion')
const PRODUCT_INTERESTS = INTERESTS.filter(i => i.group === 'product')
const INTEREST_SOURCES = [['whatsapp', 'Chat'], ['call', 'Call'], ['walkin', 'Walk-in'], ['sales', 'Sales']] as const
const WALKIN_TIMING = [['within_7d', 'Within 7 days'], ['within_1m', 'Within 1 month'], ['1_3m', '1–3 months']] as const

export default function FilterBuilder({ filter, onChange, campaigns, topics }: {
  filter: ReachFilter
  onChange: (f: ReachFilter) => void
  campaigns: WaBCallCampaign[]
  topics: InterestTopic[]
}) {
  function toggleArr(key: keyof ReachFilter, val: string) {
    const cur = (filter[key] as string[] | undefined) ?? []
    const next = cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val]
    onChange({ ...filter, [key]: next.length ? next : undefined })
  }
  function toggleBool(key: keyof ReachFilter) {
    onChange({ ...filter, [key]: filter[key] ? undefined : true })
  }
  function setDate(key: keyof ReachFilter, val: string) {
    onChange({ ...filter, [key]: val || undefined })
  }
  const has = (key: keyof ReachFilter, val: string) => ((filter[key] as string[] | undefined) ?? []).includes(val)

  return (
    <div className="space-y-3">
      {/* ── CALL ──────────────────────────────────────────── */}
      <FilterSection title="Call" hint="From the cold-call / campaign module">
        <FilterGroup label="Campaigns">
          {campaigns.length === 0 && <span className="text-[11px] text-gray-400">No campaigns yet.</span>}
          {campaigns.map(c => (
            <Chip key={c.id} on={has('campaignIds', c.id)} onClick={() => toggleArr('campaignIds', c.id)}>
              {c.name}{c.is_active ? ' ·live' : ''}
            </Chip>
          ))}
        </FilterGroup>
        <FilterGroup label="Outcome">
          {REACH_INTENTS.map(i => (
            <Chip key={i.value} on={has('intents', i.value)} onClick={() => toggleArr('intents', i.value)}>{i.label}</Chip>
          ))}
          <Chip on={!!filter.hotLead} onClick={() => toggleBool('hotLead')}>★ Hot</Chip>
        </FilterGroup>
        <FilterGroup label="Call topics">
          {CALL_TOPICS.map(t => (
            <Chip key={t.value} on={has('callTopics', t.value)} onClick={() => toggleArr('callTopics', t.value)}>{t.label}</Chip>
          ))}
        </FilterGroup>
        <DateRange label="Called between" from={filter.calledFrom} to={filter.calledTo}
          onFrom={v => setDate('calledFrom', v)} onTo={v => setDate('calledTo', v)} />
      </FilterSection>

      {/* ── WHATSAPP CHAT ─────────────────────────────────── */}
      <FilterSection title="WhatsApp chat" hint="Interests tagged in chat + inbound activity">
        <FilterGroup label="Interested in">
          {ENGAGEMENT_INTERESTS.map(i => (
            <Chip key={i.key} on={has('interests', i.key)} onClick={() => toggleArr('interests', i.key)}>{i.label}</Chip>
          ))}
        </FilterGroup>
        <DateRange label="Messaged us between" from={filter.messagedFrom} to={filter.messagedTo}
          onFrom={v => setDate('messagedFrom', v)} onTo={v => setDate('messagedTo', v)} />
      </FilterSection>

      {/* ── SUBSCRIBED ────────────────────────────────────── */}
      {topics.length > 0 && (
        <FilterSection title="Subscribed to" hint="Explicit opt-in (chose to receive this topic)">
          <FilterGroup label="Topics">
            {topics.map(t => (
              <Chip key={t.id} on={has('subscribedTopics', t.id)} onClick={() => toggleArr('subscribedTopics', t.id)}>{t.name}</Chip>
            ))}
          </FilterGroup>
        </FilterSection>
      )}

      {/* ── WALK-IN ───────────────────────────────────────── */}
      <FilterSection title="Walk-in" hint="Signals captured in-store">
        <FilterGroup label="Visit">
          <Chip on={!!filter.walkedIn} onClick={() => toggleBool('walkedIn')}>Walked in</Chip>
          <Chip on={!!filter.walkinNoPurchase} onClick={() => toggleBool('walkinNoPurchase')}>No purchase since</Chip>
        </FilterGroup>
        <FilterGroup label="Planning to buy">
          {WALKIN_TIMING.map(([v, label]) => (
            <Chip key={v} on={has('walkinTiming', v)} onClick={() => toggleArr('walkinTiming', v)}>{label}</Chip>
          ))}
        </FilterGroup>
        <FilterGroup label="Occasion">
          {OCCASION_INTERESTS.map(i => (
            <Chip key={i.key} on={has('interests', i.key)} onClick={() => toggleArr('interests', i.key)}>{i.label}</Chip>
          ))}
        </FilterGroup>
        <FilterGroup label="Product">
          {PRODUCT_INTERESTS.map(i => (
            <Chip key={i.key} on={has('interests', i.key)} onClick={() => toggleArr('interests', i.key)}>{i.label}</Chip>
          ))}
        </FilterGroup>
      </FilterSection>

      {/* ── BEHAVIOUR (cross-source, computed) ────────────── */}
      <FilterSection title="Behaviour" hint="Cross-source / calling signals">
        <FilterGroup label="Signals">
          <Chip on={!!filter.multiSource} onClick={() => toggleBool('multiSource')}>Multi-source intent</Chip>
          <Chip on={!!filter.chatNonBuyer} onClick={() => toggleBool('chatNonBuyer')}>Chat non-buyer</Chip>
          <Chip on={!!filter.callUnresponsive} onClick={() => toggleBool('callUnresponsive')}>Call-unresponsive</Chip>
          <Chip on={!!filter.adLead} onClick={() => toggleBool('adLead')}>Ad lead</Chip>
        </FilterGroup>
      </FilterSection>

      {/* ── SALES HISTORY ─────────────────────────────────── */}
      <FilterSection title="Sales history" hint="From real purchase markers">
        <FilterGroup label="Recency">
          {RECENCY_TIERS.map(r => <Chip key={r} on={has('recency_tier', r)} onClick={() => toggleArr('recency_tier', r)}>{r}</Chip>)}
        </FilterGroup>
        <FilterGroup label="Value">
          {VALUE_TIERS.map(v => <Chip key={v} on={has('value_tier', v)} onClick={() => toggleArr('value_tier', v)}>{v}</Chip>)}
          <Chip on={!!filter.is_high_value} onClick={() => toggleBool('is_high_value')}>High value</Chip>
          <Chip on={!!filter.is_likely_wedding} onClick={() => toggleBool('is_likely_wedding')}>Wedding</Chip>
        </FilterGroup>
        <DateRange label="Last purchase between" from={filter.purchaseFrom} to={filter.purchaseTo}
          onFrom={v => setDate('purchaseFrom', v)} onTo={v => setDate('purchaseTo', v)} />
      </FilterSection>

      {/* ── SIGNAL SOURCE & WHEN ──────────────────────────── */}
      <FilterSection title="Signal source & date" hint="Narrows the Interested-in / Occasion / Product signals above">
        <FilterGroup label="From which source">
          {INTEREST_SOURCES.map(([v, label]) => (
            <Chip key={v} on={has('interestSources', v)} onClick={() => toggleArr('interestSources', v)}>{label}</Chip>
          ))}
          {!filter.interestSources?.length && <span className="text-[10px] text-gray-400 self-center">any source</span>}
        </FilterGroup>
        <DateRange label="Signal captured between" from={filter.interestFrom} to={filter.interestTo}
          onFrom={v => setDate('interestFrom', v)} onTo={v => setDate('interestTo', v)} />
        <p className="text-[10px] text-gray-400">e.g. Walk-in + this week = &quot;walked in this week&quot;; Chat + Daily Rate + last month = &quot;chatted about rate last month&quot;.</p>
      </FilterSection>

      <p className="text-[10px] text-gray-400">Multiple picks in one group = OR. Across sections = AND (must match all).</p>
    </div>
  )
}

// A labelled band grouping related filter families (Call / Chat / Sales / …).
function FilterSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-2.5 space-y-2.5">
      <div>
        <p className="text-xs font-bold text-gray-700">{title}</p>
        {hint && <p className="text-[10px] text-gray-400 leading-tight">{hint}</p>}
      </div>
      {children}
    </div>
  )
}
function DateRange({ label, from, to, onFrom, onTo }: {
  label: string; from?: string; to?: string; onFrom: (v: string) => void; onTo: (v: string) => void
}) {
  return (
    <div>
      <p className="text-[11px] font-medium text-gray-400 mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <input type="date" className="input text-sm" value={from ?? ''} onChange={e => onFrom(e.target.value)} />
        <span className="text-[11px] text-gray-400">→</span>
        <input type="date" className="input text-sm" value={to ?? ''} onChange={e => onTo(e.target.value)} />
      </div>
    </div>
  )
}
function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-gray-400 mb-1">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}
function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-[11px] border font-medium ${on ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200'}`}>
      {children}
    </button>
  )
}
