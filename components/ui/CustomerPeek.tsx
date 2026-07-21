'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { INTEREST_LABEL } from '@/lib/signals'
import { INTENT_LABEL, TOPIC_LABEL } from '@/lib/calls'

// Universal customer peek: tap any phone number anywhere → who is this?
// Brand-new or known, markers, first/last purchase, interests, call + message
// history. Render once per page: <CustomerPeek phone={peekPhone} onClose={...} />.

interface PeekData {
  phone: string
  known: boolean
  isNew: boolean
  name: string | null
  source: string | null
  flags: { is_hot_lead: boolean; is_opted_out: boolean }
  markers: {
    recency_tier: string | null; value_tier: string | null; rfm_segment: string | null
    frequency_tier: string | null; primary_metal: string | null; lifetime_value: number | null
    total_bills: number | null; days_since_last_purchase: number | null
    first_purchase_date: string | null; last_purchase_date: string | null
    audience_labels: string[] | null; is_high_value: boolean | null; is_likely_wedding: boolean | null
  } | null
  walkin: { salesman: string | null; at: string | null; converted: boolean } | null
  visits: Array<{ at: string; timing: string | null; note: string | null; interests: string[]; isBackfill: boolean; salesman: string | null }>
  audiences: Array<{ id: string; name: string; is_dynamic: boolean }>
  interests: Record<string, string[]>
  calls: Array<{ success: boolean | null; topics: string[] | null; intent: string | null; called_at: string }>
  sends: Array<{ label: string; category: string | null; status: string; cohort: string | null; sentAt: string; inCampaign: boolean }>
}

const SOURCE_DOT: Record<string, string> = {
  sales: 'bg-amber-400', whatsapp: 'bg-green-500', call: 'bg-blue-500', billing: 'bg-purple-500', walkin: 'bg-pink-500',
}

// Message-type labels for the "Messages sent" history. Keys must match the
// template category slugs (see admin/templates) — daily_rate/rate/offer/…,
// not daily/oneoff, or the chip falls back to printing the raw slug.
const CATEGORY_LABEL: Record<string, string> = {
  daily_rate: 'Daily rate', rate: 'Rate alert', offer: 'Offer', thankyou: 'Thank-you', custom: 'Custom',
}

// Walk-in timing buckets (see walk-in enrollment) — how soon they said they'd buy.
const TIMING_LABEL: Record<string, string> = {
  within_7d: 'within 7 days', within_1m: 'within a month', '1_3m': '1–3 months',
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtDateTime(s: string): string {
  const d = new Date(s)
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

export default function CustomerPeek({ phone, onClose }: { phone: string | null; onClose: () => void }) {
  const router = useRouter()
  const [data, setData] = useState<PeekData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCalls, setShowCalls] = useState(false)  // call log is opt-in (collapsed by default)

  useEffect(() => { setShowCalls(false) }, [phone])

  useEffect(() => {
    if (!phone) { setData(null); setError(null); return }
    setLoading(true); setError(null); setData(null)
    fetch(`/api/customer/peek?phone=${encodeURIComponent(phone)}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d) })
      .catch(() => setError('Could not load'))
      .finally(() => setLoading(false))
  }, [phone])

  if (!phone) return null
  const m = data?.markers

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-t-2xl flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
        <div className="flex-shrink-0 px-5 pt-4 pb-3 border-b border-gray-100">
          <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-3" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-gray-900 truncate">{data?.name || (loading ? 'Loading…' : 'Unknown')}</p>
                {data?.flags.is_hot_lead && <span className="text-amber-400" title="Hot lead">★</span>}
                {data?.isNew && <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">NEW — not in DB</span>}
                {data?.flags.is_opted_out && <span className="text-[10px] font-bold text-gray-600 bg-gray-100 border border-gray-200 px-1.5 py-0.5 rounded-full">Opted out (all comms)</span>}
              </div>
              <a href={`tel:+91${phone}`} className="text-xs text-gray-500">+91 {phone}</a>
            </div>
            <button onClick={onClose} className="text-gray-400 text-xl leading-none flex-shrink-0">×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          {loading && <p className="text-sm text-gray-400 text-center py-6">Loading…</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}

          {data && !loading && (
            <>
              {/* Purchase history */}
              {m && (m.first_purchase_date || m.last_purchase_date || m.lifetime_value != null) ? (
                <Section title="Purchase history">
                  <div className="grid grid-cols-2 gap-2">
                    <KV k="First purchase" v={fmtDate(m.first_purchase_date)} />
                    <KV k="Last purchase" v={fmtDate(m.last_purchase_date)} />
                    <KV k="Lifetime value" v={m.lifetime_value != null ? `₹${Math.round(m.lifetime_value).toLocaleString('en-IN')}` : '—'} />
                    <KV k="Bills" v={m.total_bills != null ? String(m.total_bills) : '—'} />
                  </div>
                </Section>
              ) : (
                <p className="text-xs text-gray-400">No purchase history on file{data.isNew ? ' — brand-new contact.' : '.'}</p>
              )}

              {/* Markers */}
              {m && (
                <Section title="Markers">
                  <div className="flex flex-wrap gap-1.5">
                    {m.recency_tier && <Tag>{m.recency_tier}</Tag>}
                    {m.value_tier && <Tag>{m.value_tier}</Tag>}
                    {m.rfm_segment && <Tag>{m.rfm_segment}</Tag>}
                    {m.frequency_tier && <Tag>{m.frequency_tier}</Tag>}
                    {m.primary_metal && <Tag>{m.primary_metal}</Tag>}
                    {m.is_high_value && <Tag>High value</Tag>}
                    {m.is_likely_wedding && <Tag>Wedding</Tag>}
                    {(m.audience_labels ?? []).map(l => <Tag key={l}>{l}</Tag>)}
                  </div>
                </Section>
              )}

              {/* Audiences this person currently belongs to. */}
              {data.audiences.length > 0 && (
                <Section title="In audiences">
                  <div className="flex flex-wrap gap-1.5">
                    {data.audiences.map(a => (
                      <span key={a.id} className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded-full">
                        {a.name}{a.is_dynamic ? ' ·live' : ''}
                      </span>
                    ))}
                  </div>
                </Section>
              )}

              {/* Signals — separated by where they came from. Chat & calls are
                  interest signals; sales are things already bought (not interest). */}
              <InterestSection title="Interested in — from WhatsApp chat" dot="bg-green-500" keys={data.interests.whatsapp} />
              <InterestSection title="Interested in — from calls" dot="bg-blue-500" keys={data.interests.call} />
              <InterestSection title="Interested in — from walk-in" dot="bg-pink-500" keys={data.interests.walkin} />
              {data.walkin && (data.walkin.salesman || data.walkin.at) && (
                <div className="flex items-center gap-1.5 flex-wrap -mt-1">
                  {data.walkin.salesman && <span className="text-[10px] bg-pink-50 text-pink-700 border border-pink-200 px-1.5 py-0.5 rounded-full">Enrolled by {data.walkin.salesman}</span>}
                  {data.walkin.at && <span className="text-[10px] text-gray-400">{fmtDate(data.walkin.at)}</span>}
                  {data.walkin.converted
                    ? <span className="text-[10px] font-semibold bg-green-50 text-green-700 border border-green-200 px-1.5 py-0.5 rounded-full">Converted ✓</span>
                    : <span className="text-[10px] text-gray-400">not yet converted</span>}
                </div>
              )}

              {/* Full store-visit history — one row per visit (wa_050). A single
                  "reconstructed" row means the log only has the latest visit for
                  this person (visits before 19 Jul 2026 weren't kept). */}
              {data.visits.length > 0 && (
                <Section title={`Store visits (${data.visits.length})`}>
                  <div className="space-y-1">
                    {data.visits.map((v, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-pink-500 flex-shrink-0" />
                        <span className="text-gray-500 w-24 flex-shrink-0">{fmtDate(v.at)}</span>
                        <span className="text-gray-700 truncate flex items-center gap-1 flex-wrap">
                          {v.salesman && <Tag>{v.salesman}</Tag>}
                          {v.timing && <span className="text-gray-400">{TIMING_LABEL[v.timing] ?? v.timing}</span>}
                          {v.interests.length > 0 && <span className="text-gray-500 truncate">{v.interests.map(k => INTEREST_LABEL[k] ?? k).join(', ')}</span>}
                          {v.isBackfill && <span className="text-[9px] text-gray-400 italic">reconstructed</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
              <InterestSection title="Bought before — from sales" dot="bg-amber-400" keys={data.interests.sales} />
              <InterestSection title="Tagged at billing" dot="bg-purple-500" keys={data.interests.billing} />

              {/* Call log — outcome + signals of each call. Opt-in (collapsed). */}
              {data.calls.length > 0 && (
                <Section title={`Call log (${data.calls.length})`}
                  action={<button onClick={() => setShowCalls(s => !s)} className="text-[11px] font-medium text-green-700">{showCalls ? 'Hide' : 'View'}</button>}>
                  {showCalls && (
                    <div className="space-y-1">
                      {data.calls.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className={c.success === true ? 'text-green-600' : c.success === false ? 'text-red-500' : 'text-gray-300'}>
                            {c.success === true ? '✓' : c.success === false ? '✗' : '•'}
                          </span>
                          <span className="text-gray-400 w-20 flex-shrink-0">{fmtDateTime(c.called_at)}</span>
                          <span className="text-gray-700 truncate">
                            {c.intent ? INTENT_LABEL[c.intent] : ''}
                            {c.topics?.length ? ` · ${c.topics.map(t => TOPIC_LABEL[t] ?? t).join(', ')}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {/* Message history — which category messages went out, in what campaign. */}
              <Section title={`Messages sent (${data.sends.length})`}>
                {data.sends.length === 0 ? (
                  <p className="text-xs text-gray-400">No WhatsApp messages sent yet.</p>
                ) : (
                  <div className="space-y-1">
                    {data.sends.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className={s.status === 'sent' ? 'text-green-600' : 'text-gray-300'}>
                          {s.status === 'sent' ? '✓' : s.status === 'failed' ? '✗' : '•'}
                        </span>
                        <span className="text-gray-400 w-20 flex-shrink-0">{fmtDateTime(s.sentAt)}</span>
                        <span className="text-gray-700 truncate flex items-center gap-1">
                          {s.category && <Tag>{CATEGORY_LABEL[s.category] ?? s.category}</Tag>}
                          <span className="truncate">
                            {s.label}
                            {s.inCampaign && s.cohort
                              ? ` · ${s.cohort}`
                              : <span className="text-gray-400"> · outside campaign</span>}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </>
          )}
        </div>
        <div className="flex-shrink-0 px-5 py-3 border-t border-gray-100">
          <button onClick={() => { onClose(); router.push(`/messages/${phone}`) }}
            className="btn-secondary w-full text-center block">Open chat — see messages shared</button>
        </div>
      </div>
    </div>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{title}</p>
        {action}
      </div>
      {children}
    </div>
  )
}
// One interest section, source-scoped. Renders nothing if there are no signals.
function InterestSection({ title, dot, keys }: { title: string; dot: string; keys?: string[] }) {
  const uniq = [...new Set(keys ?? [])]
  if (uniq.length === 0) return null
  return (
    <Section title={title}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`w-1.5 h-1.5 rounded-full ${dot} flex-shrink-0`} />
        {uniq.map(k => <Tag key={k}>{INTEREST_LABEL[k] ?? k}</Tag>)}
      </div>
    </Section>
  )
}
function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-2.5 py-1.5">
      <p className="text-[10px] text-gray-400">{k}</p>
      <p className="text-xs font-semibold text-gray-800">{v}</p>
    </div>
  )
}
function Tag({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded-full">{children}</span>
}
