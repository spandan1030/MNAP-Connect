'use client'

import { useEffect, useState, type ReactNode } from 'react'
import CustomerPeek from '@/components/ui/CustomerPeek'
import { shortError } from '@/lib/whatsapp/errors'

// Reusable campaign drill-down: the funnel + per-recipient breakdown for one chat
// campaign, fetched from /api/campaigns/detail. Used in the audience Insights
// sheet (and, later, on the /campaigns page — see INSIGHTS_UNIFICATION_PLAN dedup).
// `sliceActions` renders custom controls under the funnel (e.g. "save readers as
// an audience") so the caller can hang the chat-engagement carry off this view.

export interface CampaignFunnel { sent: number; delivered: number; read: number; replied: number; converted: number; failed: number }
interface FailRow { code: number | null; reason: string | null; count: number }
interface Recipient {
  phone: string; name: string | null; stage: string
  error: string | null; errorCode: number | null
  sentAt: string | null; deliveredAt: string | null; readAt: string | null
}
interface Detail {
  funnel: CampaignFunnel; failureBreakdown: FailRow[]; recipients: Recipient[]; label: string
  isDynamic: boolean; memberCount: number; pending: number
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' })
}
function failLabel(f: FailRow): string {
  if (f.code != null) return shortError(f.code)
  if (f.reason) return f.reason
  return 'Unknown error'
}

const STAGE: Record<string, { label: string; cls: string }> = {
  pending:   { label: 'Pending',   cls: 'bg-white text-gray-500 border-gray-300' },
  failed:    { label: 'Failed',    cls: 'bg-red-100 text-red-700 border-red-200' },
  sent:      { label: 'Sent',      cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  delivered: { label: 'Delivered', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  read:      { label: 'Read',      cls: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  replied:   { label: 'Replied',   cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  converted: { label: 'Converted', cls: 'bg-green-100 text-green-700 border-green-300' },
}

export default function CampaignDetail({
  campaignId, sliceActions,
}: {
  campaignId: string
  sliceActions?: (funnel: CampaignFunnel) => ReactNode
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [peekPhone, setPeekPhone] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoading(true)
    fetch(`/api/campaigns/detail?id=${campaignId}&source=reach`)
      .then(r => r.json())
      .then(d => { if (live) setDetail(d?.error ? null : d) })
      .catch(() => { if (live) setDetail(null) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [campaignId])

  if (loading) return <div className="flex justify-center py-3"><div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
  if (!detail?.funnel) return <p className="text-[11px] text-gray-400 py-2">No delivery data yet.</p>

  return (
    <div className="space-y-3">
      <FunnelBars f={detail.funnel} />
      {sliceActions?.(detail.funnel)}
      {detail.failureBreakdown.length > 0 && (
        <div className="space-y-1">
          {detail.failureBreakdown.map((f, i) => (
            <div key={i} className="flex items-center justify-between text-[11px] text-red-600">
              <span className="truncate">{failLabel(f)}</span>
              <span className="flex-shrink-0 font-semibold">{f.count}</span>
            </div>
          ))}
        </div>
      )}
      {detail.recipients.length > 0 && (
        <RecipientList recipients={detail.recipients} label={detail.label} onPeek={setPeekPhone} />
      )}
      <CustomerPeek phone={peekPhone} onClose={() => setPeekPhone(null)} />
    </div>
  )
}

function FunnelBars({ f }: { f: CampaignFunnel }) {
  const base = Math.max(f.sent, 1)
  const stages = [
    { label: 'Sent',      value: f.sent,      cls: 'bg-gray-400' },
    { label: 'Delivered', value: f.delivered, cls: 'bg-blue-400' },
    { label: 'Read',      value: f.read,      cls: 'bg-indigo-500' },
    { label: 'Replied',   value: f.replied,   cls: 'bg-amber-500' },
    { label: 'Converted', value: f.converted, cls: 'bg-green-600' },
  ]
  return (
    <div className="space-y-1.5">
      {stages.map(s => (
        <div key={s.label} className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500 w-16 flex-shrink-0">{s.label}</span>
          <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full ${s.cls} rounded-full transition-all`} style={{ width: `${Math.round((s.value / base) * 100)}%` }} />
          </div>
          <span className="text-[11px] font-semibold text-gray-700 w-16 text-right flex-shrink-0">
            {s.value.toLocaleString('en-IN')}
            <span className="text-gray-400 font-normal"> · {Math.round((s.value / base) * 100)}%</span>
          </span>
        </div>
      ))}
      {f.failed > 0 && <p className="text-[11px] text-red-600 pt-0.5">{f.failed} failed to send — see below for why.</p>}
      {f.converted > 0 && <p className="text-[11px] text-green-700">{f.converted} purchased within 90 days of this campaign.</p>}
    </div>
  )
}

function RecipientList({ recipients, label, onPeek }: { recipients: Recipient[]; label: string; onPeek: (p: string) => void }) {
  const [filter, setFilter] = useState<string>('all')
  const counts = recipients.reduce<Record<string, number>>((a, r) => { a[r.stage] = (a[r.stage] ?? 0) + 1; return a }, {})
  const shown = filter === 'all' ? recipients : recipients.filter(r => r.stage === filter)

  const chips: Array<{ key: string; label: string }> = [
    { key: 'all', label: `All ${recipients.length}` },
    ...['converted', 'replied', 'read', 'delivered', 'sent', 'failed', 'pending']
      .filter(k => counts[k]).map(k => ({ key: k, label: `${STAGE[k].label} ${counts[k]}` })),
  ]

  function exportCsv() {
    const header = ['Name', 'Phone', 'Stage', 'Error code', 'Error', 'Sent', 'Delivered', 'Read']
    const lines = recipients.map(r => [
      r.name ?? '', r.phone, STAGE[r.stage]?.label ?? r.stage,
      r.errorCode ?? '', r.error ?? '',
      fmtTime(r.sentAt), fmtTime(r.deliveredAt), fmtTime(r.readAt),
    ])
    const csv = [header, ...lines].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `campaign-${label}-${new Date().toISOString().slice(0, 10)}.csv`.replace(/\s+/g, '_')
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Recipients</p>
        <button onClick={exportCsv} className="text-[11px] font-medium text-gray-600 border border-gray-200 bg-white px-2 py-0.5 rounded-full">Export CSV</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map(ch => (
          <button key={ch.key} onClick={() => setFilter(ch.key)}
            className={`text-[11px] px-2 py-1 rounded-full border font-medium ${filter === ch.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}>
            {ch.label}
          </button>
        ))}
      </div>
      <div className="space-y-1 max-h-[45vh] overflow-y-auto">
        {shown.map(r => (
          <div key={r.phone} className="flex items-start gap-2 bg-white border border-gray-100 rounded-lg px-2.5 py-1.5">
            <button onClick={() => onPeek(r.phone)} className="min-w-0 flex-1 text-left">
              <span className="text-xs font-medium text-gray-800 truncate underline decoration-dotted underline-offset-2">{r.name || 'Unknown'}</span>
              <span className="text-[11px] text-gray-400 ml-1.5">+91 {r.phone}</span>
              {r.stage === 'failed'
                ? <span className="block text-[10px] text-red-500 truncate">{r.errorCode != null ? shortError(r.errorCode) : (r.error ?? 'Delivery failed')}</span>
                : <span className="block text-[10px] text-gray-400 truncate">
                    {r.readAt ? `Read ${fmtTime(r.readAt)}` : r.deliveredAt ? `Delivered ${fmtTime(r.deliveredAt)}` : r.sentAt ? `Sent ${fmtTime(r.sentAt)}` : ''}
                  </span>}
            </button>
            <span className={`flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${STAGE[r.stage]?.cls ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
              {STAGE[r.stage]?.label ?? r.stage}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
