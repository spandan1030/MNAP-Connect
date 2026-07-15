'use client'

import { useCallback, useEffect, useState } from 'react'
import Navbar from '@/components/ui/Navbar'
import CustomerPeek from '@/components/ui/CustomerPeek'
import { createClient } from '@/lib/supabase/client'
import { CALL_TOPICS, CALL_INTENTS, TOPIC_LABEL, INTENT_LABEL } from '@/lib/calls'
import { formatDateTime, cn } from '@/lib/utils'
import type { WaBCallCampaign } from '@/lib/types'

interface LogRow {
  id: string
  success: boolean | null
  topics: string[] | null
  intent: string | null
  called_at: string
  customer: { name: string; phone: string; is_hot_lead: boolean }
}
type DrillKey = { kind: 'topic' | 'intent'; value: string } | null

const todayStr = () => new Date().toLocaleDateString('en-CA')

export default function CallReportPage() {
  const supabase = createClient()
  const [from, setFrom] = useState(todayStr())
  const [to, setTo] = useState(todayStr())
  const [logs, setLogs] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(false)
  const [drill, setDrill] = useState<DrillKey>(null)
  const [activeCampaign, setActiveCampaign] = useState<WaBCallCampaign | null>(null)
  const [peekPhone, setPeekPhone] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setDrill(null)
    const fromD = new Date(`${from}T00:00:00`)
    const toD = new Date(`${to}T00:00:00`); toD.setDate(toD.getDate() + 1)
    const { data } = await supabase
      .from('wa_b_call_logs')
      .select('id,success,topics,intent,called_at,customer:wa_b_customers!inner(name,phone,is_hot_lead)')
      .gte('called_at', fromD.toISOString())
      .lt('called_at', toD.toISOString())
      .order('called_at', { ascending: false })
    setLogs((data as unknown as LogRow[]) ?? [])
    setLoading(false)
  }, [from, to, supabase])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    supabase.from('wa_b_call_campaigns').select('*').eq('is_active', true)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setActiveCampaign(data as WaBCallCampaign | null))
  }, [supabase])

  // ── aggregates ──
  const attempts = logs.length
  const connected = logs.filter(l => l.success === true).length
  const notConnected = logs.filter(l => l.success === false).length
  const topicCount = (t: string) => logs.filter(l => l.success && (l.topics ?? []).includes(t)).length
  const intentCount = (v: string) => logs.filter(l => l.intent === v).length

  const drillRows = drill
    ? logs.filter(l => drill.kind === 'topic'
        ? l.success && (l.topics ?? []).includes(drill.value)
        : l.intent === drill.value)
    : []

  // Hot leads = distinct starred customers called in this range (star is a
  // current per-customer flag, so we dedupe by phone across their calls).
  const hotRows = Array.from(
    new Map(logs.filter(l => l.customer.is_hot_lead).map(l => [l.customer.phone, l.customer])).values()
  )

  const exportHref = activeCampaign ? `/api/calls/export?campaign=${activeCampaign.id}` : '/api/calls/export'

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-xl mx-auto w-full px-4 py-4 space-y-4 pb-24">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Call Reporting</h1>
          <a href={exportHref} className="text-xs font-medium text-green-700 border border-green-200 bg-green-50 px-3 py-1.5 rounded-lg">
            ↓ Feedback CSV
          </a>
        </div>

        {/* date range */}
        <div className="card p-3 flex items-end gap-2">
          <div className="flex-1">
            <p className="text-[10px] text-gray-400 font-medium mb-1">From</p>
            <input type="date" className="input" value={from} max={to} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="flex-1">
            <p className="text-[10px] text-gray-400 font-medium mb-1">To</p>
            <input type="date" className="input" value={to} min={from} max={todayStr()} onChange={e => setTo(e.target.value)} />
          </div>
        </div>

        {/* summary */}
        <div className="grid grid-cols-4 gap-2">
          <Tile label="Calls" value={attempts} />
          <Tile label="Connected" value={connected} accent="text-green-700" />
          <Tile label="No answer" value={notConnected} accent="text-gray-500" />
          <Tile label="★ Hot leads" value={hotRows.length} accent="text-amber-500" />
        </div>

        {/* hot leads — starred customers in range */}
        {hotRows.length > 0 && (
          <div className="card p-3 space-y-1.5">
            <p className="text-xs font-semibold text-gray-700">★ Hot leads — {hotRows.length}</p>
            {hotRows.map(c => (
              <div key={c.phone} className="flex items-center justify-between text-xs border-b border-gray-50 last:border-0 py-1">
                <button onClick={() => setPeekPhone(c.phone)} className="text-gray-800 underline decoration-dotted underline-offset-2">{c.name}</button>
                <a href={`tel:+91${c.phone}`} className="text-gray-500">+91 {c.phone}</a>
              </div>
            ))}
          </div>
        )}

        {/* topics — click to drill */}
        <div className="card p-3 space-y-2">
          <p className="text-[11px] text-gray-400 font-medium">Interested in (connected calls) — tap to see numbers</p>
          <div className="flex flex-wrap gap-1.5">
            {CALL_TOPICS.map(t => (
              <button key={t.value} onClick={() => setDrill({ kind: 'topic', value: t.value })}
                className={cn('px-3 py-1.5 rounded-lg text-xs border font-medium',
                  drill?.kind === 'topic' && drill.value === t.value ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-200')}>
                {t.label} <span className="opacity-70">{topicCount(t.value)}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 font-medium pt-1">Intent — tap to see numbers</p>
          <div className="flex flex-wrap gap-1.5">
            {CALL_INTENTS.map(i => (
              <button key={i.value} onClick={() => setDrill({ kind: 'intent', value: i.value })}
                className={cn('px-3 py-1.5 rounded-lg text-xs border font-medium',
                  drill?.kind === 'intent' && drill.value === i.value ? i.color : i.idle)}>
                {i.label} <span className="opacity-70">{intentCount(i.value)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* drill-down list */}
        {drill && (
          <div className="card p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-700">
                {drill.kind === 'topic' ? TOPIC_LABEL[drill.value] : INTENT_LABEL[drill.value]} — {drillRows.length} number{drillRows.length !== 1 ? 's' : ''}
              </p>
              <button onClick={() => setDrill(null)} className="text-gray-400 text-sm leading-none">×</button>
            </div>
            {drillRows.map(l => (
              <div key={l.id} className="flex items-center justify-between text-xs border-b border-gray-50 last:border-0 py-1">
                <button onClick={() => setPeekPhone(l.customer.phone)} className="text-gray-800 underline decoration-dotted underline-offset-2">{l.customer.name}</button>
                <a href={`tel:+91${l.customer.phone}`} className="text-gray-500">+91 {l.customer.phone}</a>
              </div>
            ))}
          </div>
        )}

        {/* logs */}
        <div className="card p-3 space-y-2">
          <p className="text-sm font-semibold text-gray-700">Call log {loading && <span className="text-xs text-gray-400">· loading…</span>}</p>
          {!loading && logs.length === 0 && <p className="text-xs text-gray-400">No calls in this range.</p>}
          {logs.map(l => (
            <div key={l.id} className="flex items-start gap-2 border-b border-gray-50 last:border-0 py-1.5">
              <span className={cn('mt-0.5 text-sm', l.success === true ? 'text-green-600' : l.success === false ? 'text-red-500' : 'text-gray-300')}>
                {l.success === true ? '✓' : l.success === false ? '✗' : '•'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <button onClick={() => setPeekPhone(l.customer.phone)} className="text-xs font-medium text-gray-800 truncate underline decoration-dotted underline-offset-2 text-left">
                    {l.customer.is_hot_lead && <span className="text-amber-400" title="Hot lead">★ </span>}
                    {l.customer.name}
                  </button>
                  <span className="text-[10px] text-gray-400 flex-shrink-0">{formatDateTime(l.called_at)}</span>
                </div>
                <p className="text-[11px] text-gray-500">
                  +91 {l.customer.phone}
                  {l.success && (l.topics?.length ?? 0) > 0 && <> · {(l.topics ?? []).map(t => TOPIC_LABEL[t] ?? t).join(', ')}</>}
                  {l.intent && <> · <span className="font-medium">{INTENT_LABEL[l.intent]}</span></>}
                </p>
              </div>
            </div>
          ))}
        </div>
      </main>
      <CustomerPeek phone={peekPhone} onClose={() => setPeekPhone(null)} />
    </div>
  )
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="card p-3 text-center">
      <p className={cn('text-xl font-bold', accent ?? 'text-gray-900')}>{value.toLocaleString('en-IN')}</p>
      <p className="text-[10px] text-gray-400 font-medium">{label}</p>
    </div>
  )
}
