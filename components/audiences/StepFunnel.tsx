'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import RuleBuilder from '@/components/audiences/RuleBuilder'
import { emptyTree, isEmptyTree, type RuleTree } from '@/lib/audiences/rules'
import type { MessageTemplate } from '@/lib/types'

// StepFunnel — the multi-step funnel on an audience. Each step CARRIES a cohort
// from the previous step's outcome (delivered / read / replied / connected),
// optionally NARROWS it by markers, then ACTS (chat / call). The list, read
// top-to-bottom, IS the funnel. All numbers are exact — attributed per wamid /
// per call log, no time-window guessing.

type Signal = 'all' | 'delivered' | 'read' | 'replied' | 'connected'

interface Funnel {
  entered: number
  sent?: number; delivered?: number; read?: number; replied?: number
  attempts?: number; connected?: number; notConnected?: number; pending?: number
}
interface StepView {
  id: string
  seq: number
  name: string | null
  action: 'chat' | 'call'
  carrySignal: Signal
  carryButton: string | null
  narrowRules: RuleTree | null
  templateId: string | null
  status: 'draft' | 'run'
  runAt: string | null
  funnel: Funnel
}

type DynOpts = Partial<Record<'call_campaigns' | 'topics' | 'ad_campaigns' | 'salesmen', { value: string; label: string }[]>>

const SIGNAL_LABEL: Record<Signal, string> = {
  all: 'everyone', delivered: 'delivered to', read: 'who read', replied: 'who tapped a button', connected: 'connected on call',
}

export default function StepFunnel({
  audienceId, templates, dynamicOptions,
}: {
  audienceId: string
  templates: MessageTemplate[]
  dynamicOptions: DynOpts
}) {
  const [steps, setSteps] = useState<StepView[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)   // stepId currently running, or 'add'
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  // add-step form
  const [adding, setAdding] = useState(false)
  const [action, setAction] = useState<'chat' | 'call'>('chat')
  const [carrySignal, setCarrySignal] = useState<Signal>('all')
  const [carryButton, setCarryButton] = useState('')
  const [narrowOpen, setNarrowOpen] = useState(false)
  const [narrowRules, setNarrowRules] = useState<RuleTree>(emptyTree())
  const [templateId, setTemplateId] = useState('')
  const [name, setName] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/audiences/steps?audienceId=${audienceId}`)
      const data = await res.json()
      setSteps(data.steps ?? [])
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [audienceId])

  useEffect(() => { load() }, [load])

  const lastStep = steps[steps.length - 1] ?? null
  const isFirst = steps.length === 0

  // Which carry signals are offered depends on the PREVIOUS step's channel.
  const carryOptions: Signal[] = useMemo(() => {
    if (isFirst) return ['all']
    return lastStep?.action === 'call' ? ['all', 'connected'] : ['all', 'delivered', 'read', 'replied']
  }, [isFirst, lastStep])

  function openAdd() {
    setAdding(true); setError(null); setNote(null)
    setAction('chat'); setCarryButton(''); setNarrowOpen(false); setNarrowRules(emptyTree()); setTemplateId(''); setName('')
    // Sensible default carry for the previous channel.
    setCarrySignal(isFirst ? 'all' : lastStep?.action === 'call' ? 'connected' : 'read')
  }

  async function addStep() {
    setBusy('add'); setError(null); setNote(null)
    try {
      const res = await fetch('/api/audiences/steps', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audienceId, action,
          carrySignal: isFirst ? 'all' : carrySignal,
          carryButton: carrySignal === 'replied' && carryButton.trim() ? carryButton.trim() : null,
          narrowRules: !isEmptyTree(narrowRules) ? narrowRules : null,
          templateId: action === 'chat' ? templateId : null,
          name: name.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not add step.'); return }
      setAdding(false)
      await load()
    } catch { setError('Network error.') } finally { setBusy(null) }
  }

  async function runStep(id: string) {
    setBusy(id); setError(null); setNote(null)
    try {
      const res = await fetch('/api/audiences/steps/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stepId: id }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Run failed.'); return }
      setNote(data.sent != null
        ? `Sent ${data.sent} · ${data.skippedSuppressed ?? 0} already had it · ${data.skippedDnc ?? 0} opted out.`
        : `Calling deck set — ${data.callable} card(s) live.`)
      await load()
    } catch { setError('Network error.') } finally { setBusy(null) }
  }

  async function deleteStep(id: string) {
    setBusy(id); setError(null)
    try {
      const res = await fetch('/api/audiences/steps/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stepId: id }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not remove.'); return }
      await load()
    } catch { setError('Network error.') } finally { setBusy(null) }
  }

  const templateName = (id: string | null) => templates.find(t => t.id === id)?.name ?? 'template'

  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">🎯 Funnel (steps)</p>

      {loading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : steps.length === 0 && !adding ? (
        <p className="text-xs text-gray-400 mb-2">No steps yet. Add the first action on this audience — a WhatsApp send or a call.</p>
      ) : (
        <div className="space-y-2 mb-2">
          {steps.map(s => (
            <div key={s.id} className="border border-gray-200 rounded-lg p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-gray-800 truncate">
                  <span className="text-gray-400">#{s.seq}</span> {s.action === 'call' ? '📞 Call' : '💬 ' + templateName(s.templateId)}
                  {s.name ? ` · ${s.name}` : ''}
                </p>
                {s.status === 'draft'
                  ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 flex-shrink-0">draft</span>
                  : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex-shrink-0">run</span>}
              </div>

              {/* carry + narrow description */}
              <p className="text-[10px] text-gray-400 mt-0.5">
                {s.seq === 1 ? 'from the whole audience' : `carries ${SIGNAL_LABEL[s.carrySignal]} step ${s.seq - 1}`}
                {s.carryButton ? ` ("${s.carryButton}")` : ''}
                {s.narrowRules && !isEmptyTree(s.narrowRules) ? ' · narrowed by markers' : ''}
              </p>

              {/* funnel numbers */}
              {s.status === 'run' && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1.5 text-[11px]">
                  <Stat label="entered" v={s.funnel.entered} />
                  {s.action === 'chat' ? (
                    <>
                      <Arrow /><Stat label="sent" v={s.funnel.sent ?? 0} />
                      <Arrow /><Stat label="delivered" v={s.funnel.delivered ?? 0} />
                      <Arrow /><Stat label="read" v={s.funnel.read ?? 0} accent="text-blue-600" />
                      <Arrow /><Stat label="replied" v={s.funnel.replied ?? 0} accent="text-green-700" />
                    </>
                  ) : (
                    <>
                      <Arrow /><Stat label="called" v={s.funnel.attempts ?? 0} />
                      <Arrow /><Stat label="connected" v={s.funnel.connected ?? 0} accent="text-green-700" />
                      {(s.funnel.pending ?? 0) > 0 && <><Arrow /><Stat label="pending" v={s.funnel.pending ?? 0} accent="text-amber-600" /></>}
                    </>
                  )}
                </div>
              )}

              {s.status === 'draft' && (
                <div className="flex items-center gap-2 mt-2">
                  <button onClick={() => runStep(s.id)} disabled={busy === s.id}
                    className="text-[11px] font-semibold bg-green-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
                    {busy === s.id ? 'Running…' : s.action === 'call' ? 'Run — set calling deck' : 'Run — send now'}
                  </button>
                  <button onClick={() => deleteStep(s.id)} disabled={busy === s.id}
                    className="text-[11px] text-gray-400 px-2 py-1.5">Remove</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 mb-2">{error}</p>}
      {note && <p className="text-[11px] text-green-700 bg-green-50 border border-green-200 rounded-lg px-2.5 py-1.5 mb-2">{note}</p>}

      {/* Add-step form */}
      {adding ? (
        <div className="border border-gray-200 rounded-lg p-3 space-y-2.5">
          {/* action */}
          <div className="flex gap-1.5">
            {(['chat', 'call'] as const).map(a => (
              <button key={a} onClick={() => setAction(a)}
                className={`flex-1 text-xs font-medium py-1.5 rounded-lg border ${action === a ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300'}`}>
                {a === 'chat' ? '💬 WhatsApp' : '📞 Call'}
              </button>
            ))}
          </div>

          {/* carry (hidden for the first step) */}
          {!isFirst && (
            <div>
              <p className="text-[11px] text-gray-500 mb-1">Start from step {steps.length}&apos;s…</p>
              <div className="flex flex-wrap gap-1.5">
                {carryOptions.map(sig => (
                  <button key={sig} onClick={() => setCarrySignal(sig)}
                    className={`text-[11px] px-2.5 py-1 rounded-lg border ${carrySignal === sig ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'}`}>
                    {SIGNAL_LABEL[sig]}
                  </button>
                ))}
              </div>
              {carrySignal === 'replied' && (
                <input value={carryButton} onChange={e => setCarryButton(e.target.value)}
                  placeholder="specific button id (optional, e.g. see_designs)"
                  className="input mt-1.5 text-xs" />
              )}
            </div>
          )}

          {/* narrow (optional) */}
          <div>
            <button onClick={() => setNarrowOpen(o => !o)} className="text-[11px] font-medium text-gray-600">
              {narrowOpen ? '▾' : '▸'} Narrow by markers (optional)
            </button>
            {narrowOpen && (
              <div className="mt-1.5">
                <RuleBuilder tree={narrowRules} onChange={setNarrowRules} dynamicOptions={dynamicOptions} />
              </div>
            )}
          </div>

          {/* chat template */}
          {action === 'chat' && (
            <select value={templateId} onChange={e => setTemplateId(e.target.value)} className="input text-xs">
              <option value="">Pick a template…</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}

          <input value={name} onChange={e => setName(e.target.value)} placeholder="Step label (optional)" className="input text-xs" />

          <div className="flex gap-2">
            <button onClick={addStep} disabled={busy === 'add' || (action === 'chat' && !templateId)}
              className="flex-1 text-xs font-semibold bg-gray-900 text-white py-2 rounded-lg disabled:opacity-50">
              {busy === 'add' ? 'Adding…' : 'Add step (draft)'}
            </button>
            <button onClick={() => setAdding(false)} className="text-xs text-gray-500 px-3">Cancel</button>
          </div>
          <p className="text-[10px] text-gray-400">Added as a draft — review, then Run to actually send / call.</p>
        </div>
      ) : (
        <button onClick={openAdd} className="w-full text-xs font-medium text-green-700 border border-dashed border-green-300 rounded-lg py-2">
          + Add step
        </button>
      )}
    </div>
  )
}

function Stat({ label, v, accent }: { label: string; v: number; accent?: string }) {
  return <span className="whitespace-nowrap"><span className={`font-bold ${accent ?? 'text-gray-900'}`}>{v}</span> <span className="text-gray-400">{label}</span></span>
}
function Arrow() { return <span className="text-gray-300">→</span> }
