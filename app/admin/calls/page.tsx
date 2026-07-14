'use client'

import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import Navbar from '@/components/ui/Navbar'
import { createClient } from '@/lib/supabase/client'
import { RECENCY_TIERS, VALUE_TIERS } from '@/lib/calls'
import { formatDateTime, cn } from '@/lib/utils'
import type { CallFilter, WaBCallCampaign } from '@/lib/types'

const BATCH = 300

export default function CallControlPage() {
  const supabase = createClient()

  // ── Import ──
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [importResult, setImportResult] = useState<string>('')

  // ── Campaign builder ──
  const [recency, setRecency] = useState<string[]>(['Lapsed'])
  const [value, setValue] = useState<string[]>([])
  const [highValue, setHighValue] = useState(true)
  const [wedding, setWedding] = useState(false)
  const [name, setName] = useState('')
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const [campaigns, setCampaigns] = useState<WaBCallCampaign[]>([])

  useEffect(() => { loadCampaigns() }, [])

  async function loadCampaigns() {
    const { data } = await supabase
      .from('wa_b_call_campaigns')
      .select('*')
      .order('created_at', { ascending: false })
    setCampaigns((data as WaBCallCampaign[]) ?? [])
  }

  function currentFilter(): CallFilter {
    return {
      recency_tier: recency.length ? recency : undefined,
      value_tier: value.length ? value : undefined,
      is_high_value: highValue || undefined,
      is_likely_wedding: wedding || undefined,
    }
  }

  function toggle(list: string[], set: (v: string[]) => void, item: string) {
    set(list.includes(item) ? list.filter(x => x !== item) : [...list, item])
    setPreviewCount(null)
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setImportResult('')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const parsed = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '', raw: false })
    setRows(parsed)
  }

  async function handleImport() {
    if (rows.length === 0) return
    setImporting(true); setProgress(0); setImportResult('')
    const label = `${fileName} @ ${new Date().toISOString()}`
    let customers = 0, markers = 0
    try {
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH)
        const res = await fetch('/api/calls/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunk, batch: label }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Import failed')
        customers += json.customers ?? 0
        markers += json.markers ?? 0
        setProgress(Math.min(i + BATCH, rows.length))
      }
      setImportResult(`Imported ${markers} markers across ${customers} customers.`)
    } catch (err) {
      setImportResult(`Error: ${(err as Error).message}`)
    } finally {
      setImporting(false)
    }
  }

  async function handlePreview() {
    setBusy(true); setMsg('')
    const res = await fetch('/api/calls/campaign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preview: true, filter: currentFilter() }),
    })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) { setMsg(`Error: ${json.error}`); return }
    setPreviewCount(json.count)
  }

  async function handleCreate() {
    if (!name.trim()) { setMsg('Enter a campaign name'); return }
    setBusy(true); setMsg('')
    const res = await fetch('/api/calls/campaign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), filter: currentFilter() }),
    })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) { setMsg(`Error: ${json.error}`); return }
    setMsg(`Created "${name.trim()}" with ${json.taskCount} cards.`)
    setName(''); setPreviewCount(null)
    loadCampaigns()
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-xl mx-auto w-full px-4 py-4 space-y-4 pb-24">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Call Control</h1>
          <a href="/admin/calls/report" className="text-xs font-medium text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg">Reporting →</a>
        </div>

        {/* ── Import DB ── */}
        <section className="card p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-gray-700">1. Import customer database</p>
            <p className="text-xs text-gray-500">Upload <code>leads_import.csv</code> from the signals pipeline. Re-uploading refreshes markers in place.</p>
          </div>
          <input
            type="file" accept=".csv"
            onChange={handleFile}
            className="block w-full text-xs text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-green-50 file:text-green-700 file:text-xs file:font-medium"
          />
          {rows.length > 0 && (
            <div className="text-xs text-gray-600">
              <p><span className="font-medium">{rows.length.toLocaleString('en-IN')}</span> rows parsed from {fileName}</p>
              <button onClick={handleImport} disabled={importing} className="btn-primary mt-2 w-full py-2">
                {importing ? `Importing… ${progress.toLocaleString('en-IN')}/${rows.length.toLocaleString('en-IN')}` : 'Import to database'}
              </button>
              {importing && (
                <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 transition-all" style={{ width: `${(progress / rows.length) * 100}%` }} />
                </div>
              )}
            </div>
          )}
          {importResult && <p className="text-xs font-medium text-gray-700 border-t border-gray-100 pt-2">{importResult}</p>}
        </section>

        {/* ── Build campaign ── */}
        <section className="card p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-gray-700">2. Create a call campaign</p>
            <p className="text-xs text-gray-500">Filter the database — only matching cards show to the caller. Do-not-call customers are always excluded.</p>
          </div>

          <div>
            <p className="text-[11px] text-gray-400 font-medium mb-1">Recency tier</p>
            <div className="flex flex-wrap gap-1.5">
              {RECENCY_TIERS.map(t => (
                <button key={t} onClick={() => toggle(recency, setRecency, t)}
                  className={cn('px-3 py-1 rounded-lg text-xs border font-medium',
                    recency.includes(t) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200')}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] text-gray-400 font-medium mb-1">Value tier</p>
            <div className="flex flex-wrap gap-1.5">
              {VALUE_TIERS.map(t => (
                <button key={t} onClick={() => toggle(value, setValue, t)}
                  className={cn('px-3 py-1 rounded-lg text-xs border font-medium',
                    value.includes(t) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200')}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={highValue} onChange={e => { setHighValue(e.target.checked); setPreviewCount(null) }} />
              High-value only
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={wedding} onChange={e => { setWedding(e.target.checked); setPreviewCount(null) }} />
              Likely-wedding only
            </label>
          </div>

          <div className="flex items-center gap-2 border-t border-gray-100 pt-3">
            <button onClick={handlePreview} disabled={busy}
              className="text-xs font-medium text-gray-700 border border-gray-200 px-3 py-2 rounded-lg">
              Preview count
            </button>
            {previewCount !== null && (
              <span className="text-xs text-gray-600"><span className="font-bold text-gray-900">{previewCount.toLocaleString('en-IN')}</span> customers match</span>
            )}
          </div>

          <input className="input" placeholder="Campaign name (e.g. Lapsed VIP Winback — Jul 2026)"
            value={name} onChange={e => setName(e.target.value)} />
          <button onClick={handleCreate} disabled={busy} className="btn-primary w-full py-2">
            {busy ? 'Working…' : 'Create campaign & generate cards'}
          </button>
          {msg && <p className="text-xs font-medium text-gray-700">{msg}</p>}
        </section>

        {/* ── Campaigns ── */}
        <section className="card p-4 space-y-2">
          <p className="text-sm font-semibold text-gray-700">Campaigns</p>
          {campaigns.length === 0 && <p className="text-xs text-gray-400">None yet.</p>}
          {campaigns.map(c => (
            <div key={c.id} className="flex items-center justify-between border-b border-gray-100 last:border-0 py-1.5">
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-800 truncate">{c.name}</p>
                <p className="text-[10px] text-gray-400">{formatDateTime(c.created_at)}</p>
              </div>
              {c.is_active
                ? <span className="text-[10px] text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full font-medium">Live</span>
                : <span className="text-[10px] text-gray-400">inactive</span>}
            </div>
          ))}
        </section>
      </main>
    </div>
  )
}
