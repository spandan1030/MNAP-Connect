'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/ui/Navbar'
import CustomerPeek from '@/components/ui/CustomerPeek'
import { createClient } from '@/lib/supabase/client'
import FilterBuilder from '@/components/reach/FilterBuilder'
import type { InterestTopic, MessageTemplate, ReachFilter, ReachRecipient, WaBCallCampaign } from '@/lib/types'

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
  const [created, setCreated] = useState<{ campaignId: string; audienceId: string | null; members: number; sent: number } | null>(null)
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

  // Selection = first N eligible (not suppressed / opted out). N = daily cap, or
  // everyone eligible when the cap is blank. Re-run whenever the cap changes.
  function eligiblePhones(recs: ReachRecipient[]): string[] {
    return recs.filter(r => !r.suppressedUntil && !r.optedOut).map(r => r.phone)
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

  const eligibleCount = recipients.filter(r => !r.suppressedUntil && !r.optedOut).length
  const suppressedCount = recipients.filter(r => r.suppressedUntil).length
  const blockedCount = recipients.filter(r => r.optedOut).length

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
      setCreated({ campaignId: data.campaignId, audienceId: data.audienceId ?? null, members: data.members ?? 0, sent: data.send?.sent ?? 0 })
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
            <FilterBuilder filter={filter} campaigns={campaigns} topics={topics}
              onChange={f => { setFilter(f); setResolved(false) }} />
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
                <div className="flex flex-col gap-1">
                  <button onClick={() => router.push('/campaigns')} className="font-semibold text-green-700 underline text-left">
                    Open campaign → finish sending the rest
                  </button>
                  {created.audienceId && (
                    <button onClick={() => router.push('/audiences')} className="font-semibold text-green-700 underline text-left">
                      Continue as a funnel → carry who read/replied, then send again
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-1.5 max-h-[46vh] overflow-y-auto">
              {recipients.map(r => {
                const blocked = !!r.suppressedUntil || r.optedOut
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
                      {r.optedOut && <p className="text-[10px] text-gray-400 mt-0.5">Opted out</p>}
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
