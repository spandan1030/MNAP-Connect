'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/ui/Navbar'
import CustomerPeek from '@/components/ui/CustomerPeek'
import { createClient } from '@/lib/supabase/client'
import { CALL_TOPICS, RECENCY_TIERS, VALUE_TIERS } from '@/lib/calls'
import { INTERESTS } from '@/lib/signals'
import type { InterestTopic, MessageTemplate, ReachFilter, ReachRecipient, WaBCallCampaign } from '@/lib/types'

// Intent options for the cohort (dont_call is never a messaging target).
const REACH_INTENTS = [
  { value: 'will_come', label: 'Will come' },
  { value: 'not_sure', label: 'Not sure' },
  { value: 'wont_come', label: 'No come' },
]
const ENGAGEMENT_INTERESTS = INTERESTS.filter(i => i.group === 'engagement')
const OCCASION_INTERESTS = INTERESTS.filter(i => i.group === 'occasion')
const PRODUCT_INTERESTS = INTERESTS.filter(i => i.group === 'product')
const INTEREST_SOURCES = [['whatsapp', 'Chat'], ['call', 'Call'], ['walkin', 'Walk-in'], ['sales', 'Sales']] as const

function ago(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d <= 0) return 'today'
  if (d === 1) return '1d ago'
  if (d < 30) return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}
function until(iso: string): string {
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
  return d <= 1 ? '1d' : `${d}d`
}

export default function ReachPage() {
  const supabase = createClient()

  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [campaigns, setCampaigns] = useState<WaBCallCampaign[]>([])
  const [topics, setTopics] = useState<InterestTopic[]>([])
  const [isDynamic, setIsDynamic] = useState(false)   // campaign auto-updates from live data
  const [templateId, setTemplateId] = useState<string>('')
  const template = templates.find(t => t.id === templateId) ?? null

  const [mode, setMode] = useState<'build' | 'paste'>('build')
  const [filter, setFilter] = useState<ReachFilter>({})
  const [phonesText, setPhonesText] = useState('')

  const [recipients, setRecipients] = useState<ReachRecipient[]>([])
  const [total, setTotal] = useState(0)
  const [capped, setCapped] = useState(false)
  const [dailyCap, setDailyCap] = useState<number | ''>('')  // send at most N today (WhatsApp daily limit)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [resolving, setResolving] = useState(false)
  const [resolved, setResolved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [sending, setSending] = useState(false)
  const [created, setCreated] = useState<{ campaignId: string; members: number; sent: number } | null>(null)
  const [peekPhone, setPeekPhone] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    supabase.from('wa_message_templates').select('*').eq('is_active', true)
      .not('meta_template_name', 'is', null).order('created_at', { ascending: false })
      .then(({ data }) => setTemplates((data ?? []) as MessageTemplate[]))
    supabase.from('wa_b_call_campaigns').select('*').order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => setCampaigns((data ?? []) as WaBCallCampaign[]))
    // Subscribable topics (opt-in consent) — parents only, excluding system rows.
    supabase.from('wa_interest_topics').select('*').eq('is_active', true).is('parent_id', null)
      .order('sort_order')
      .then(({ data }) => setTopics(((data ?? []) as InterestTopic[]).filter(t => t.topic_group !== 'system')))
  }, [supabase])

  // ── filter helpers ──
  function toggleArr(key: keyof ReachFilter, val: string) {
    setFilter(f => {
      const cur = (f[key] as string[] | undefined) ?? []
      const next = cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val]
      return { ...f, [key]: next.length ? next : undefined }
    })
    setResolved(false)
  }
  function toggleBool(key: keyof ReachFilter) {
    setFilter(f => ({ ...f, [key]: f[key] ? undefined : true }))
    setResolved(false)
  }
  function setDate(key: keyof ReachFilter, val: string) {
    setFilter(f => ({ ...f, [key]: val || undefined }))
    setResolved(false)
  }
  const has = (key: keyof ReachFilter, val: string) => ((filter[key] as string[] | undefined) ?? []).includes(val)

  // Selection = first N eligible (not suppressed / opted out). N = daily cap, or
  // everyone eligible when the cap is blank. Re-run whenever the cap changes.
  function eligiblePhones(recs: ReachRecipient[]): string[] {
    return recs.filter(r => !r.suppressedUntil && !r.is_do_not_call && !r.dnd).map(r => r.phone)
  }
  function selectWithCap(recs: ReachRecipient[], capVal: number | '') {
    const elig = eligiblePhones(recs)
    const n = capVal === '' ? elig.length : Math.max(0, capVal)
    setSelected(new Set(elig.slice(0, n)))
  }
  function changeCap(v: string) {
    const n = v === '' ? '' : Math.max(1, parseInt(v) || 0)
    setDailyCap(n)
    if (resolved) selectWithCap(recipients, n)
  }

  async function findRecipients() {
    setError(null); setCreated(null)
    if (!templateId) { setError('Pick a template first — it decides the suppression window.'); return }
    const built: ReachFilter = mode === 'paste'
      ? { phones: phonesText.split(/[\s,;]+/).map(p => p.trim()).filter(Boolean) }
      : filter
    if (mode === 'paste' && !(built.phones?.length)) { setError('Paste at least one number.'); return }
    if (mode === 'build' && Object.keys(built).length === 0) { setError('Add at least one filter.'); return }

    setResolving(true); setResolved(false)
    try {
      const res = await fetch('/api/reach/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter: built, templateId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not resolve cohort'); setResolving(false); return }
      const recs: ReachRecipient[] = data.recipients ?? []
      setRecipients(recs)
      setTotal(data.total ?? recs.length)
      setCapped(!!data.capped)
      // Pre-select first N eligible (N = daily cap, or all eligible if blank).
      selectWithCap(recs, dailyCap)
      setResolved(true)
    } catch { setError('Network error — try again') }
    finally { setResolving(false) }
  }

  const eligibleCount = recipients.filter(r => !r.suppressedUntil && !r.is_do_not_call && !r.dnd).length
  const suppressedCount = recipients.filter(r => r.suppressedUntil).length
  const blockedCount = recipients.filter(r => r.is_do_not_call || r.dnd).length

  const cohortLabel = useMemo(() => {
    if (mode === 'paste') return 'Manual list'
    const parts: string[] = []
    if (filter.campaignIds?.length) parts.push(`${filter.campaignIds.length} campaign(s)`)
    if (filter.intents?.length) parts.push(filter.intents.join('/'))
    if (filter.callTopics?.length) parts.push(filter.callTopics.join('/'))
    if (filter.hotLead) parts.push('★ hot')
    if (filter.interests?.length) parts.push(filter.interests.join('/'))
    if (filter.recency_tier?.length) parts.push(filter.recency_tier.join('/'))
    if (filter.value_tier?.length) parts.push(filter.value_tier.join('/'))
    return parts.join(' · ') || 'Cohort'
  }, [mode, filter])

  function toggleSelect(phone: string) {
    setSelected(s => { const n = new Set(s); n.has(phone) ? n.delete(phone) : n.add(phone); return n })
  }

  // Create a campaign from this cohort (all eligible become members) and blast the
  // reviewed selection now. The rest are finished later from the Campaigns page.
  async function createCampaign() {
    if (!template) return
    const built: ReachFilter = mode === 'paste'
      ? { phones: phonesText.split(/[\s,;]+/).map(p => p.trim()).filter(Boolean) }
      : filter
    const defaultName = cohortLabel === 'Cohort' || cohortLabel === 'Manual list' ? `${template.name} — ${cohortLabel}` : cohortLabel
    const name = window.prompt('Name this campaign', defaultName)?.trim()
    if (!name) return
    setSending(true); setError(null); setCreated(null)
    try {
      const sendPhones = [...selected]
      const res = await fetch('/api/campaigns/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, filter: built, templateId, isDynamic: mode === 'build' && isDynamic, sendPhones }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not create campaign'); setSending(false); return }
      setCreated({ campaignId: data.campaignId, members: data.members ?? 0, sent: data.send?.sent ?? 0 })
    } catch { setError('Network error creating campaign') }
    finally { setSending(false) }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-4 pb-28">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Reach</h1>
          <p className="text-xs text-gray-500">Message any cohort — call, chat, marker, or a pasted list. Won&apos;t pay to send the same message twice.</p>
        </div>

        {/* 1. Template */}
        <div className="card p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-700">1 · Template</p>
          <select value={templateId} onChange={e => { setTemplateId(e.target.value); setResolved(false) }} className="input text-sm">
            <option value="">Choose a WhatsApp-approved template…</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.category ? ` · ${t.category}` : ''}</option>)}
          </select>
          {template && (
            <p className="text-[11px] text-gray-500">
              {template.suppression_days === 0
                ? 'No suppression (daily rate) — always sends.'
                : `Skips any number that already got this template in the last ${template.suppression_days} days.`}
            </p>
          )}
          {templates.length === 0 && <p className="text-[11px] text-amber-600">No approved templates yet. Add one in Templates (link a Meta template).</p>}
        </div>

        {/* 2. Cohort */}
        <div className="card p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-700">2 · Who</p>
            <div className="flex gap-1">
              {(['build', 'paste'] as const).map(m => (
                <button key={m} onClick={() => { setMode(m); setResolved(false) }}
                  className={`text-[11px] px-2.5 py-1 rounded-lg border font-medium ${mode === m ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}>
                  {m === 'build' ? 'Build cohort' : 'Paste numbers'}
                </button>
              ))}
            </div>
          </div>

          {mode === 'paste' ? (
            <textarea value={phonesText} onChange={e => { setPhonesText(e.target.value); setResolved(false) }} rows={4}
              className="input resize-none text-sm" placeholder="9876543210, 9123456780, …" />
          ) : (
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
          )}

          {/* Daily cap — send to only the first N eligible today (WhatsApp limits). */}
          <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
            <label className="text-[11px] font-medium text-gray-500 flex-1">
              Send at most (per batch)
              <input type="number" min={1} inputMode="numeric" placeholder="all eligible"
                value={dailyCap} onChange={e => changeCap(e.target.value)}
                className="input text-sm mt-0.5" />
            </label>
          </div>
          <p className="text-[10px] text-gray-400">
            Leave blank to message everyone eligible. Set e.g. 20 to send 20 now — the rest stay in the campaign to finish later (already-messaged numbers auto-skip).
          </p>

          {mode === 'build' && (
            <label className="flex items-start gap-2 text-[11px] text-gray-600">
              <input type="checkbox" className="mt-0.5" checked={isDynamic} onChange={e => setIsDynamic(e.target.checked)} />
              <span><b>Auto-update cohort</b> — new people who match these filters later are pulled into the campaign automatically. Off = fixed snapshot of who matches now.</span>
            </label>
          )}

          <button onClick={findRecipients} disabled={resolving} className="btn-primary w-full disabled:opacity-60">
            {resolving ? 'Finding…' : 'Find recipients'}
          </button>
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>

        {/* 3. Review + send */}
        {resolved && (
          <div className="card p-3 space-y-3">
            <p className="text-xs font-semibold text-gray-700">3 · Review — {total.toLocaleString('en-IN')} in cohort</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Will send" value={selected.size} accent="text-green-700" />
              <Stat label="Suppressed" value={suppressedCount} accent="text-amber-600" />
              <Stat label="Opted out" value={blockedCount} accent="text-gray-400" />
            </div>
            {dailyCap !== '' && eligibleCount > selected.size && (
              <p className="text-[10px] text-gray-500">Batch cap {dailyCap}: sending {selected.size} of {eligibleCount.toLocaleString('en-IN')} eligible now — the rest stay in the cohort for the next batch.</p>
            )}
            {capped && <p className="text-[10px] text-amber-600">Showing first {recipients.length} of {total.toLocaleString('en-IN')} — narrow the cohort to review all.</p>}

            {created && (
              <div className="text-xs bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-green-800 space-y-1">
                <p>Campaign created with {created.members.toLocaleString('en-IN')} members · sent to {created.sent} now.</p>
                <button onClick={() => router.push('/campaigns')} className="font-semibold text-green-700 underline">
                  Open campaign → finish sending the rest
                </button>
              </div>
            )}

            <div className="space-y-1.5 max-h-[46vh] overflow-y-auto">
              {recipients.map(r => {
                const blocked = !!r.suppressedUntil || r.is_do_not_call || r.dnd
                return (
                  <div key={r.phone} className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${blocked ? 'border-gray-100 bg-gray-50' : 'border-gray-200'}`}>
                    <input type="checkbox" className="mt-1" checked={selected.has(r.phone)} disabled={blocked}
                      onChange={() => toggleSelect(r.phone)} />
                    <div className="min-w-0 flex-1">
                      <button onClick={() => setPeekPhone(r.phone)} className="flex items-center gap-1.5 text-left">
                        <span className="text-xs font-medium text-gray-800 truncate underline decoration-dotted underline-offset-2">{r.name || 'Unknown'}</span>
                        {r.is_hot_lead && <span className="text-amber-400 text-xs" title="Hot lead">★</span>}
                        <span className="text-[11px] text-gray-400">+91 {r.phone}</span>
                      </button>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {r.recency_tier && <Tag>{r.recency_tier}</Tag>}
                        {r.value_tier && <Tag>{r.value_tier}</Tag>}
                        {r.primary_metal && <Tag>{r.primary_metal}</Tag>}
                        {r.lifetime_value != null && <Tag>₹{Math.round(r.lifetime_value).toLocaleString('en-IN')}</Tag>}
                      </div>
                      {r.pastSends.length > 0 && (
                        <p className="text-[10px] text-gray-500 mt-1 truncate">
                          Sent before: {r.pastSends.slice(0, 3).map(s => `${s.label} ✓ ${ago(s.sentAt)}`).join(' · ')}
                        </p>
                      )}
                      {r.suppressedUntil && <p className="text-[10px] text-amber-600 mt-0.5">⛔ got this template — skips for {until(r.suppressedUntil)}</p>}
                      {(r.is_do_not_call || r.dnd) && <p className="text-[10px] text-gray-400 mt-0.5">{r.is_do_not_call ? "Don't call" : 'Opted out (STOP)'}</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </main>

      {/* Send bar */}
      {resolved && template && !created && (
        <div className="fixed bottom-14 inset-x-0 z-30 px-4">
          <div className="max-w-lg mx-auto">
            <button onClick={createCampaign} disabled={sending}
              className="btn-primary w-full shadow-lg disabled:opacity-60">
              {sending ? 'Creating…' : selected.size > 0 ? `Create campaign & send ${selected.size}` : 'Create campaign (send later)'}
            </button>
          </div>
        </div>
      )}

      <CustomerPeek phone={peekPhone} onClose={() => setPeekPhone(null)} />
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
function Tag({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{children}</span>
}
function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-gray-50 rounded-lg py-2">
      <p className={`text-lg font-bold ${accent ?? 'text-gray-900'}`}>{value.toLocaleString('en-IN')}</p>
      <p className="text-[10px] text-gray-400">{label}</p>
    </div>
  )
}
