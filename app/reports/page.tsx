'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { describeError, shortError } from '@/lib/whatsapp/errors'
import type { WaBroadcast } from '@/lib/types'

interface Recipient {
  id: string
  status: string
  error_code: number | null
  error_title: string | null
  failed_reason: string | null
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
  created_at: string
  name: string
  phone: string
}

const STATUS_STYLE: Record<string, string> = {
  read:      'bg-blue-100 text-blue-700',
  delivered: 'bg-green-100 text-green-700',
  sent:      'bg-gray-100 text-gray-600',
  queued:    'bg-gray-100 text-gray-500',
  failed:    'bg-red-100 text-red-700',
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

export default function ReportsPage() {
  const supabase = createClient()
  const [broadcasts, setBroadcasts] = useState<WaBroadcast[]>([])
  const [loadingList, setLoadingList] = useState(true)
  const [selected, setSelected] = useState<WaBroadcast | null>(null)
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [loadingDetail, setLoadingDetail] = useState(false)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase
        .from('wa_broadcasts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      setBroadcasts((data as WaBroadcast[]) ?? [])
      setLoadingList(false)
    })()
  }, [supabase])

  const openBroadcast = useCallback(async (b: WaBroadcast) => {
    setSelected(b)
    setLoadingDetail(true)
    setRecipients([])
    const { data } = await supabase
      .from('wa_messages')
      .select('id, status, error_code, error_title, failed_reason, sent_at, delivered_at, read_at, created_at, wa_threads(customer_name, phone)')
      .eq('broadcast_id', b.id)
      .order('created_at', { ascending: true })

    const rows: Recipient[] = (data ?? []).map((m: Record<string, unknown>) => {
      const thread = m.wa_threads as { customer_name?: string; phone?: string } | null
      return {
        id: m.id as string,
        status: m.status as string,
        error_code: (m.error_code as number) ?? null,
        error_title: (m.error_title as string) ?? null,
        failed_reason: (m.failed_reason as string) ?? null,
        sent_at: (m.sent_at as string) ?? null,
        delivered_at: (m.delivered_at as string) ?? null,
        read_at: (m.read_at as string) ?? null,
        created_at: m.created_at as string,
        name: thread?.customer_name ?? '—',
        phone: thread?.phone ?? '—',
      }
    })
    setRecipients(rows)
    setLoadingDetail(false)
  }, [supabase])

  // --- Summary tallies for the selected broadcast ---
  const counts = recipients.reduce(
    (acc, r) => {
      acc.total++
      if (r.status === 'read') acc.read++
      else if (r.status === 'delivered') acc.delivered++
      else if (r.status === 'failed') acc.failed++
      else acc.sent++
      return acc
    },
    { total: 0, read: 0, delivered: 0, failed: 0, sent: 0 }
  )

  // Failures grouped by error code.
  const failureBreakdown = Object.entries(
    recipients
      .filter(r => r.status === 'failed')
      .reduce((acc, r) => {
        const key = r.error_code != null ? String(r.error_code) : 'unknown'
        acc[key] = (acc[key] ?? 0) + 1
        return acc
      }, {} as Record<string, number>)
  ).sort((a, b) => b[1] - a[1])

  function exportCsv() {
    if (!selected) return
    const header = ['Name', 'Phone', 'Status', 'Error code', 'Error', 'Sent', 'Delivered', 'Read']
    const lines = recipients.map(r => [
      r.name,
      r.phone,
      r.status,
      r.error_code ?? '',
      r.status === 'failed' ? describeError(r.error_code).title : '',
      fmtTime(r.sent_at ?? r.created_at),
      fmtTime(r.delivered_at),
      fmtTime(r.read_at),
    ])
    const csv = [header, ...lines]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const stamp = new Date(selected.created_at).toISOString().slice(0, 10)
    a.download = `broadcast-${selected.template_name ?? 'report'}-${stamp}.csv`.replace(/\s+/g, '_')
    a.click()
    URL.revokeObjectURL(url)
  }

  // ---------------------------------------------------------------------------
  // Detail view
  // ---------------------------------------------------------------------------
  if (selected) {
    return (
      <div className="max-w-2xl mx-auto px-3 py-3 pb-24">
        <button
          onClick={() => setSelected(null)}
          className="text-sm text-green-600 font-medium mb-3 flex items-center gap-1"
        >
          ← All broadcasts
        </button>

        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
          <h1 className="font-semibold text-gray-900">{selected.template_name ?? 'Broadcast'}</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {selected.topic_name ? `${selected.topic_name} · ` : ''}{fmtTime(selected.created_at)}
          </p>

          {/* Summary bar */}
          <div className="grid grid-cols-4 gap-2 mt-3 text-center">
            {[
              { label: 'Sent', value: counts.total, cls: 'text-gray-900' },
              { label: 'Delivered', value: counts.delivered + counts.read, cls: 'text-green-600' },
              { label: 'Read', value: counts.read, cls: 'text-blue-600' },
              { label: 'Failed', value: counts.failed, cls: 'text-red-600' },
            ].map(s => (
              <div key={s.label} className="bg-gray-50 rounded-lg py-2">
                <div className={`text-lg font-bold ${s.cls}`}>{s.value}</div>
                <div className="text-[10px] text-gray-500 uppercase tracking-wide">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Failure breakdown by code */}
          {failureBreakdown.length > 0 && (
            <div className="mt-3 space-y-1">
              {failureBreakdown.map(([code, n]) => (
                <div key={code} className="flex items-center justify-between text-xs bg-red-50 rounded-lg px-3 py-1.5">
                  <span className="text-red-700">
                    {code === 'unknown' ? 'Unknown error' : shortError(Number(code))}
                  </span>
                  <span className="font-semibold text-red-700">{n}</span>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={exportCsv}
            disabled={recipients.length === 0}
            className="mt-3 w-full bg-gray-900 text-white text-sm font-medium rounded-lg py-2 disabled:opacity-40"
          >
            Export CSV
          </button>
        </div>

        {/* Recipient list */}
        {loadingDetail ? (
          <p className="text-center text-gray-400 text-sm py-8">Loading…</p>
        ) : (
          <div className="space-y-1.5">
            {recipients.map(r => (
              <div key={r.id} className="bg-white rounded-lg border border-gray-100 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{r.name}</p>
                    <p className="text-[11px] text-gray-400">+91 {r.phone}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_STYLE[r.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {r.status}
                  </span>
                </div>
                {r.status === 'failed' && (
                  <p className="text-[11px] text-red-500 mt-1">
                    {r.error_code ? shortError(r.error_code) : (r.failed_reason ?? 'Delivery failed')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // List view
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-2xl mx-auto px-3 py-3 pb-24">
      <h1 className="font-semibold text-gray-900 text-lg mb-3">Broadcast Reports</h1>

      {loadingList ? (
        <p className="text-center text-gray-400 text-sm py-8">Loading…</p>
      ) : broadcasts.length === 0 ? (
        <p className="text-center text-gray-400 text-sm py-8">
          No broadcasts yet. Send a template from the Send tab to see reports here.
        </p>
      ) : (
        <div className="space-y-2">
          {broadcasts.map(b => (
            <button
              key={b.id}
              onClick={() => openBroadcast(b)}
              className="w-full text-left bg-white rounded-xl border border-gray-200 p-3.5 active:bg-gray-50"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-gray-900 text-sm truncate">{b.template_name ?? 'Broadcast'}</p>
                <span className="text-[11px] text-gray-400 flex-shrink-0">{fmtTime(b.created_at)}</span>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-xs">
                <span className="text-gray-500">{b.total} sent</span>
                {b.failed > 0 && <span className="text-red-500">{b.failed} failed</span>}
                {b.topic_name && <span className="text-gray-400 truncate">· {b.topic_name}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
