'use client'

import { useEffect, useState } from 'react'
import Navbar from '@/components/ui/Navbar'
import FilterBuilder from '@/components/reach/FilterBuilder'
import { createClient } from '@/lib/supabase/client'
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [seedMsg, setSeedMsg] = useState<string | null>(null)

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

  async function seedPresets() {
    setSeeding(true); setSeedMsg(null)
    try {
      const res = await fetch('/api/audiences/seed', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setSeedMsg(data.error ?? 'Seeding failed.'); return }
      setSeedMsg(`Seeded ${data.created} preset audience(s)${data.skipped ? `, ${data.skipped} already existed` : ''}.${data.errors?.length ? ` (${data.errors.length} warning(s))` : ''}`)
      load()
    } catch { setSeedMsg('Network error.') } finally { setSeeding(false) }
  }

  function openNew() {
    setEditing('new'); setName(''); setDescription(''); setFilter({}); setIsDynamic(false); setError(null)
  }
  async function openEdit(a: Audience) {
    setError(null)
    const res = await fetch(`/api/audiences/detail?id=${a.id}`)
    const data = await res.json()
    const aud = data.audience
    setEditing(a.id)
    setName(aud.name); setDescription(aud.description ?? '')
    setFilter((aud.filter ?? {}) as ReachFilter); setIsDynamic(!!aud.is_dynamic)
  }
  function close() { setEditing(null); setError(null) }

  async function save() {
    const nm = name.trim()
    if (!nm) { setError('Give the audience a name.'); return }
    if (Object.keys(filter).length === 0) { setError('Add at least one filter.'); return }
    setBusy(true); setError(null)
    try {
      const isNew = editing === 'new'
      const res = await fetch(isNew ? '/api/audiences' : '/api/audiences/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isNew
          ? { name: nm, description, filter, isDynamic }
          : { id: editing, name: nm, description, filter, isDynamic }),
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

              <FilterBuilder filter={filter} campaigns={campaigns} topics={topics} onChange={setFilter} />

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
                <p className="text-[11px] text-gray-500">Pushing to calling <b>replaces</b> the current calling deck with this cohort. Non-callable / do-not-call members are skipped.</p>
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
    </div>
  )
}
