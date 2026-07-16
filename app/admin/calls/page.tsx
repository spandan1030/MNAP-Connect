'use client'

import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import Navbar from '@/components/ui/Navbar'
import { createClient } from '@/lib/supabase/client'
import { RECENCY_TIERS, VALUE_TIERS, RFM_SEGMENTS, FREQUENCY_TIERS, PRIMARY_METALS } from '@/lib/calls'
import { INTERESTS } from '@/lib/signals'
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
  const [rfm, setRfm] = useState<string[]>([])
  const [frequency, setFrequency] = useState<string[]>([])
  const [metal, setMetal] = useState<string[]>([])
  const [interests, setInterests] = useState<string[]>([])
  const [highValue, setHighValue] = useState(true)
  const [wedding, setWedding] = useState(false)
  const [lookalike, setLookalike] = useState(false)
  const [minLtv, setMinLtv] = useState('')
  const [minBills, setMinBills] = useState('')
  const [maxDays, setMaxDays] = useState('')
  const [name, setName] = useState('')
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const [campaigns, setCampaigns] = useState<WaBCallCampaign[]>([])
  const [dbCount, setDbCount] = useState<number | null>(null)

  // ── Converge interest signals ──
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  useEffect(() => { loadCampaigns(); loadDbCount() }, [])

  async function loadCampaigns() {
    const { data } = await supabase
      .from('wa_b_call_campaigns')
      .select('*')
      .order('created_at', { ascending: false })
    setCampaigns((data as WaBCallCampaign[]) ?? [])
  }

  async function loadDbCount() {
    const { count } = await supabase
      .from('wa_b_markers')
      .select('customer_id', { count: 'exact', head: true })
    setDbCount(count ?? 0)
  }

  function currentFilter(): CallFilter {
    const posInt = (s: string) => { const n = Number(s); return s.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : undefined }
    return {
      recency_tier: recency.length ? recency : undefined,
      value_tier: value.length ? value : undefined,
      rfm_segment: rfm.length ? rfm : undefined,
      frequency_tier: frequency.length ? frequency : undefined,
      primary_metal: metal.length ? metal : undefined,
      interests: interests.length ? interests : undefined,
      is_high_value: highValue || undefined,
      is_likely_wedding: wedding || undefined,
      is_lookalike_seed: lookalike || undefined,
      min_lifetime_value: posInt(minLtv),
      min_total_bills: posInt(minBills),
      max_days_since_last_purchase: posInt(maxDays),
    }
  }

  function toggle(list: string[], set: (v: string[]) => void, item: string) {
    set(list.includes(item) ? list.filter(x => x !== item) : [...list, item])
    setPreviewCount(null)
  }

  function chipGroup(label: string, options: readonly string[], sel: string[], setSel: (v: string[]) => void) {
    return (
      <div>
        <p className="text-[11px] text-gray-400 font-medium mb-1">{label}</p>
        <div className="flex flex-wrap gap-1.5">
          {options.map(t => (
            <button key={t} onClick={() => toggle(sel, setSel, t)}
              className={cn('px-3 py-1 rounded-lg text-xs border font-medium capitalize',
                sel.includes(t) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200')}>
              {t}
            </button>
          ))}
        </div>
      </div>
    )
  }

  function numField(label: string, val: string, setter: (v: string) => void, placeholder: string) {
    return (
      <div className="flex-1 min-w-[140px]">
        <p className="text-[11px] text-gray-400 font-medium mb-1">{label}</p>
        <input type="number" min={0} inputMode="numeric" className="input py-1.5 text-xs" placeholder={placeholder}
          value={val} onChange={e => { setter(e.target.value); setPreviewCount(null) }} />
      </div>
    )
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setImportResult('')
    const buf = await file.arrayBuffer()
    // cellDates + dateNF forces every date cell to ISO (yyyy-mm-dd) regardless of
    // the machine's locale. Without this, SheetJS reformats 2022-06-04 -> "6/4/22",
    // which the server's YYYY-MM-DD guard rejects, silently nulling the purchase
    // dates for the whole import.
    const wb = XLSX.read(buf, { type: 'array', cellDates: true, dateNF: 'yyyy-mm-dd' })
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
      loadDbCount()
    } catch (err) {
      setImportResult(`Error: ${(err as Error).message}`)
    } finally {
      setImporting(false)
    }
  }

  async function handleSync() {
    setSyncing(true); setSyncMsg('')
    try {
      const res = await fetch('/api/signals/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      })
      const json = await res.json()
      setSyncMsg(res.ok
        ? `Converged ${(json.written ?? 0).toLocaleString('en-IN')} interest signals from ${(json.sources ?? []).join(', ')}.`
        : `Error: ${json.error}`)
    } catch (err) {
      setSyncMsg(`Error: ${(err as Error).message}`)
    } finally {
      setSyncing(false)
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

        {/* ── Salesmen ── */}
        <SalesmenRoster supabase={supabase} />

        {/* ── Import DB ── */}
        <section className="card p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-gray-700">Refresh database <span className="font-normal text-gray-400">(optional)</span></p>
            <p className="text-xs text-gray-500">
              {dbCount != null
                ? <><span className="font-medium text-gray-700">{dbCount.toLocaleString('en-IN')}</span> customers already loaded — you can build a campaign below without uploading anything. </>
                : 'Loads the customer base used by every campaign. '}
              Only upload a new <code>leads_import.csv</code> when you have a fresh export from the signals pipeline; re-uploading refreshes markers in place and adds any new numbers.
            </p>
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
            <p className="text-sm font-semibold text-gray-700">Create a call campaign</p>
            <p className="text-xs text-gray-500">Filters run against the customer base already in the database — no upload needed. Only matching cards show to the caller; do-not-call customers are always excluded.</p>
          </div>

          {chipGroup('Recency tier', RECENCY_TIERS, recency, setRecency)}
          {chipGroup('Value tier', VALUE_TIERS, value, setValue)}
          {chipGroup('RFM segment', RFM_SEGMENTS, rfm, setRfm)}
          {chipGroup('Frequency tier', FREQUENCY_TIERS, frequency, setFrequency)}
          {chipGroup('Primary metal', PRIMARY_METALS, metal, setMetal)}

          <div>
            <p className="text-[11px] text-gray-400 font-medium mb-1">Interests <span className="text-gray-300">· chat · call · sales</span></p>
            <div className="flex flex-wrap gap-1.5">
              {INTERESTS.map(i => (
                <button key={i.key} onClick={() => toggle(interests, setInterests, i.key)}
                  className={cn('px-3 py-1 rounded-lg text-xs border font-medium',
                    interests.includes(i.key) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-200')}>
                  {i.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            {numField('Min lifetime value (₹)', minLtv, setMinLtv, 'e.g. 50000')}
            {numField('Min total bills', minBills, setMinBills, 'e.g. 2')}
            {numField('Max days since purchase', maxDays, setMaxDays, 'e.g. 1095')}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={highValue} onChange={e => { setHighValue(e.target.checked); setPreviewCount(null) }} />
              High-value only
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={wedding} onChange={e => { setWedding(e.target.checked); setPreviewCount(null) }} />
              Likely-wedding only
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input type="checkbox" checked={lookalike} onChange={e => { setLookalike(e.target.checked); setPreviewCount(null) }} />
              Lookalike seed only
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

        {/* ── Converge interest signals ── */}
        <section className="card p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-gray-700">Interest signals</p>
            <p className="text-xs text-gray-500">
              Merge WhatsApp chat tags, cold-call topics, and sales-DB affinity into one
              phone-keyed interest layer shown on every calling card. Sales &amp; call signals
              update automatically; run this to backfill and pull in WhatsApp chats.
            </p>
          </div>
          <button onClick={handleSync} disabled={syncing} className="btn-primary w-full py-2">
            {syncing ? 'Converging…' : 'Sync interest signals'}
          </button>
          {syncMsg && <p className="text-xs font-medium text-gray-700">{syncMsg}</p>}
          <a href="/api/signals/export"
            className="block text-center text-xs font-medium text-gray-700 border border-gray-200 px-3 py-2 rounded-lg">
            ↓ Export signals for ad audiences (signals_export.csv)
          </a>
          <p className="text-[11px] text-gray-400">
            Drop <code>signals_export.csv</code> into the <code>customer-signals</code> folder and re-run
            the pipeline to generate interest-based Meta/Google audiences.
          </p>
        </section>
      </main>
    </div>
  )
}

// Salesmen roster — its own component so typing in the add fields only re-renders
// this small box, not the whole (heavy) Call Control page. Re-rendering the entire
// page on every keystroke lagged the controlled inputs enough that the mobile
// keyboard reset the caret and typed text came out reversed.
type Salesman = { id: string; name: string; alias: string; is_active: boolean }

function SalesmenRoster({ supabase }: { supabase: ReturnType<typeof createClient> }) {
  const [salesmen, setSalesmen] = useState<Salesman[]>([])
  const [smName, setSmName] = useState('')
  const [smAlias, setSmAlias] = useState('')

  useEffect(() => { loadSalesmen() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function loadSalesmen() {
    const { data } = await supabase.from('salesmen').select('id, name, alias, is_active').order('created_at')
    setSalesmen((data ?? []) as Salesman[])
  }
  async function addSalesman() {
    const name = smName.trim(), alias = smAlias.trim()
    if (!name || !alias) return
    await supabase.from('salesmen').insert({ name, alias })
    setSmName(''); setSmAlias(''); loadSalesmen()
  }
  async function toggleSalesman(id: string, next: boolean) {
    await supabase.from('salesmen').update({ is_active: next }).eq('id', id)
    loadSalesmen()
  }

  return (
    <section className="card p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-gray-700">Salesmen</p>
        <p className="text-xs text-gray-500">The roster the calling screen picks from. Each call &amp; walk-in is tagged with the active salesman&apos;s alias.</p>
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          placeholder="Name" value={smName} onChange={e => setSmName(e.target.value)} />
        <input
          className="w-24 flex-shrink-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          placeholder="Alias" value={smAlias} onChange={e => setSmAlias(e.target.value)} />
        <button onClick={addSalesman} disabled={!smName.trim() || !smAlias.trim()}
          className="btn-primary px-3 text-sm flex-shrink-0 disabled:opacity-50">Add</button>
      </div>
      {salesmen.length === 0 && <p className="text-xs text-gray-400">None yet.</p>}
      {salesmen.map(s => (
        <div key={s.id} className="flex items-center justify-between border-b border-gray-100 last:border-0 py-1.5">
          <p className="text-xs text-gray-800"><b>{s.alias}</b> · {s.name}</p>
          <button onClick={() => toggleSalesman(s.id, !s.is_active)}
            className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium',
              s.is_active ? 'text-green-700 bg-green-50 border-green-200' : 'text-gray-400 border-gray-200')}>
            {s.is_active ? 'Active' : 'Inactive'}
          </button>
        </div>
      ))}
    </section>
  )
}
