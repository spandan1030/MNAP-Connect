'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'
import Navbar from '@/components/ui/Navbar'

// Import per-invoice records from the raw billing-ERP export (Bill×Barcode grained:
// one row per item, many rows per bill). We GROUP rows by bill number client-side,
// then chunk on WHOLE BILLS — so a request never cuts a bill's items in half (the
// server groups per request, and a split bill would lose its other items).

const ROWS_PER_CHUNK = 500

type Row = Record<string, string>

export default function InvoiceImportPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [billCount, setBillCount] = useState(0)
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [updateExisting, setUpdateExisting] = useState(false)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name); setResult(''); setError('')
    const buf = await file.arrayBuffer()
    // cellDates + dateNF is CRITICAL: without them SheetJS auto-detects an ISO date
    // like "2018-09-14" and reformats it to "9/14/18" (2-digit year), which the
    // server can't parse → every invoice_date lands as null. This keeps dates as
    // clean YYYY-MM-DD while leaving every other column exactly as before.
    const wb = XLSX.read(buf, { type: 'array', cellDates: true, dateNF: 'yyyy-mm-dd' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const parsed = XLSX.utils.sheet_to_json<Row>(sheet, { defval: '', raw: false, dateNF: 'yyyy-mm-dd' })
    setRows(parsed)
    setBillCount(new Set(parsed.map(r => (r.RI_VRNO ?? '').trim()).filter(Boolean)).size)
  }

  // Group rows by bill, then pack whole bills into chunks of ~ROWS_PER_CHUNK rows.
  function billChunks(all: Row[]): Row[][] {
    const byBill = new Map<string, Row[]>()
    for (const r of all) {
      const bill = (r.RI_VRNO ?? '').trim()
      if (!bill) continue
      const arr = byBill.get(bill); if (arr) arr.push(r); else byBill.set(bill, [r])
    }
    const chunks: Row[][] = []
    let cur: Row[] = []
    for (const billRows of byBill.values()) {
      if (cur.length && cur.length + billRows.length > ROWS_PER_CHUNK) { chunks.push(cur); cur = [] }
      cur.push(...billRows)
    }
    if (cur.length) chunks.push(cur)
    return chunks
  }

  async function handleImport() {
    if (rows.length === 0) return
    setImporting(true); setProgress(0); setResult(''); setError('')
    const batch = new Date().toISOString()
    let imported = 0, updated = 0, already = 0, noPhone = 0, done = 0, datesNull = 0
    try {
      const chunks = billChunks(rows)
      for (const chunk of chunks) {
        const res = await fetch('/api/invoices/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: chunk, batch, update: updateExisting }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Import failed')
        imported += json.imported ?? 0
        updated += json.updated ?? 0
        already += json.alreadyPresent ?? 0
        noPhone += json.skippedNoPhone ?? 0
        datesNull += json.datesNull ?? 0
        done += chunk.length
        setProgress(done)
      }
      setResult(
        `Imported ${imported} new invoice${imported === 1 ? '' : 's'}` +
        `${updated ? ` · ${updated} updated` : ''}` +
        `${already && !updateExisting ? ` · ${already} already present` : ''}` +
        `${noPhone ? ` · ${noPhone} skipped (no phone)` : ''}` +
        `${datesNull ? ` · ⚠ ${datesNull} with no readable date` : ''}.`,
      )
      setRows([]); setFileName(''); setBillCount(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <Navbar />
      <div className="max-w-lg mx-auto px-4 py-5 space-y-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Import invoices</h1>
          <p className="text-sm text-gray-500">
            Upload the raw sales export (one row per item). Rows are grouped by bill number into
            invoices, each ready to send as a private &ldquo;view invoice&rdquo; link.
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-1">Required columns</p>
            <p className="text-[11px] text-gray-500 leading-relaxed">
              <code>RI_VRNO</code>, <code>RI_DATE</code>, <code>RI_CST_NAME</code>, <code>RI_PHN_NO</code>,{' '}
              <code>RI_AMT</code>, <code>RI_TAX_AMT</code>, <code>RI_NET_AMT</code>, <code>OA_AMT</code>,{' '}
              <code>AR_AMT</code>, <code>ITM_NAME</code>, <code>PURT_NAME</code>, <code>RIO_NET_WT</code>,{' '}
              <code>BCM_BRCD</code>, <code>RIO_TOTAL_AMT</code>.
            </p>
            <p className="text-[11px] text-gray-400 mt-1">
              Re-importing is safe — by default bills already imported are skipped, so nothing re-sends.
            </p>
          </div>

          <label className="block">
            <span className="sr-only">Choose file</span>
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile}
              className="block w-full text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-green-600 file:text-white file:text-sm file:font-medium" />
          </label>

          {fileName && (
            <p className="text-xs text-gray-500">{fileName} — {rows.length} row{rows.length === 1 ? '' : 's'} · {billCount} bill{billCount === 1 ? '' : 's'}</p>
          )}

          {rows.length > 0 && (
            <label className="flex items-start gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={updateExisting} onChange={e => setUpdateExisting(e.target.checked)} className="mt-0.5" />
              <span>
                <span className="font-medium text-gray-700">Update existing bills</span> — refresh items &amp; amounts on bills already imported (e.g. to backfill a corrected export). Tokens and sent status are preserved; nothing re-sends.
              </span>
            </label>
          )}

          {rows.length > 0 && (
            <button onClick={handleImport} disabled={importing}
              className="btn-primary w-full disabled:opacity-60">
              {importing ? `Importing… ${progress}/${rows.length}` : `Import ${billCount} bill${billCount === 1 ? '' : 's'}`}
            </button>
          )}

          {result && <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{result}</p>}
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>
      </div>
    </div>
  )
}
