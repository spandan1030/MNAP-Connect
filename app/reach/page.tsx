'use client'

import { useEffect, useMemo, useState } from 'react'
import Navbar from '@/components/ui/Navbar'
import CustomerPeek from '@/components/ui/CustomerPeek'
import { createClient } from '@/lib/supabase/client'
import { CALL_TOPICS, RECENCY_TIERS, VALUE_TIERS } from '@/lib/calls'
import { INTERESTS } from '@/lib/signals'
import type { MessageTemplate, ReachFilter, ReachRecipient, WaBCallCampaign } from '@/lib/types'

// Intent options for the cohort (dont_call is never a messaging target).
const REACH_INTENTS = [
  { value: 'will_come', label: 'Will come' },
  { value: 'not_sure', label: 'Not sure' },
  { value: 'wont_come', label: 'No come' },
]
const ENGAGEMENT_INTERESTS = INTERESTS.filter(i => i.group === 'engagement')

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
  const [templateId, setTemplateId] = useState<string>('')
  const template = templates.find(t => t.id === templateId) ?? null

  const [mode, setMode] = useState<'build' | 'paste'>('build')
  const [filter, setFilter] = useState<ReachFilter>({})
  const [phonesText, setPhonesText] = useState('')

  const [recipients, setRecipients] = useState<ReachRecipient[]>([])
  const [total, setTotal] = useState(0)
  const [capped, setCapped] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [resolving, setResolving] = useState(false)
  const [resolved, setResolved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number; skippedSuppressed: number; skippedDnc: number } | null>(null)
  const [peekPhone, setPeekPhone] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('wa_message_templates').select('*').eq('is_active', true)
      .not('meta_template_name', 'is', null).order('created_at', { ascending: false })
      .then(({ data }) => setTemplates((data ?? []) as MessageTemplate[]))
    supabase.from('wa_b_call_campaigns').select('*').order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => setCampaigns((data ?? []) as WaBCallCampaign[]))
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
  const has = (key: keyof ReachFilter, val: string) => ((filter[key] as string[] | undefined) ?? []).includes(val)

  async function findRecipients() {
    setError(null); setResult(null)
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
      // Pre-select everyone eligible (not suppressed, not opted out).
      setSelected(new Set(recs.filter(r => !r.suppressedUntil && !r.is_do_not_call && !r.dnd).map(r => r.phone)))
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

  async function send() {
    if (!template || selected.size === 0) return
    setSending(true); setError(null)
    try {
      const recs = recipients.filter(r => selected.has(r.phone)).map(r => ({ phone: r.phone, name: r.name }))
      const res = await fetch('/api/reach/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: recs, templateId,
          cohortLabel, campaignRef: filter.campaignIds?.[0] ?? null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Send failed'); setSending(false); return }
      setResult(data)
      // Refresh so freshly-sent rows now show as suppressed.
      await findRecipients()
    } catch { setError('Network error during send') }
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
              <FilterGroup label="Call campaigns">
                {campaigns.length === 0 && <span className="text-[11px] text-gray-400">No campaigns yet.</span>}
                {campaigns.map(c => (
                  <Chip key={c.id} on={has('campaignIds', c.id)} onClick={() => toggleArr('campaignIds', c.id)}>
                    {c.name}{c.is_active ? ' ·live' : ''}
                  </Chip>
                ))}
              </FilterGroup>

              <FilterGroup label="Call outcome (intent)">
                {REACH_INTENTS.map(i => (
                  <Chip key={i.value} on={has('intents', i.value)} onClick={() => toggleArr('intents', i.value)}>{i.label}</Chip>
                ))}
                <Chip on={!!filter.hotLead} onClick={() => toggleBool('hotLead')}>★ Hot</Chip>
              </FilterGroup>

              <FilterGroup label="Talked about (call topics)">
                {CALL_TOPICS.map(t => (
                  <Chip key={t.value} on={has('callTopics', t.value)} onClick={() => toggleArr('callTopics', t.value)}>{t.label}</Chip>
                ))}
              </FilterGroup>

              <FilterGroup label="Interested in (chat + call + sales)">
                {ENGAGEMENT_INTERESTS.map(i => (
                  <Chip key={i.key} on={has('interests', i.key)} onClick={() => toggleArr('interests', i.key)}>{i.label}</Chip>
                ))}
              </FilterGroup>

              <FilterGroup label="Recency">
                {RECENCY_TIERS.map(r => <Chip key={r} on={has('recency_tier', r)} onClick={() => toggleArr('recency_tier', r)}>{r}</Chip>)}
              </FilterGroup>
              <FilterGroup label="Value">
                {VALUE_TIERS.map(v => <Chip key={v} on={has('value_tier', v)} onClick={() => toggleArr('value_tier', v)}>{v}</Chip>)}
                <Chip on={!!filter.is_high_value} onClick={() => toggleBool('is_high_value')}>High value</Chip>
                <Chip on={!!filter.is_likely_wedding} onClick={() => toggleBool('is_likely_wedding')}>Wedding</Chip>
              </FilterGroup>

              <div className="flex gap-2">
                <label className="flex-1 text-[11px] text-gray-500">Called from
                  <input type="date" className="input text-sm mt-0.5" value={filter.calledFrom ?? ''}
                    onChange={e => { setFilter(f => ({ ...f, calledFrom: e.target.value || undefined })); setResolved(false) }} />
                </label>
                <label className="flex-1 text-[11px] text-gray-500">to
                  <input type="date" className="input text-sm mt-0.5" value={filter.calledTo ?? ''}
                    onChange={e => { setFilter(f => ({ ...f, calledTo: e.target.value || undefined })); setResolved(false) }} />
                </label>
              </div>
              <p className="text-[10px] text-gray-400">Multiple picks in one group = OR. Across groups = AND (must match all).</p>
            </div>
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
              <Stat label="Will send" value={eligibleCount} accent="text-green-700" />
              <Stat label="Suppressed" value={suppressedCount} accent="text-amber-600" />
              <Stat label="Opted out" value={blockedCount} accent="text-gray-400" />
            </div>
            {capped && <p className="text-[10px] text-amber-600">Showing first {recipients.length} of {total.toLocaleString('en-IN')} — narrow the cohort to review all.</p>}

            {result && (
              <div className="text-xs bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-green-800">
                Sent {result.sent} · skipped {result.skippedSuppressed} (already messaged) · {result.skippedDnc} opted-out · {result.failed} failed.
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
      {resolved && template && (
        <div className="fixed bottom-14 inset-x-0 z-30 px-4">
          <div className="max-w-lg mx-auto">
            <button onClick={send} disabled={sending || selected.size === 0}
              className="btn-primary w-full shadow-lg disabled:opacity-60">
              {sending ? 'Sending…' : `Send "${template.name}" to ${selected.size}`}
            </button>
          </div>
        </div>
      )}

      <CustomerPeek phone={peekPhone} onClose={() => setPeekPhone(null)} />
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
