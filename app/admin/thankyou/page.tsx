'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Navbar from '@/components/ui/Navbar'
import CustomerPeek from '@/components/ui/CustomerPeek'
import type { MessageTemplate } from '@/lib/types'

// Thank-you broadcast. Both tabs draw from ONE source of truth: templates in the
// Templates module whose Message type is "Thank-you" (category='thankyou'). No
// separate template store — set it once in Templates and it shows up here.
//   • Recent buyers — auto-thank everyone who bought in the last N days (from data).
//   • Send / test   — fire a thank-you at a specific number (or a pasted list /
//                     upload) right now, without waiting on buyer data.

export default function ThankYouPage() {
  const supabase = createClient()
  const router = useRouter()

  const [tab, setTab] = useState<'recent' | 'send' | 'invoices'>('recent')
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // One source of truth: templates tagged Thank-you. All three tabs (Recent
    // buyers, Send/test, Invoices) draw from the same list — an invoice-link
    // send just adds the dynamic button on top of the chosen thank-you template.
    supabase.from('wa_message_templates').select('*')
      .eq('is_active', true).eq('category', 'thankyou')
      .not('meta_template_name', 'is', null)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setTemplates((data ?? []) as MessageTemplate[]); setLoading(false) })
  }, [supabase])

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-4 space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">←</button>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Thank-you broadcast</h1>
            <p className="text-xs text-gray-500">Uses thank-you templates from the Templates module.</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {(['recent', 'send', 'invoices'] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setError(null) }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                tab === t ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300'
              }`}>
              {t === 'recent' ? 'Recent buyers' : t === 'send' ? 'Send / test' : 'Invoices'}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        {loading ? (
          <div className="flex justify-center pt-10"><div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>
        ) : templates.length === 0 ? (
          <div className="card p-5 text-center space-y-1">
            <p className="text-sm font-medium text-gray-700">No thank-you templates yet</p>
            <p className="text-xs text-gray-500">
              In <b>Templates</b>, link a Meta-approved template and set its <b>Message type</b> to <b>Thank-you</b>.
              It&apos;ll appear here automatically.
            </p>
          </div>
        ) : tab === 'invoices' ? (
          <InvoicesTab templates={templates} setError={setError} />
        ) : tab === 'recent' ? (
          <RecentBuyersTab templates={templates} setError={setError} />
        ) : (
          <ManualSendTab templates={templates} setError={setError} />
        )}
      </main>
    </div>
  )
}

// A shared thank-you template picker.
function TemplatePicker({ templates, value, onChange }: {
  templates: MessageTemplate[]; value: string; onChange: (id: string) => void
}) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-600">Thank-you template</label>
      <select value={value} onChange={e => onChange(e.target.value)} className="input mt-1 text-sm">
        <option value="">Choose a thank-you template…</option>
        {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </div>
  )
}

// ===========================================================================
// RECENT BUYERS — auto-thank everyone who bought in the last N days.
// Pulls last_purchase_date from wa_b_markers (no upload) and sends via the
// Reach ledger, so nobody is thanked twice inside the template's window.
// ===========================================================================
interface RecentRecipient { phone: string; name: string | null; lastPurchase: string | null; suppressed: boolean; optedOut: boolean }

function RecentBuyersTab({ templates, setError }: { templates: MessageTemplate[]; setError: (s: string | null) => void }) {
  const [templateId, setTemplateId] = useState('')
  const [days, setDays] = useState(14)
  const [cap, setCap] = useState<number | ''>('')  // send at most N today (WhatsApp daily limit)
  const [recipients, setRecipients] = useState<RecentRecipient[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; skippedSuppressed: number; skippedDnc: number; failed: number } | null>(null)
  const [peekPhone, setPeekPhone] = useState<string | null>(null)

  const template = templates.find(t => t.id === templateId) ?? null
  const eligible = recipients.filter(r => !r.suppressed && !r.optedOut)
  // Only the first N eligible go out this batch; the rest roll to the next run
  // (already-thanked buyers are auto-suppressed, so no one is thanked twice).
  const toSend = cap === '' ? eligible : eligible.slice(0, Math.max(0, cap))

  async function load() {
    setError(null); setResult(null)
    if (!templateId) { setError('Pick a thank-you template first.'); return }
    setLoading(true); setLoaded(false)
    try {
      const res = await fetch(`/api/thankyou/recent-buyers?days=${days}&templateId=${templateId}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not load buyers'); setLoading(false); return }
      setRecipients(data.recipients ?? [])
      setLoaded(true)
    } catch { setError('Network error') } finally { setLoading(false) }
  }

  async function send() {
    if (!template || toSend.length === 0) return
    setSending(true); setError(null)
    try {
      const res = await fetch('/api/reach/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: toSend.map(r => ({ phone: r.phone, name: r.name })),
          templateId, cohortLabel: `Thank-you (bought ≤${days}d)`,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Send failed'); setSending(false); return }
      setResult(data)
      await load()
    } catch { setError('Network error during send') } finally { setSending(false) }
  }

  return (
    <div className="space-y-3">
      <div className="card p-4 space-y-3">
        <TemplatePicker templates={templates} value={templateId} onChange={id => { setTemplateId(id); setLoaded(false) }} />
        <div className="flex items-end gap-2">
          <label className="text-xs font-medium text-gray-600">
            Bought in the last
            <input type="number" min={1} max={90} value={days} onChange={e => { setDays(Math.max(1, Math.min(90, parseInt(e.target.value) || 14))); setLoaded(false) }}
              className="input mt-1 text-sm w-20" />
          </label>
          <span className="text-xs text-gray-500 pb-2.5">days</span>
          <button onClick={load} disabled={loading} className="btn-primary ml-auto disabled:opacity-60">{loading ? 'Loading…' : 'Load buyers'}</button>
        </div>
        <label className="text-xs font-medium text-gray-600 block">
          Send at most (per batch)
          <input type="number" min={1} inputMode="numeric" placeholder="all eligible"
            value={cap} onChange={e => setCap(e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value) || 0))}
            className="input mt-1 text-sm w-32" />
        </label>
        <p className="text-[10px] text-gray-400">Blank = thank everyone eligible. Set e.g. 30 to send 30 now — run again later and the next 30 go out (already-thanked auto-skip).</p>
        {template && template.suppression_days > 0 && (
          <p className="text-[11px] text-gray-500">Skips anyone already thanked with this template in the last {template.suppression_days} days.</p>
        )}
      </div>

      {result && (
        <div className="text-xs bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-green-800">
          Sent {result.sent} · skipped {result.skippedSuppressed} (already thanked) · {result.skippedDnc} opted-out · {result.failed} failed.
        </div>
      )}

      {loaded && (
        <div className="card p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-700">
            {recipients.length} buyer{recipients.length !== 1 ? 's' : ''} · {eligible.length} eligible
            {cap !== '' && eligible.length > toSend.length && <span className="text-gray-500 font-normal"> · sending {toSend.length} this batch</span>}
          </p>
          {recipients.length === 0 && (
            <p className="text-[11px] text-gray-500">No purchases in this window. Try widening the days.</p>
          )}
          <div className="space-y-1.5 max-h-[48vh] overflow-y-auto">
            {recipients.map(r => (
              <div key={r.phone} className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 ${r.suppressed || r.optedOut ? 'border-gray-100 bg-gray-50' : 'border-gray-200'}`}>
                <button onClick={() => setPeekPhone(r.phone)} className="min-w-0 text-left">
                  <span className="text-xs font-medium text-gray-800 truncate underline decoration-dotted underline-offset-2">{r.name || 'Unknown'}</span>
                  <span className="text-[11px] text-gray-400 ml-1.5">+91 {r.phone}</span>
                </button>
                <span className="text-[10px] text-gray-400 flex-shrink-0">
                  {r.suppressed ? 'already thanked' : r.optedOut ? 'opted out' : r.lastPurchase ? new Date(r.lastPurchase).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}
                </span>
              </div>
            ))}
          </div>
          <button onClick={send} disabled={sending || toSend.length === 0} className="btn-primary w-full disabled:opacity-60">
            {sending ? 'Sending…' : `Send thank-you to ${toSend.length}`}
          </button>
        </div>
      )}

      <CustomerPeek phone={peekPhone} onClose={() => setPeekPhone(null)} />
    </div>
  )
}

// ===========================================================================
// SEND / TEST — fire a chosen thank-you template at a number, a pasted list,
// or an uploaded file, right now. No dependence on buyer data. A test toggle
// bypasses the resend guard so you can preview the same template repeatedly.
// ===========================================================================
function ManualSendTab({ templates, setError }: { templates: MessageTemplate[]; setError: (s: string | null) => void }) {
  const [templateId, setTemplateId] = useState('')
  const [method, setMethod] = useState<'single' | 'phones' | 'excel'>('single')
  const [singlePhone, setSinglePhone] = useState('')
  const [phonesText, setPhonesText] = useState('')
  const [excelPhones, setExcelPhones] = useState<string[]>([])
  const [fileName, setFileName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [ignoreGuard, setIgnoreGuard] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number; skippedSuppressed: number; skippedDnc: number; total: number } | null>(null)

  const template = templates.find(t => t.id === templateId) ?? null

  function normList(text: string): string[] {
    return [...new Set(text.split(/[\s,;]+/).map(p => p.replace(/\D/g, '').replace(/^91/, '')).filter(p => p.length === 10))]
  }
  function currentPhones(): string[] {
    if (method === 'single') { const p = singlePhone.replace(/\D/g, '').replace(/^91/, ''); return p.length === 10 ? [p] : [] }
    if (method === 'phones') return normList(phonesText)
    return excelPhones
  }

  async function handleExcel(file: File) {
    setParsing(true); setError(null); setResult(null); setFileName(file.name)
    try {
      const buf = await file.arrayBuffer()
      const XLSX = await import('xlsx')
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
      if (rows.length === 0) { setError('That file has no rows.'); setParsing(false); return }
      const keys = Object.keys(rows[0])
      const phoneKey = keys.find(k => /phone|mobile|number|contact/i.test(k)) ?? keys[0]
      const phones = normList(rows.map(r => String(r[phoneKey] ?? '')).join(' '))
      if (phones.length === 0) { setError('No valid 10-digit phone numbers found.'); setParsing(false); return }
      setExcelPhones(phones)
    } catch {
      setError('Could not read that file. Use an .xlsx or .csv with a phone column.')
    } finally { setParsing(false) }
  }

  async function send() {
    const phones = currentPhones()
    if (!templateId) { setError('Pick a thank-you template first.'); return }
    if (phones.length === 0) { setError('No valid recipients.'); return }
    setSending(true); setError(null); setResult(null)
    try {
      const res = await fetch('/api/reach/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: phones.map(phone => ({ phone })),
          templateId,
          cohortLabel: ignoreGuard ? 'Thank-you (test)' : 'Thank-you (manual)',
          ignoreSuppression: ignoreGuard,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Send failed'); setSending(false); return }
      setResult(data)
      if (method === 'single') setSinglePhone('')
    } catch { setError('Network error during send') } finally { setSending(false) }
  }

  const count = currentPhones().length

  return (
    <div className="space-y-3">
      <div className="card p-4 space-y-3">
        <TemplatePicker templates={templates} value={templateId} onChange={setTemplateId} />

        {/* Method picker */}
        <div className="flex gap-1.5 text-xs">
          {([['single', 'One number'], ['phones', 'Paste list'], ['excel', 'Upload file']] as const).map(([m, label]) => (
            <button key={m} onClick={() => { setMethod(m); setResult(null); setError(null) }}
              className={`flex-1 py-1.5 rounded-lg border font-medium ${method === m ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300'}`}>
              {label}
            </button>
          ))}
        </div>

        {method === 'single' && (
          <input value={singlePhone} onChange={e => setSinglePhone(e.target.value)} className="input" placeholder="Phone number (10 digits)" inputMode="numeric" />
        )}
        {method === 'phones' && (
          <textarea value={phonesText} onChange={e => setPhonesText(e.target.value)} rows={4}
            className="input resize-none text-sm" placeholder="9876543210, 9123456780, …" />
        )}
        {method === 'excel' && (
          <div className="space-y-2">
            <label className="block">
              <span className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-full cursor-pointer inline-block">
                {parsing ? 'Reading…' : 'Choose file'}
              </span>
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleExcel(f) }} />
            </label>
            {excelPhones.length > 0 && <p className="text-xs text-gray-600">{excelPhones.length} numbers from {fileName}</p>}
          </div>
        )}

        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={ignoreGuard} onChange={e => setIgnoreGuard(e.target.checked)} />
          Test send — ignore the {template?.suppression_days ?? 14}-day resend guard (still respects opt-outs)
        </label>

        <button onClick={send} disabled={sending || count === 0 || !templateId} className="btn-primary w-full disabled:opacity-60">
          {sending ? 'Sending…' : count > 0 ? `Send to ${count}` : 'Send'}
        </button>
      </div>

      {result && (
        <div className="card p-4 text-sm text-gray-700 space-y-1">
          <p><b className="text-green-700">{result.sent}</b> sent
            {result.skippedSuppressed > 0 && <> · {result.skippedSuppressed} skipped (already sent)</>}
            {result.skippedDnc > 0 && <> · {result.skippedDnc} opted-out</>}
            {result.failed > 0 && <> · <b className="text-red-600">{result.failed}</b> failed</>}
          </p>
          {result.sent === 0 && result.failed === 0 && (
            <p className="text-xs text-gray-500">Nothing sent — everyone was suppressed or opted out. Tick “Test send” to override the guard.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// INVOICES — send each imported-but-unsent bill as a personalised message with
// a dynamic "View invoice" button. Per INVOICE (a customer with two new bills
// gets two links). The send publishes the private page BEFORE messaging, so a
// dead link never goes out; sent bills leave this queue and expire in 7 days.
// ===========================================================================
interface PendingInvoice { id: string; billNo: string; phone: string; name: string | null; date: string | null; payable: number | null; optedOut: boolean }

interface ReportRow {
  billNo: string; name: string | null; phone: string; url: string
  sentAt: string | null; delivered: boolean; read: boolean; opened: boolean
  reviewed: boolean; rating: number | null; birthday: boolean; anniversary: boolean; visitedWebsite: boolean
}
interface ReportSummary {
  total: number; delivered: number; read: number; opened: number
  reviewed: number; birthday: number; anniversary: number; visitedWebsite: number
}

function InvoicesTab({ templates, setError }: { templates: MessageTemplate[]; setError: (s: string | null) => void }) {
  const [templateId, setTemplateId] = useState('')
  const [days, setDays] = useState(14)
  const [allDates, setAllDates] = useState(false)   // ignore the recency window (historical bills)
  const [cap, setCap] = useState<number | ''>('')
  const [invoices, setInvoices] = useState<PendingInvoice[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; failed: number; skippedDnc: number } | null>(null)
  const [peekPhone, setPeekPhone] = useState<string | null>(null)
  // Test send
  const [testPhone, setTestPhone] = useState('')
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState('')
  // Sent report (per-bill engagement)
  const [report, setReport] = useState<{ summary: ReportSummary; rows: ReportRow[] } | null>(null)
  const [showReport, setShowReport] = useState(false)
  const [loadingReport, setLoadingReport] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const template = templates.find(t => t.id === templateId) ?? null
  const eligible = invoices.filter(i => !i.optedOut)
  const toSend = cap === '' ? eligible : eligible.slice(0, Math.max(0, cap))

  async function load() {
    setError(null); setResult(null)
    setLoading(true); setLoaded(false)
    try {
      const res = await fetch(`/api/invoices/pending?limit=500&days=${allDates ? 'all' : days}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not load invoices'); setLoading(false); return }
      setInvoices(data.invoices ?? [])
      setLoaded(true)
    } catch { setError('Network error') } finally { setLoading(false) }
  }

  async function send() {
    if (!template || toSend.length === 0) return
    setSending(true); setError(null)
    try {
      const res = await fetch('/api/invoices/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceIds: toSend.map(i => i.id), templateId, cohortLabel: allDates ? 'Invoice link (all dates)' : `Invoice link (≤${days}d)` }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Send failed'); setSending(false); return }
      setResult(data)
      await load()
    } catch { setError('Network error during send') } finally { setSending(false) }
  }

  async function loadReport() {
    setError(null); setLoadingReport(true); setShowReport(true)
    try {
      const res = await fetch('/api/invoices/report?limit=300')
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Could not load report'); return }
      setReport(data)
    } catch { setError('Network error loading report') } finally { setLoadingReport(false) }
  }

  async function copyUrl(url: string, billNo: string) {
    try { await navigator.clipboard.writeText(url); setCopied(billNo); setTimeout(() => setCopied(c => c === billNo ? null : c), 1500) } catch { /* clipboard blocked */ }
  }

  async function testSend() {
    setTestMsg(''); setError(null)
    if (!templateId) { setError('Pick a template first.'); return }
    const p = testPhone.replace(/\D/g, '').replace(/^91/, '')
    if (p.length !== 10) { setError('Enter a valid 10-digit phone number.'); return }
    setTesting(true)
    try {
      const res = await fetch('/api/invoices/test-send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: p, templateId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Test send failed'); setTesting(false); return }
      setTestMsg(`Test sent to ${p}. Check WhatsApp — tap the button to preview a sample Bill Summary.`)
    } catch { setError('Network error during test send') } finally { setTesting(false) }
  }

  return (
    <div className="space-y-3">
      <div className="card p-4 space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-600">Thank-you template (with invoice button)</label>
          <select value={templateId} onChange={e => setTemplateId(e.target.value)} className="input mt-1 text-sm">
            <option value="">Choose a template…</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs font-medium text-gray-600">
            Billed in the last
            <input type="number" min={1} max={365} value={days} disabled={allDates}
              onChange={e => { setDays(Math.max(1, Math.min(365, parseInt(e.target.value) || 14))); setLoaded(false) }}
              className="input mt-1 text-sm w-20 disabled:opacity-40" />
          </label>
          <span className={`text-xs pb-2.5 ${allDates ? 'text-gray-300' : 'text-gray-500'}`}>days</span>
          <button onClick={load} disabled={loading} className="btn-primary ml-auto disabled:opacity-60">
            {loading ? 'Loading…' : 'Load invoices'}
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
          <input type="checkbox" checked={allDates} onChange={e => { setAllDates(e.target.checked); setLoaded(false) }} className="accent-green-600" />
          All dates (ignore recency — for historical bills)
        </label>
        <label className="text-xs font-medium text-gray-600 block">
          Send at most (per batch)
          <input type="number" min={1} inputMode="numeric" placeholder="all eligible"
            value={cap} onChange={e => setCap(e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value) || 0))}
            className="input mt-1 text-sm w-32" />
        </label>
        <p className="text-[10px] text-gray-400">{allDates ? 'Includes bills of any date (recency ignored).' : `Thanks only buyers billed in the last ${days} days.`} Each bill sends once — sent bills drop off. The link opens a private invoice page that expires in 7 days.</p>
      </div>

      {result && (
        <div className="text-xs bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-green-800">
          Sent {result.sent} · {result.skippedDnc} opted-out · {result.failed} failed.
        </div>
      )}

      {loaded && (
        <div className="card p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-700">
            {invoices.length} unsent invoice{invoices.length !== 1 ? 's' : ''} · {eligible.length} eligible
            {cap !== '' && eligible.length > toSend.length && <span className="text-gray-500 font-normal"> · sending {toSend.length} this batch</span>}
          </p>
          {invoices.length === 0 && (
            <p className="text-[11px] text-gray-500">{allDates ? 'No unsent invoices found. Import a sales file (More → Import invoices).' : `No unsent invoices billed in the last ${days} days. Widen the days or tick “All dates”, or import a sales file (More → Import invoices).`}</p>
          )}
          <div className="space-y-1.5 max-h-[48vh] overflow-y-auto">
            {invoices.map(i => (
              <div key={i.id} className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 ${i.optedOut ? 'border-gray-100 bg-gray-50' : 'border-gray-200'}`}>
                <button onClick={() => setPeekPhone(i.phone)} className="min-w-0 text-left">
                  <span className="text-xs font-medium text-gray-800 truncate underline decoration-dotted underline-offset-2">{i.name || 'Unknown'}</span>
                  <span className="text-[11px] text-gray-400 ml-1.5">{i.billNo}</span>
                </button>
                <span className="text-[10px] text-gray-400 flex-shrink-0">
                  {i.optedOut ? 'opted out' : i.payable != null ? `₹${Math.round(i.payable).toLocaleString('en-IN')}` : ''}
                </span>
              </div>
            ))}
          </div>
          <button onClick={send} disabled={sending || toSend.length === 0} className="btn-primary w-full disabled:opacity-60">
            {sending ? 'Sending…' : `Send invoice link to ${toSend.length}`}
          </button>
        </div>
      )}

      {/* Test send — the real template to one number, with a fake test link. */}
      <div className="card p-4 space-y-2">
        <p className="text-xs font-semibold text-gray-700">Test send</p>
        <p className="text-[10px] text-gray-400">Sends the selected template to one number with sample values and a test link, so you can preview exactly how it lands in WhatsApp. No real invoice is used.</p>
        <div className="flex items-center gap-2">
          <input value={testPhone} onChange={e => setTestPhone(e.target.value)} inputMode="numeric"
            placeholder="Phone number (10 digits)" className="input text-sm flex-1" />
          <button onClick={testSend} disabled={testing || !templateId} className="btn-secondary disabled:opacity-60 whitespace-nowrap">
            {testing ? 'Sending…' : 'Send test'}
          </button>
        </div>
        {testMsg && <p className="text-[11px] text-green-700 bg-green-50 border border-green-100 rounded-lg px-2.5 py-1.5">{testMsg}</p>}
      </div>

      {/* Sent report — per-bill engagement (also in Campaigns as "Invoice links"). */}
      <div className="card p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-gray-700">Sent report</p>
            <p className="text-[10px] text-gray-400">Per bill: delivered / read / opened, reviewed, birthday or anniversary shared, and whether they visited the site. The overall funnel also lives in Campaigns → “Invoice links”.</p>
          </div>
          <button onClick={loadReport} disabled={loadingReport} className="btn-secondary disabled:opacity-60 whitespace-nowrap">
            {loadingReport ? 'Loading…' : report ? 'Refresh' : 'View report'}
          </button>
        </div>

        {showReport && report && (
          <>
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              {[
                ['Sent', report.summary.total],
                ['Delivered', report.summary.delivered],
                ['Read', report.summary.read],
                ['Opened', report.summary.opened],
                ['Reviewed', report.summary.reviewed],
                ['Birthday', report.summary.birthday],
                ['Anniversary', report.summary.anniversary],
                ['Visited site', report.summary.visitedWebsite],
              ].map(([label, n]) => (
                <span key={label as string} className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">
                  {label}: <span className="font-semibold text-gray-800">{n as number}</span>
                </span>
              ))}
            </div>

            {report.rows.length === 0 ? (
              <p className="text-[11px] text-gray-500">No invoice links sent yet.</p>
            ) : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-[11px] border-collapse">
                  <thead>
                    <tr className="text-gray-400 text-left">
                      <th className="font-medium px-1.5 py-1">Customer</th>
                      <th className="font-medium px-1.5 py-1">Bill</th>
                      <th className="font-medium px-1.5 py-1">Link</th>
                      <th className="font-medium px-1.5 py-1 text-center">Deliv.</th>
                      <th className="font-medium px-1.5 py-1 text-center">Read</th>
                      <th className="font-medium px-1.5 py-1 text-center">Opened</th>
                      <th className="font-medium px-1.5 py-1 text-center">Review</th>
                      <th className="font-medium px-1.5 py-1 text-center">Bday</th>
                      <th className="font-medium px-1.5 py-1 text-center">Anniv.</th>
                      <th className="font-medium px-1.5 py-1 text-center">Site</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map(r => (
                      <tr key={r.billNo} className="border-t border-gray-100">
                        <td className="px-1.5 py-1 text-gray-800 whitespace-nowrap">{r.name || 'Unknown'}</td>
                        <td className="px-1.5 py-1 text-gray-400 whitespace-nowrap">{r.billNo}</td>
                        <td className="px-1.5 py-1">
                          <button onClick={() => copyUrl(r.url, r.billNo)} className="text-green-700 underline decoration-dotted underline-offset-2 whitespace-nowrap">
                            {copied === r.billNo ? 'Copied ✓' : 'Copy link'}
                          </button>
                        </td>
                        <td className="px-1.5 py-1 text-center">{r.delivered ? '✓' : '–'}</td>
                        <td className="px-1.5 py-1 text-center">{r.read ? '✓' : '–'}</td>
                        <td className="px-1.5 py-1 text-center">{r.opened ? '✓' : '–'}</td>
                        <td className="px-1.5 py-1 text-center">{r.reviewed ? (r.rating != null ? `★${r.rating}` : '✓') : '–'}</td>
                        <td className="px-1.5 py-1 text-center">{r.birthday ? '✓' : '–'}</td>
                        <td className="px-1.5 py-1 text-center">{r.anniversary ? '✓' : '–'}</td>
                        <td className="px-1.5 py-1 text-center">{r.visitedWebsite ? '✓' : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[10px] text-gray-400 mt-1.5">“Opened” = the bill page loaded (WhatsApp reports no button tap, so this is the click proxy). “Site” = tapped an Explore / scheme / contact link.</p>
              </div>
            )}
          </>
        )}
      </div>

      <CustomerPeek phone={peekPhone} onClose={() => setPeekPhone(null)} />
    </div>
  )
}
