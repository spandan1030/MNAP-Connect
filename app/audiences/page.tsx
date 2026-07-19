'use client'

import { useEffect, useState } from 'react'
import Navbar from '@/components/ui/Navbar'
import FilterBuilder from '@/components/reach/FilterBuilder'
import RuleBuilder from '@/components/audiences/RuleBuilder'
import { emptyTree, isEmptyTree, type RuleTree } from '@/lib/audiences/rules'
import { createClient } from '@/lib/supabase/client'
import { CALL_TOPICS, CALL_INTENTS } from '@/lib/calls'
import { cn } from '@/lib/utils'
import type { InterestTopic, MessageTemplate, ReachFilter, WaBCallCampaign } from '@/lib/types'

// Audience Library — the modular core of Lead-Gen Phase 1. Save a named filter
// (fixed snapshot or auto-updating), see its materialised size, edit/refresh it.
// Activation (send to chat / push to calling) is the next step, off the same list.

interface Audience {
  id: string
  name: string
  description: string | null
  is_dynamic: boolean
  is_active: boolean
  is_seeded: boolean
  member_count: number
  last_refreshed_at: string | null
  created_at: string
}

function fmt(iso: string | null): string {
  if (!iso) return 'never'
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d <= 0) return 'today'
  return d === 1 ? '1d ago' : `${d}d ago`
}

export default function AudiencesPage() {
  const supabase = createClient()
  const [audiences, setAudiences] = useState<Audience[]>([])
  const [loading, setLoading] = useState(true)
  const [campaigns, setCampaigns] = useState<WaBCallCampaign[]>([])
  const [topics, setTopics] = useState<InterestTopic[]>([])

  // editor state: null = closed, 'new' or an id
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [filter, setFilter] = useState<ReachFilter>({})
  const [isDynamic, setIsDynamic] = useState(false)
  // Rule tree is how audiences are authored now. `useRules` is false only when
  // editing an audience saved in the older filter format — those keep their own
  // editor rather than being silently converted.
  const [rules, setRules] = useState<RuleTree>(emptyTree())
  const [useRules, setUseRules] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [seedMsg, setSeedMsg] = useState<string | null>(null)

  // insights
  type Report = {
    chat: Array<{ campaignId: string; name: string; template: string | null; total: number; sent: number; failed: number; skipped: number; delivered: number; read: number; createdAt: string }>
    call: Array<{ campaignId: string; name: string; isActive: boolean; cards: number; attempts: number; connected: number; createdAt: string }>
    // What came out of those calls — same insights as /admin/calls/report, scoped
    // to this audience's cohorts rather than a date range.
    callSummary: {
      attempts: number; connected: number; noAnswer: number; pending: number
      topics: Record<string, number>
      intents: Record<string, number>
      hotLeads: Array<{ name: string; phone: string }>
      bySalesman: Array<{ alias: string; attempts: number; connected: number }>
    } | null
  }
  const [reportFor, setReportFor] = useState<Audience | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [reportLoading, setReportLoading] = useState(false)

  async function openReport(a: Audience) {
    setReportFor(a); setReport(null); setReportLoading(true)
    try {
      const res = await fetch(`/api/audiences/report?id=${a.id}`)
      setReport(await res.json())
    } catch { /* ignore */ } finally { setReportLoading(false) }
  }

  // activation sheet
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [activate, setActivate] = useState<Audience | null>(null)
  const [channel, setChannel] = useState<'chat' | 'call'>('chat')
  const [actTemplateId, setActTemplateId] = useState('')
  const [actLimit, setActLimit] = useState<number | ''>('')
  const [subOpen, setSubOpen] = useState(false)
  const [subFilter, setSubFilter] = useState<ReachFilter>({})
  const [actBusy, setActBusy] = useState(false)
  const [actError, setActError] = useState<string | null>(null)
  const [actResult, setActResult] = useState<string | null>(null)

  useEffect(() => { load() }, [])
  useEffect(() => {
    supabase.from('wa_b_call_campaigns').select('*').order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => setCampaigns((data ?? []) as WaBCallCampaign[]))
    supabase.from('wa_interest_topics').select('*').eq('is_active', true).is('parent_id', null).order('sort_order')
      .then(({ data }) => setTopics(((data ?? []) as InterestTopic[]).filter(t => t.topic_group !== 'system')))
    supabase.from('wa_message_templates').select('*').eq('is_active', true)
      .not('meta_template_name', 'is', null).order('created_at', { ascending: false })
      .then(({ data }) => setTemplates((data ?? []) as MessageTemplate[]))
  }, [supabase])

  function openActivate(a: Audience) {
    setActivate(a); setChannel('chat'); setActTemplateId(''); setActLimit('')
    setSubOpen(false); setSubFilter({}); setActError(null); setActResult(null)
  }
  async function adoptActiveCall() {
    if (!activate) return
    setActBusy(true); setActError(null); setActResult(null)
    try {
      const res = await fetch('/api/audiences/adopt-active-call', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audienceId: activate.id }),
      })
      const data = await res.json()
      if (!res.ok) { setActError(data.error ?? 'Could not adopt.'); return }
      setActResult(`Adopted "${data.adopted}" — this audience now owns that calling cohort (history preserved).`)
    } catch { setActError('Network error.') } finally { setActBusy(false) }
  }
  async function runActivation() {
    if (!activate) return
    setActBusy(true); setActError(null); setActResult(null)
    try {
      const res = await fetch('/api/audiences/activate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audienceId: activate.id, channel,
          templateId: channel === 'chat' ? actTemplateId : undefined,
          subFilter: Object.keys(subFilter).length ? subFilter : undefined,
          limit: channel === 'chat' && actLimit !== '' ? actLimit : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setActError(data.error ?? 'Activation failed.'); setActBusy(false); return }
      setActResult(channel === 'chat'
        ? `Sent ${data.sent} · ${data.skippedSuppressed} skipped (already got it) · ${data.eligibleRemaining} left to send.`
        : `Calling cohort set — ${data.callable} callable card(s) now on the calling deck.`)
      load()
    } catch { setActError('Network error.') } finally { setActBusy(false) }
  }

  async function load() {
    setLoading(true)
    const res = await fetch('/api/audiences')
    const data = await res.json()
    setAudiences(data.audiences ?? [])
    setLoading(false)
  }

  // Materialise every audience, one request at a time (each cohort resolve is heavy;
  // batching them in one call times out). Shows progress.
  async function refreshAll(list: Audience[], prefix: string) {
    for (let i = 0; i < list.length; i++) {
      setSeedMsg(`${prefix} — building members ${i + 1}/${list.length} (${list[i].name})…`)
      await fetch('/api/audiences/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: list[i].id }),
      }).catch(() => {})
    }
  }

  async function seedPresets() {
    setSeeding(true); setSeedMsg('Seeding presets…')
    try {
      const res = await fetch('/api/audiences/seed', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setSeedMsg(data.error ?? 'Seeding failed.'); return }
      // Reload to get the seeded rows, then materialise them one by one.
      const listRes = await fetch('/api/audiences'); const listData = await listRes.json()
      const all: Audience[] = listData.audiences ?? []
      await refreshAll(all, `Seeded ${data.seeded} audiences`)
      setSeedMsg(`Done — ${data.seeded} preset audiences ready.`)
      load()
    } catch { setSeedMsg('Network error.') } finally { setSeeding(false) }
  }

  function openNew() {
    setEditing('new'); setName(''); setDescription(''); setFilter({}); setIsDynamic(false); setError(null)
    setRules(emptyTree()); setUseRules(true)
  }
  async function openEdit(a: Audience) {
    setError(null)
    const res = await fetch(`/api/audiences/detail?id=${a.id}`)
    const data = await res.json()
    const aud = data.audience
    setEditing(a.id)
    setName(aud.name); setDescription(aud.description ?? '')
    setFilter((aud.filter ?? {}) as ReachFilter); setIsDynamic(!!aud.is_dynamic)
    const saved = (aud.rules ?? null) as RuleTree | null
    setUseRules(!isEmptyTree(saved)); setRules(saved ?? emptyTree())
  }
  function close() { setEditing(null); setError(null) }

  async function save() {
    const nm = name.trim()
    if (!nm) { setError('Give the audience a name.'); return }
    if (useRules ? isEmptyTree(rules) : Object.keys(filter).length === 0) { setError('Add at least one rule.'); return }
    setBusy(true); setError(null)
    try {
      const isNew = editing === 'new'
      const res = await fetch(isNew ? '/api/audiences' : '/api/audiences/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isNew ? {} : { id: editing }),
          name: nm, description, isDynamic,
          ...(useRules ? { rules } : { filter }),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not save.'); setBusy(false); return }
      close(); load()
    } catch { setError('Network error.') } finally { setBusy(false) }
  }

  async function refresh(id: string) {
    setRefreshing(id)
    await fetch('/api/audiences/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
    })
    setRefreshing(null); load()
  }
  async function remove(a: Audience) {
    if (!confirm(`Delete audience "${a.name}"? Past sends/calls keep their history.`)) return
    await fetch('/api/audiences/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id }),
    })
    load()
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-3 pb-28">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Audiences</h1>
            <p className="text-xs text-gray-500">Saved, reusable cohorts. Pick one to message or call — no re-filtering.</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={seedPresets} disabled={seeding}
              className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700 font-medium disabled:opacity-50">
              {seeding ? 'Seeding…' : 'Seed presets'}
            </button>
            <button onClick={openNew} className="btn-primary text-sm px-3 py-1.5">+ New</button>
          </div>
        </div>
        {seedMsg && <p className="text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">{seedMsg}</p>}

        {loading && <p className="text-sm text-gray-400 text-center py-8">Loading…</p>}
        {!loading && audiences.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">No audiences yet. Tap <b>+ New</b> to build one.</p>
        )}

        {audiences.map(a => (
          <div key={a.id} className="card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-sm font-semibold text-gray-800 truncate">{a.name}</p>
                  {a.is_seeded && <span className="text-[9px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded-full">PRESET</span>}
                  <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full border',
                    a.is_dynamic ? 'text-blue-700 bg-blue-50 border-blue-200' : 'text-gray-500 bg-gray-50 border-gray-200')}>
                    {a.is_dynamic ? 'AUTO-UPDATE' : 'FIXED'}
                  </span>
                  {!a.is_active && <span className="text-[9px] text-gray-400">inactive</span>}
                </div>
                {a.description && <p className="text-[11px] text-gray-500 mt-0.5 truncate">{a.description}</p>}
                <p className="text-[11px] text-gray-400 mt-0.5">
                  <b className="text-gray-700">{a.member_count.toLocaleString('en-IN')}</b> members · refreshed {fmt(a.last_refreshed_at)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-gray-100">
              <button onClick={() => openEdit(a)} className="text-[11px] font-medium text-gray-700 border border-gray-200 px-2.5 py-1 rounded-lg">Edit</button>
              <button onClick={() => refresh(a.id)} disabled={refreshing === a.id}
                className="text-[11px] font-medium text-gray-700 border border-gray-200 px-2.5 py-1 rounded-lg disabled:opacity-50">
                {refreshing === a.id ? 'Refreshing…' : 'Refresh'}
              </button>
              <button onClick={() => openActivate(a)} disabled={a.member_count === 0}
                className="text-[11px] font-semibold text-white bg-green-600 px-2.5 py-1 rounded-lg disabled:opacity-40">Activate</button>
              <button onClick={() => openReport(a)} className="text-[11px] font-medium text-gray-700 border border-gray-200 px-2.5 py-1 rounded-lg">Insights</button>
              <span className="flex-1" />
              <button onClick={() => remove(a)} className="text-[11px] text-red-500 px-2 py-1 rounded-lg hover:bg-red-50">Delete</button>
            </div>
          </div>
        ))}
      </main>

      {/* Editor sheet */}
      {editing && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={close}>
          <div className="bg-white rounded-t-2xl flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
            <div className="flex-shrink-0 px-5 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
              <p className="font-bold text-gray-900">{editing === 'new' ? 'New audience' : 'Edit audience'}</p>
              <button onClick={close} className="text-gray-400 text-xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
              <input className="input text-sm" placeholder="Audience name (e.g. Walk-ins 12–14 Jul)"
                value={name} onChange={e => setName(e.target.value)} />
              <input className="input text-sm" placeholder="Short description (optional)"
                value={description} onChange={e => setDescription(e.target.value)} />

              {useRules ? (
                <RuleBuilder tree={rules} onChange={setRules} dynamicOptions={{
                  call_campaigns: campaigns.map(c => ({ value: c.id, label: c.name })),
                  topics: topics.map(t => ({ value: t.id, label: t.name })),
                }} />
              ) : (
                <>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 mb-2">
                    <p className="text-[11px] text-amber-800">This audience uses the older filter format. It keeps working exactly as-is — editing it here changes nothing about how it resolves.</p>
                  </div>
                  <FilterBuilder filter={filter} campaigns={campaigns} topics={topics} onChange={setFilter} />
                </>
              )}

              <label className="flex items-start gap-2 text-[11px] text-gray-600 pt-1">
                <input type="checkbox" className="mt-0.5" checked={isDynamic} onChange={e => setIsDynamic(e.target.checked)} />
                <span><b>Auto-update</b> — re-resolve on refresh: new matches join, no-longer-matching drop. Off = a fixed snapshot of who matches now.</span>
              </label>
              {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            </div>
            <div className="flex-shrink-0 px-5 py-3 border-t border-gray-100">
              <button onClick={save} disabled={busy} className="btn-primary w-full disabled:opacity-60">
                {busy ? 'Saving…' : editing === 'new' ? 'Create audience' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activation sheet */}
      {activate && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => setActivate(null)}>
          <div className="bg-white rounded-t-2xl flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
            <div className="flex-shrink-0 px-5 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
              <div className="min-w-0">
                <p className="font-bold text-gray-900 truncate">Activate — {activate.name}</p>
                <p className="text-[11px] text-gray-500">{activate.member_count.toLocaleString('en-IN')} members</p>
              </div>
              <button onClick={() => setActivate(null)} className="text-gray-400 text-xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
              {/* channel */}
              <div className="flex gap-2">
                {(['chat', 'call'] as const).map(c => (
                  <button key={c} onClick={() => { setChannel(c); setActResult(null) }}
                    className={cn('flex-1 py-2 rounded-lg text-sm font-semibold border',
                      channel === c ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200')}>
                    {c === 'chat' ? '💬 Chat' : '📞 Calling'}
                  </button>
                ))}
              </div>

              {channel === 'chat' ? (
                <>
                  <div>
                    <p className="text-[11px] font-medium text-gray-500 mb-1">Template</p>
                    <select value={actTemplateId} onChange={e => setActTemplateId(e.target.value)} className="input text-sm">
                      <option value="">Choose a WhatsApp-approved template…</option>
                      {templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.category ? ` · ${t.category}` : ''}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-gray-500 mb-1">Send at most (this batch)</p>
                    <input type="number" min={1} inputMode="numeric" placeholder="all eligible"
                      value={actLimit} onChange={e => setActLimit(e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value) || 0))}
                      className="input text-sm" />
                    <p className="text-[10px] text-gray-400 mt-1">Already-messaged numbers auto-skip. Send N daily — the rest wait for the next batch.</p>
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] text-gray-500">Pushing to calling <b>replaces</b> the current calling deck with this cohort. Non-callable / do-not-call members are skipped. Re-pushing this audience later keeps already-called cards (no re-calling).</p>
                  <button onClick={adoptActiveCall} disabled={actBusy}
                    className="text-[11px] font-medium text-gray-700 border border-gray-200 px-2.5 py-1.5 rounded-lg w-full">
                    Adopt the current live calling cohort into this audience
                  </button>
                  <p className="text-[10px] text-gray-400">One-time: links your existing live call campaign (e.g. Lapsed Winback) to this audience, preserving its call history &amp; already-contacted status.</p>
                </div>
              )}

              {/* optional sub-filter */}
              <div className="border-t border-gray-100 pt-2">
                <button onClick={() => setSubOpen(o => !o)} className="text-[11px] font-medium text-gray-600 flex items-center gap-1">
                  {subOpen ? '▾' : '▸'} Narrow further (optional)
                  {Object.keys(subFilter).length > 0 && <span className="text-green-600">· active</span>}
                </button>
                {subOpen && (
                  <div className="mt-2">
                    <p className="text-[10px] text-gray-400 mb-2">Send only to the slice of this audience that also matches — e.g. occasion = wedding, or walk-in timing. Doesn&apos;t change the saved audience.</p>
                    <FilterBuilder filter={subFilter} campaigns={campaigns} topics={topics} onChange={setSubFilter} />
                  </div>
                )}
              </div>

              {actError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{actError}</p>}
              {actResult && <p className="text-xs text-green-800 bg-green-50 border border-green-100 rounded-lg px-3 py-2">{actResult}</p>}
            </div>
            <div className="flex-shrink-0 px-5 py-3 border-t border-gray-100">
              <button onClick={runActivation} disabled={actBusy || (channel === 'chat' && !actTemplateId)}
                className="btn-primary w-full disabled:opacity-60">
                {actBusy ? 'Working…' : channel === 'chat' ? 'Send now' : 'Set calling cohort'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Insights sheet — message funnel + call outcomes for this audience */}
      {reportFor && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => setReportFor(null)}>
          <div className="bg-white rounded-t-2xl flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
            <div className="flex-shrink-0 px-5 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
              <p className="font-bold text-gray-900 truncate">Insights — {reportFor.name}</p>
              <button onClick={() => setReportFor(null)} className="text-gray-400 text-xl leading-none">×</button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
              {reportLoading && <p className="text-sm text-gray-400 text-center py-6">Loading…</p>}
              {report && !reportLoading && (
                <>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">💬 Chat</p>
                    {report.chat.length === 0 ? <p className="text-xs text-gray-400">No chat sends yet.</p> : (
                      <div className="space-y-2">
                        {report.chat.map(c => (
                          <div key={c.campaignId} className="border border-gray-100 rounded-lg p-2.5">
                            <p className="text-xs font-medium text-gray-800 truncate">{c.name}{c.template ? ` · ${c.template}` : ''}</p>
                            <div className="grid grid-cols-5 gap-1 mt-1.5 text-center">
                              <Metric label="Sent" v={c.sent} /><Metric label="Deliv" v={c.delivered} />
                              <Metric label="Read" v={c.read} /><Metric label="Failed" v={c.failed} accent="text-red-500" />
                              <Metric label="Skip" v={c.skipped} accent="text-amber-600" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">📞 Calling</p>
                    {report.call.length === 0 ? <p className="text-xs text-gray-400">No calling cohorts yet.</p> : (
                      <div className="space-y-2">
                        {report.call.map(c => (
                          <div key={c.campaignId} className="border border-gray-100 rounded-lg p-2.5">
                            <p className="text-xs font-medium text-gray-800 truncate">{c.name}{c.isActive ? ' · live' : ''}</p>
                            <div className="grid grid-cols-3 gap-1 mt-1.5 text-center">
                              <Metric label="Cards" v={c.cards} /><Metric label="Called" v={c.attempts} />
                              <Metric label="Connected" v={c.connected} accent="text-green-700" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* What happened on the calls — outcomes, not just volume. */}
                  {report.callSummary && report.callSummary.attempts > 0 && (() => {
                    const s = report.callSummary
                    const rate = s.attempts ? Math.round((s.connected / s.attempts) * 100) : 0
                    return (
                      <div className="space-y-3">
                        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">📞 Call outcomes</p>

                        <div className="grid grid-cols-4 gap-1 text-center">
                          <Metric label="Called" v={s.attempts} />
                          <Metric label="Connected" v={s.connected} accent="text-green-700" />
                          <Metric label="No answer" v={s.noAnswer} accent="text-gray-500" />
                          <Metric label="Pending" v={s.pending} accent="text-amber-600" />
                        </div>
                        <p className="text-[10px] text-gray-400 -mt-1.5">{rate}% connect rate{s.pending > 0 ? ` · ${s.pending} awaiting an outcome` : ''}</p>

                        {Object.keys(s.intents).length > 0 && (
                          <div>
                            <p className="text-[11px] text-gray-400 font-medium mb-1">Intent (what they said)</p>
                            <div className="flex flex-wrap gap-1.5">
                              {CALL_INTENTS.filter(i => s.intents[i.value]).map(i => (
                                <span key={i.value} className="px-2.5 py-1 rounded-lg text-[11px] border border-gray-200 bg-white text-gray-700 font-medium">
                                  {i.label} <span className="text-gray-400">{s.intents[i.value]}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {Object.keys(s.topics).length > 0 && (
                          <div>
                            <p className="text-[11px] text-gray-400 font-medium mb-1">Interested in (connected calls)</p>
                            <div className="flex flex-wrap gap-1.5">
                              {CALL_TOPICS.filter(t => s.topics[t.value]).map(t => (
                                <span key={t.value} className="px-2.5 py-1 rounded-lg text-[11px] border border-gray-200 bg-white text-gray-700 font-medium">
                                  {t.label} <span className="text-gray-400">{s.topics[t.value]}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {s.bySalesman.length > 0 && (
                          <div>
                            <p className="text-[11px] text-gray-400 font-medium mb-1">By salesman</p>
                            <div className="space-y-1">
                              {s.bySalesman.map(sm => (
                                <div key={sm.alias} className="flex items-center justify-between rounded-lg px-2.5 py-1.5 border border-gray-200 bg-white text-xs">
                                  <span className="font-medium truncate text-gray-700">{sm.alias === '—' ? 'Unattributed / past calls' : sm.alias}</span>
                                  <span className="flex-shrink-0 tabular-nums text-gray-500">
                                    {sm.connected}/{sm.attempts} · {sm.attempts ? Math.round((sm.connected / sm.attempts) * 100) : 0}%
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {s.hotLeads.length > 0 && (
                          <div>
                            <p className="text-[11px] text-gray-400 font-medium mb-1">★ Hot leads — {s.hotLeads.length}</p>
                            <div className="space-y-1">
                              {s.hotLeads.map(h => (
                                <div key={h.phone} className="flex items-center justify-between text-xs border-b border-gray-50 last:border-0 py-1">
                                  <span className="text-gray-800 truncate">{h.name}</span>
                                  <a href={`tel:+91${h.phone}`} className="text-gray-500 flex-shrink-0">+91 {h.phone}</a>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ label, v, accent }: { label: string; v: number; accent?: string }) {
  return (
    <div className="bg-gray-50 rounded-md py-1">
      <p className={`text-sm font-bold ${accent ?? 'text-gray-900'}`}>{v.toLocaleString('en-IN')}</p>
      <p className="text-[9px] text-gray-400">{label}</p>
    </div>
  )
}
