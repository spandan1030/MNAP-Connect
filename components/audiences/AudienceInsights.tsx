'use client'

import { useCallback, useEffect, useState } from 'react'
import RuleBuilder from '@/components/audiences/RuleBuilder'
import CampaignDetail from '@/components/campaigns/CampaignDetail'
import { emptyTree, isEmptyTree, type RuleTree } from '@/lib/audiences/rules'
import { CALL_INTENTS, CALL_TOPICS } from '@/lib/calls'

// ── Unified audience Insights ────────────────────────────────────────────────
// One place: every template sent to this audience (with its full funnel +
// drill-down), every calling cohort + call outcomes, and the two ways to CARRY
// a slice forward — as a new, reusable audience:
//   · narrow      — members ∩ a marker filter (e.g. the 30 who said will-come)
//   · engagement  — who reached a stage on a template (e.g. who read T1 → send T2)
// A saved slice is just another audience you send templates to. This replaces
// the old multi-step funnel.

interface ChatRow {
  campaignId: string; name: string; template: string | null
  total: number; sent: number; failed: number; skipped: number
  delivered: number; read: number; replied: number; createdAt: string
}
interface CallRow {
  campaignId: string; name: string; isActive: boolean; cards: number
  attempts: number; connected: number; notConnected: number; pending: number; createdAt: string
}
interface CallSummary {
  attempts: number; connected: number; noAnswer: number; pending: number
  topics: Record<string, number>; intents: Record<string, number>
  hotLeads: { name: string; phone: string }[]
  bySalesman: { alias: string; attempts: number; connected: number }[]
}
interface Report { chat: ChatRow[]; call: CallRow[]; callSummary: CallSummary | null }

type Stage = 'read' | 'replied' | 'delivered' | 'delivered_not_read' | 'not_delivered'
const STAGE_OPTS: { value: Stage; label: string }[] = [
  { value: 'read', label: 'Read it' },
  { value: 'replied', label: 'Replied' },
  { value: 'delivered', label: 'Delivered to' },
  { value: 'delivered_not_read', label: 'Delivered, not read' },
  { value: 'not_delivered', label: 'Not delivered' },
]

type DynOpts = {
  call_campaigns: { value: string; label: string }[]
  topics: { value: string; label: string }[]
  salesmen: { value: string; label: string }[]
}

export default function AudienceInsights({
  audienceId, audienceName, dynamicOptions, onSaved,
}: {
  audienceId: string
  audienceName: string
  dynamicOptions: DynOpts
  onSaved?: () => void
}) {
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [openCampaign, setOpenCampaign] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/audiences/report?id=${audienceId}`)
      const data = await res.json()
      setReport(data?.error ? null : data)
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [audienceId])
  useEffect(() => { load() }, [load])

  async function saveSlice(body: Record<string, unknown>) {
    setError(null); setNote(null)
    const res = await fetch('/api/audiences/save-slice', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Could not save the slice.'); return false }
    setNote(`Saved as a new audience — ${data.count} people. Find it in the Audiences list to send templates.`)
    onSaved?.()
    return true
  }

  return (
    <div className="space-y-4">
      {note && <p className="text-[11px] text-green-800 bg-green-50 border border-green-100 rounded-lg px-3 py-2">{note}</p>}
      {error && <p className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      {/* Carry by NARROW — save a marker slice of this audience as a new audience. */}
      <NarrowSlice audienceName={audienceName} dynamicOptions={dynamicOptions}
        onSave={(payload) => saveSlice({ mode: 'narrow', audienceId, ...payload })} />

      {loading && <p className="text-sm text-gray-400 text-center py-6">Loading…</p>}

      {report && !loading && (
        <>
          {/* ── Chat: one row per template, tap to drill down, carry by engagement ── */}
          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">💬 Templates sent</p>
            {report.chat.length === 0 ? (
              <p className="text-xs text-gray-400">No chat sends yet. Activate this audience on a template to start.</p>
            ) : (
              <div className="space-y-2">
                {report.chat.map(c => (
                  <div key={c.campaignId} className="border border-gray-200 rounded-lg overflow-hidden">
                    <button onClick={() => setOpenCampaign(openCampaign === c.campaignId ? null : c.campaignId)}
                      className="w-full text-left p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-gray-800 truncate">
                          {c.template || c.name}
                        </p>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">{openCampaign === c.campaignId ? '▾' : '▸'}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11px]">
                        <Stat label="sent" v={c.sent} />
                        <Arrow /><Stat label="delivered" v={c.delivered} />
                        <Arrow /><Stat label="read" v={c.read} accent="text-indigo-600" />
                        <Arrow /><Stat label="replied" v={c.replied} accent="text-amber-700" />
                        {c.failed > 0 && <><span className="text-gray-300">·</span><Stat label="failed" v={c.failed} accent="text-red-500" /></>}
                      </div>
                    </button>
                    {openCampaign === c.campaignId && (
                      <div className="px-2.5 pb-2.5 border-t border-gray-100 pt-2.5">
                        <CampaignDetail campaignId={c.campaignId} sliceActions={() => (
                          <CarryByEngagement templateLabel={c.template || c.name}
                            onSave={(stage, name) => saveSlice({ mode: 'engagement', campaignId: c.campaignId, stage, name })} />
                        )} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Calling cohorts ── */}
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

          {/* ── Call outcomes (topics / intent / salesman / hot) ── */}
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
  )
}

// ── Carry by NARROW: members ∩ marker filter → save as audience ──────────────
function NarrowSlice({
  audienceName, dynamicOptions, onSave,
}: {
  audienceName: string
  dynamicOptions: DynOpts
  onSave: (payload: Record<string, unknown>) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [rules, setRules] = useState<RuleTree>(emptyTree())
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const active = !isEmptyTree(rules)

  async function save() {
    if (!name.trim() || !active) return
    setBusy(true)
    const ok = await onSave({ name: name.trim(), subRules: rules })
    setBusy(false)
    if (ok) { setName(''); setRules(emptyTree()); setOpen(false) }
  }

  return (
    <div className="border border-dashed border-green-300 rounded-lg p-2.5">
      <button onClick={() => setOpen(o => !o)} className="text-[11px] font-semibold text-green-700 flex items-center gap-1">
        {open ? '▾' : '▸'} Narrow this audience → save a slice
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-[10px] text-gray-400">Keep only the members of “{audienceName}” who also match — e.g. Last call outcome = Will come, or Starred hot ★. Saved as a new audience you can send templates to (N at a time).</p>
          <RuleBuilder tree={rules} onChange={setRules} dynamicOptions={dynamicOptions} />
          <input value={name} onChange={e => setName(e.target.value)} placeholder="New audience name (e.g. Winback · Will-come)" className="input text-xs" />
          <button onClick={save} disabled={busy || !name.trim() || !active}
            className="w-full text-xs font-semibold bg-gray-900 text-white py-2 rounded-lg disabled:opacity-50">
            {busy ? 'Saving…' : 'Save slice as audience'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Carry by ENGAGEMENT: who reached a stage on this template → save as audience ─
function CarryByEngagement({
  templateLabel, onSave,
}: {
  templateLabel: string
  onSave: (stage: Stage, name: string) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<Stage>('read')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!name.trim()) return
    setBusy(true)
    const ok = await onSave(stage, name.trim())
    setBusy(false)
    if (ok) { setName(''); setOpen(false) }
  }

  return (
    <div className="mt-1">
      <button onClick={() => setOpen(o => !o)} className="text-[11px] font-semibold text-green-700 flex items-center gap-1">
        {open ? '▾' : '▸'} Carry a slice → new audience (send a follow-up)
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 bg-gray-50 rounded-lg p-2">
          <p className="text-[10px] text-gray-400">Save the people who reached a stage on “{templateLabel}” as a new audience, then send them the next template.</p>
          <select value={stage} onChange={e => setStage(e.target.value as Stage)} className="input text-xs">
            {STAGE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="New audience name (e.g. Read T1)" className="input text-xs" />
          <button onClick={save} disabled={busy || !name.trim()}
            className="w-full text-xs font-semibold bg-gray-900 text-white py-1.5 rounded-lg disabled:opacity-50">
            {busy ? 'Saving…' : 'Save as audience'}
          </button>
        </div>
      )}
    </div>
  )
}

function Stat({ label, v, accent }: { label: string; v: number; accent?: string }) {
  return <span className="whitespace-nowrap"><span className={`font-bold ${accent ?? 'text-gray-900'}`}>{v}</span> <span className="text-gray-400">{label}</span></span>
}
function Arrow() { return <span className="text-gray-300">→</span> }
function Metric({ label, v, accent }: { label: string; v: number; accent?: string }) {
  return (
    <div>
      <p className={`text-sm font-bold ${accent ?? 'text-gray-900'}`}>{v.toLocaleString('en-IN')}</p>
      <p className="text-[10px] text-gray-400">{label}</p>
    </div>
  )
}
