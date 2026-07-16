'use client'

import { useEffect, useState } from 'react'
import Navbar from '@/components/ui/Navbar'
import CustomerPeek from '@/components/ui/CustomerPeek'

interface Campaign {
  id: string; source: 'reach' | 'broadcast'; label: string; template: string | null
  total: number; sent: number; failed: number; skippedSuppressed: number; skippedDnc: number; sentAt: string
}
interface Funnel { sent: number; delivered: number; read: number; replied: number; converted: number; failed: number }
interface Recipient { phone: string; name: string | null; stage: string; error: string | null }
interface Detail { funnel: Funnel; recipients: Recipient[] }

// Row status → label + colour. Furthest stage a recipient reached.
const STAGE: Record<string, { label: string; cls: string }> = {
  failed:    { label: 'Failed',    cls: 'bg-red-100 text-red-700 border-red-200' },
  sent:      { label: 'Sent',      cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  delivered: { label: 'Delivered', cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  read:      { label: 'Read',      cls: 'bg-indigo-100 text-indigo-700 border-indigo-200' },
  replied:   { label: 'Replied',   cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  converted: { label: 'Converted', cls: 'bg-green-100 text-green-700 border-green-300' },
}

export default function CampaignsPage() {
  const [rows, setRows] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [peekPhone, setPeekPhone] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/campaigns').then(r => r.json()).then(d => { setRows(d.campaigns ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function toggle(c: Campaign) {
    if (openId === c.id) { setOpenId(null); setDetail(null); return }
    setOpenId(c.id); setDetail(null); setDetailLoading(true)
    try {
      const r = await fetch(`/api/campaigns/detail?id=${c.id}&source=${c.source}`)
      const d = await r.json()
      setDetail({ funnel: d.funnel ?? null, recipients: d.recipients ?? [] })
    } finally { setDetailLoading(false) }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 pt-4 pb-24">
        <h1 className="text-lg font-bold text-gray-900 mb-1">Campaigns</h1>
        <p className="text-xs text-gray-500 mb-4">Every send, with its funnel and every recipient: delivered → read → replied → converted (purchase ≤90 days).</p>

        {loading && <div className="flex justify-center pt-10"><div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>}
        {!loading && rows.length === 0 && <p className="text-sm text-gray-400 text-center py-10">No campaigns yet. Send from Reach and they show here.</p>}

        <div className="space-y-2">
          {rows.map(c => (
            <div key={c.id} className="card overflow-hidden">
              <button onClick={() => toggle(c)} className="w-full text-left p-4 active:bg-gray-50">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-semibold text-gray-900 text-sm truncate">{c.label}</p>
                      {c.source === 'broadcast' && <span className="text-[10px] text-gray-500 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded-full flex-shrink-0">legacy</span>}
                    </div>
                    {c.template && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{c.template}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-green-700">{c.sent.toLocaleString('en-IN')}</p>
                    <p className="text-[10px] text-gray-400">sent</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-400">
                  <span>{new Date(c.sentAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                  {c.failed > 0 && <span className="text-red-500">· {c.failed} failed</span>}
                  {c.skippedSuppressed > 0 && <span>· {c.skippedSuppressed} suppressed</span>}
                  {c.skippedDnc > 0 && <span>· {c.skippedDnc} opted-out</span>}
                </div>
              </button>

              {openId === c.id && (
                <div className="border-t border-gray-100 p-4 bg-gray-50 space-y-4">
                  {detailLoading && <div className="flex justify-center py-3"><div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>}
                  {detail?.funnel && <FunnelBars f={detail.funnel} />}
                  {detail && detail.recipients.length > 0 && (
                    <RecipientList recipients={detail.recipients} onPeek={setPeekPhone} />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </main>

      <CustomerPeek phone={peekPhone} onClose={() => setPeekPhone(null)} />
    </div>
  )
}

function FunnelBars({ f }: { f: Funnel }) {
  const base = Math.max(f.sent, 1)
  const stages: Array<{ label: string; value: number; cls: string }> = [
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
      {f.failed > 0 && <p className="text-[11px] text-red-600 pt-0.5">{f.failed} failed to send — see the list below for why.</p>}
      {f.converted > 0 && <p className="text-[11px] text-green-700">{f.converted} purchased within 90 days of this campaign.</p>}
    </div>
  )
}

// Per-recipient list with a filter, so you can jump straight to failures /
// replies / conversions. Tap a name to open the full customer profile.
function RecipientList({ recipients, onPeek }: { recipients: Recipient[]; onPeek: (p: string) => void }) {
  const [filter, setFilter] = useState<string>('all')
  const counts = recipients.reduce<Record<string, number>>((a, r) => { a[r.stage] = (a[r.stage] ?? 0) + 1; return a }, {})
  const shown = filter === 'all' ? recipients : recipients.filter(r => r.stage === filter)

  const chips: Array<{ key: string; label: string }> = [
    { key: 'all', label: `All ${recipients.length}` },
    ...['converted', 'replied', 'read', 'delivered', 'sent', 'failed']
      .filter(k => counts[k]).map(k => ({ key: k, label: `${STAGE[k].label} ${counts[k]}` })),
  ]

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Recipients</p>
      <div className="flex flex-wrap gap-1.5">
        {chips.map(ch => (
          <button key={ch.key} onClick={() => setFilter(ch.key)}
            className={`text-[11px] px-2 py-1 rounded-full border font-medium ${filter === ch.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}>
            {ch.label}
          </button>
        ))}
      </div>
      <div className="space-y-1 max-h-[50vh] overflow-y-auto">
        {shown.map(r => (
          <div key={r.phone} className="flex items-center gap-2 bg-white border border-gray-100 rounded-lg px-2.5 py-1.5">
            <button onClick={() => onPeek(r.phone)} className="min-w-0 flex-1 text-left">
              <span className="text-xs font-medium text-gray-800 truncate underline decoration-dotted underline-offset-2">{r.name || 'Unknown'}</span>
              <span className="text-[11px] text-gray-400 ml-1.5">+91 {r.phone}</span>
              {r.stage === 'failed' && r.error && <span className="block text-[10px] text-red-500 truncate">{r.error}</span>}
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
